import type { Request, Response } from "express";
import { Address } from "../models/address.js";
import type { IUser } from "../models/user.js";

/**
 * [CREATE] Adds a new Indian shipping address for the caller.
 */
export async function createAddress(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const {
      fullName,
      phone,
      line1,
      line2,
      landmark,
      city,
      state,
      pincode,
      isDefault = false,
    } = req.body;

    if (!fullName || !phone || !line1 || !line2 || !landmark || !city || !state || !pincode) {
      res.status(400).json({
        success: false,
        message: "Required fields: fullName, phone, line1, line2, landmark, city, state, and pincode.",
      });
      return;
    }

    const address = new Address({
      userId: caller._id,
      fullName,
      phone,
      line1,
      line2,
      landmark,
      city,
      state,
      pincode,
      isDefault,
    });

    await address.save();

    res.status(201).json({
      success: true,
      message: "Address added successfully.",
      address,
    });
  } catch (error: unknown) {
    console.error("Create address error:", error);
    const message = error instanceof Error ? error.message : "Failed to create address.";
    res.status(400).json({ success: false, message });
  }
}

/**
 * [READ LIST] Retrieves all addresses of the authenticated caller.
 * Sorts the default address first.
 */
export async function getMyAddresses(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    // Sort by isDefault descending, then by updatedAt descending
    const addresses = await Address.find({ userId: caller._id }).sort({ isDefault: -1, updatedAt: -1 });
    res.status(200).json({ success: true, addresses });
  } catch (error) {
    console.error("Get my addresses error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving addresses." });
  }
}

/**
 * [READ ONE] Retrieves a specific address by ID. (Self or Admin Only)
 */
export async function getAddressById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;

    const address = await Address.findById(id);
    if (!address) {
      res.status(404).json({ success: false, message: "Address not found." });
      return;
    }

    // RBAC: Only Admin or Owner can view
    if (caller.role !== "admin" && address.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    res.status(200).json({ success: true, address });
  } catch (error) {
    console.error("Get address by ID error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving address." });
  }
}

/**
 * [UPDATE] Updates own address details. (Self Only)
 */
export async function updateAddress(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;
    const {
      fullName,
      phone,
      line1,
      line2,
      landmark,
      city,
      state,
      pincode,
      isDefault,
    } = req.body;

    const address = await Address.findById(id);
    if (!address) {
      res.status(404).json({ success: false, message: "Address not found." });
      return;
    }

    // Enforce ownership
    if (address.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this address." });
      return;
    }

    if (fullName) address.fullName = fullName;
    if (phone) address.phone = phone;
    if (line1) address.line1 = line1;
    if (line2) address.line2 = line2;
    if (landmark) address.landmark = landmark;
    if (city) address.city = city;
    if (state) address.state = state;
    if (pincode) address.pincode = pincode;
    if (typeof isDefault === "boolean") address.isDefault = isDefault;

    await address.save(); // save() triggers pre-save hook for default address toggles

    res.status(200).json({
      success: true,
      message: "Address updated successfully.",
      address,
    });
  } catch (error: unknown) {
    console.error("Update address error:", error);
    const message = error instanceof Error ? error.message : "Failed to update address.";
    res.status(400).json({ success: false, message });
  }
}

/**
 * [DELETE] Deletes own address. (Self Only)
 * Premium Feature: If the deleted address was default, promote another address to default.
 */
export async function deleteAddress(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;

    const address = await Address.findById(id);
    if (!address) {
      res.status(404).json({ success: false, message: "Address not found." });
      return;
    }

    // Enforce ownership
    if (address.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this address." });
      return;
    }

    const wasDefault = address.isDefault;

    await Address.findByIdAndDelete(id);

    // Premium logic: Promote another address to default
    if (wasDefault) {
      const anotherAddress = await Address.findOne({ userId: caller._id }).sort({ updatedAt: -1 });
      if (anotherAddress) {
        anotherAddress.isDefault = true;
        await anotherAddress.save();
      }
    }

    res.status(200).json({ success: true, message: "Address deleted successfully." });
  } catch (error) {
    console.error("Delete address error:", error);
    res.status(500).json({ success: false, message: "Internal server error deleting address." });
  }
}
