import type { Request, Response } from "express";
import { ShippingProfile } from "../models/shippingProfile.js";
import { SellerStore } from "../models/sellerStore.js";

// ==========================================
// 1. SHIPPING PROFILES CRUD
// ==========================================

export async function createShippingProfile(req: Request, res: Response): Promise<void> {
  try {
    const seller = req.seller;
    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller onboarding required." });
      return;
    }

    const { name, processingDays, shippingType, baseChargePaise } = req.body;

    if (!name || processingDays === undefined) {
      res.status(400).json({ success: false, message: "Required fields: name and processingDays." });
      return;
    }

    const profile = new ShippingProfile({
      sellerId: seller._id,
      name,
      processingDays,
      shippingType: shippingType || "free",
      baseChargePaise: baseChargePaise || 0,
    });

    await profile.save();

    res.status(201).json({
      success: true,
      message: "Shipping profile created successfully.",
      profile,
    });
  } catch (error: unknown) {
    console.error("Create shipping profile error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create shipping profile.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getShippingProfiles(req: Request, res: Response): Promise<void> {
  try {
    const seller = req.seller;
    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const profiles = await ShippingProfile.find({ sellerId: seller._id });
    res.status(200).json({ success: true, profiles });
  } catch (error: unknown) {
    console.error("Get shipping profiles error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch shipping profiles." });
  }
}

// ==========================================
// 2. SELLER WAREHOUSES & STORES CRUD
// ==========================================

export async function createSellerStore(req: Request, res: Response): Promise<void> {
  try {
    const seller = req.seller;
    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller onboarding required." });
      return;
    }

    const { name, address, coordinates } = req.body;

    if (!name || !address || !coordinates || coordinates.length !== 2) {
      res.status(400).json({
        success: false,
        message: "Required fields: name, address structure, and coordinates array [lng, lat].",
      });
      return;
    }

    const store = new SellerStore({
      sellerId: seller._id,
      name,
      address,
      location: {
        type: "Point",
        coordinates, // [longitude, latitude]
      },
    });

    await store.save();

    res.status(201).json({
      success: true,
      message: "Seller warehouse store registered successfully.",
      store,
    });
  } catch (error: unknown) {
    console.error("Create seller store error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to save store.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getSellerStores(req: Request, res: Response): Promise<void> {
  try {
    const seller = req.seller;
    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const stores = await SellerStore.find({ sellerId: seller._id });
    res.status(200).json({ success: true, stores });
  } catch (error: unknown) {
    console.error("Get seller stores error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch stores." });
  }
}
