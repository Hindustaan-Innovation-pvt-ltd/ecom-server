import type { Request, Response } from "express";
import { ShippingProfile } from "../models/shippingProfile.js";
import { SellerStore } from "../models/sellerStore.js";
import type { IUser } from "../models/user.js";

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

    const {
      name,
      processingDays,
      shippingType,
      baseChargePaise,
      baseShippingPaise,
      codAvailable,
      freeShippingAbove,
    } = req.body;

    if (!name || processingDays === undefined) {
      res.status(400).json({ success: false, message: "Required fields: name and processingDays." });
      return;
    }

    // Safely map baseShippingPaise to baseChargePaise if not provided
    const chargePaise = baseChargePaise !== undefined ? baseChargePaise : (baseShippingPaise !== undefined ? baseShippingPaise : 0);

    // Resolve shippingType based on resolved charge value
    const resolvedType = shippingType || (chargePaise > 0 ? "paid" : "free");

    const profile = new ShippingProfile({
      sellerId: seller._id,
      name,
      processingDays,
      shippingType: resolvedType,
      baseChargePaise: chargePaise,
      codAvailable: codAvailable !== undefined ? codAvailable : true,
      freeShippingAbove: freeShippingAbove !== undefined ? freeShippingAbove : null,
    });

    await profile.save();

    res.status(201).json({
      success: true,
      message: "Shipping profile created successfully.",
      profile,
      shippingProfile: profile, // Postman compatibility alias
    });
  } catch (error: unknown) {
    console.error("Create shipping profile error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create shipping profile.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getShippingProfiles(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as IUser;
    let profiles;

    if (user && user.role === "admin") {
      const { sellerId } = req.query;
      const query: Record<string, any> = {};
      if (sellerId) {
        query.sellerId = sellerId;
      }
      profiles = await ShippingProfile.find(query);
    } else {
      const seller = req.seller;
      if (!seller) {
        res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
        return;
      }
      profiles = await ShippingProfile.find({ sellerId: seller._id });
    }

    res.status(200).json({
      success: true,
      profiles,
      shippingProfiles: profiles, // Postman compatibility alias
    });
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
    const user = req.user as IUser;
    let stores;

    if (user && user.role === "admin") {
      const { sellerId } = req.query;
      const query: Record<string, any> = {};
      if (sellerId) {
        query.sellerId = sellerId;
      }
      stores = await SellerStore.find(query);
    } else {
      const seller = req.seller;
      if (!seller) {
        res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
        return;
      }
      stores = await SellerStore.find({ sellerId: seller._id });
    }

    res.status(200).json({ success: true, stores });
  } catch (error: unknown) {
    console.error("Get seller stores error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch stores." });
  }
}

/**
 * [READ NEARBY] Public geospatial search endpoint to find active stores
 * and warehouses within a specified radius (default: 10km) of given coordinates.
 */
export async function findNearbyStores(req: Request, res: Response): Promise<void> {
  try {
    const { lng, lat, radiusKm = 10 } = req.query;

    if (!lng || !lat) {
      res.status(400).json({ success: false, message: "Required query parameters: lng (longitude) and lat (latitude)." });
      return;
    }

    const longitude = parseFloat(lng as string);
    const latitude = parseFloat(lat as string);
    const radiusInMeters = parseFloat(radiusKm as string) * 1000;

    if (isNaN(longitude) || isNaN(latitude) || isNaN(radiusInMeters)) {
      res.status(400).json({ success: false, message: "Query parameters lng, lat, and radiusKm must be valid numbers." });
      return;
    }

    // $near geospatial query on 2dsphere location coordinates
    const stores = await SellerStore.find({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: radiusInMeters,
        },
      },
      isActive: true,
    }).populate("sellerId", "businessName businessEmail ratingAverage");

    res.status(200).json({
      success: true,
      stores,
    });
  } catch (error: unknown) {
    console.error("Find nearby stores error:", error);
    const msg = error instanceof Error ? error.message : "Failed to query nearby stores.";
    res.status(500).json({ success: false, message: msg });
  }
}

// ==========================================
// 3. SHIPPING PROFILE UPDATE / DELETE
// ==========================================

/**
 * [UPDATE] Updates a shipping profile owned by the authenticated seller. (Seller Only)
 */
export async function updateShippingProfile(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as Record<string, string>;
    const seller = req.seller;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const profile = await ShippingProfile.findById(id);
    if (!profile) {
      res.status(404).json({ success: false, message: "Shipping profile not found." });
      return;
    }

    if (profile.sellerId.toString() !== seller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this shipping profile." });
      return;
    }

    const { name, processingDays, shippingType, baseChargePaise, codAvailable, freeShippingAbove } = req.body;

    if (name !== undefined) profile.name = name;
    if (processingDays !== undefined) profile.processingDays = processingDays;
    if (shippingType !== undefined) profile.shippingType = shippingType;
    if (baseChargePaise !== undefined) profile.baseChargePaise = baseChargePaise;
    if (codAvailable !== undefined) profile.codAvailable = codAvailable;
    if (freeShippingAbove !== undefined) profile.freeShippingAbove = freeShippingAbove;

    await profile.save();

    res.status(200).json({ success: true, message: "Shipping profile updated successfully.", profile });
  } catch (error: unknown) {
    console.error("Update shipping profile error:", error);
    const msg = error instanceof Error ? error.message : "Failed to update shipping profile.";
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * [DELETE] Removes a shipping profile. (Seller — own profile only; Admin — any)
 */
export async function deleteShippingProfile(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as Record<string, string>;
    const user = req.user as IUser;
    const seller = req.seller;

    const profile = await ShippingProfile.findById(id);
    if (!profile) {
      res.status(404).json({ success: false, message: "Shipping profile not found." });
      return;
    }

    if (user.role !== "admin" && (!seller || profile.sellerId.toString() !== seller._id.toString())) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this shipping profile." });
      return;
    }

    await ShippingProfile.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: "Shipping profile deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete shipping profile error:", error);
    res.status(500).json({ success: false, message: "Failed to delete shipping profile." });
  }
}

// ==========================================
// 4. SELLER STORE UPDATE / DELETE
// ==========================================

/**
 * [UPDATE] Updates a warehouse/store location owned by the authenticated seller. (Seller Only)
 */
export async function updateSellerStore(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as Record<string, string>;
    const seller = req.seller;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const store = await SellerStore.findById(id);
    if (!store) {
      res.status(404).json({ success: false, message: "Store not found." });
      return;
    }

    if (store.sellerId.toString() !== seller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this store." });
      return;
    }

    const { name, address, coordinates, isActive } = req.body;

    if (name !== undefined) store.name = name;
    if (address !== undefined) store.address = address;
    if (coordinates !== undefined && Array.isArray(coordinates) && coordinates.length === 2) {
      store.location = { type: "Point", coordinates };
    }
    if (typeof isActive === "boolean") store.isActive = isActive;

    await store.save();

    res.status(200).json({ success: true, message: "Store updated successfully.", store });
  } catch (error: unknown) {
    console.error("Update seller store error:", error);
    const msg = error instanceof Error ? error.message : "Failed to update store.";
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * [DELETE] Removes a warehouse/store. (Seller — own store only; Admin — any)
 */
export async function deleteSellerStore(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as Record<string, string>;
    const user = req.user as IUser;
    const seller = req.seller;

    const store = await SellerStore.findById(id);
    if (!store) {
      res.status(404).json({ success: false, message: "Store not found." });
      return;
    }

    if (user.role !== "admin" && (!seller || store.sellerId.toString() !== seller._id.toString())) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this store." });
      return;
    }

    await SellerStore.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: "Store deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete seller store error:", error);
    res.status(500).json({ success: false, message: "Failed to delete store." });
  }
}
