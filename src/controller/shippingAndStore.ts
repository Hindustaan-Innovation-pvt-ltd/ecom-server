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
