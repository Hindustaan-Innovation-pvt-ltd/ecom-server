/**
 * HMarketplace – Master Database Seeder & Pre-Authentication Engine
 * 1. Connects to MongoDB, clears all 22 collections, and seeds master tables.
 * 2. Seeds 1,000 Customer Users, 1,000 Addresses, 1 Category, 1 Seller User & Profile, 100 stores, 100 shipping profiles, 10 coupons, and 1,000 Products.
 * 3. Seeds 1,000 Carts, 1,000 Orders, 1,000 Coupon Usages, 1,000 Reviews, 1,000 Review Media, 1,000 Questions, 1,000 Answers, and 100 Webhooks.
 * 4. Programmatically signs and generates valid Passport session cookies offline.
 * 5. Saves the complete pre-authenticated session pool directly to postman/test_data.json.
 * 
 * Run: npm run seed
 */
import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

// Import actual Mongoose schemas directly for compile-time safety and collection-name consistency
import { User } from "@/models/user.js";
import { Seller } from "@/models/seller.js";
import { Category } from "@/models/category.js";
import { Brand } from "@/models/brand.js";
import { Product } from "@/models/product.js";
import { ProductVariant } from "@/models/productVariant.js";
import { SellerListing } from "@/models/sellerListing.js";
import { ListingInventory } from "@/models/listingInventory.js";
import { ListingPricingHistory } from "@/models/listingPricingHistory.js";
import { Address } from "@/models/address.js";
import { Cart } from "@/models/cart.js";
import { Coupon } from "@/models/coupon.js";
import { CouponUsage } from "@/models/couponUsage.js";
import { Order } from "@/models/order.js";
import { ProductAnswer } from "@/models/productAnswer.js";
import { ProductQuestion } from "@/models/productQuestion.js";
import { ProductImage } from "@/models/productImage.js";
import { Review } from "@/models/review.js";
import { ReviewMedia } from "@/models/reviewMedia.js";
import { SellerStore } from "@/models/sellerStore.js";
import { ShippingProfile } from "@/models/shippingProfile.js";
import { WebhookSubscription } from "@/models/webhookSubscription.js";

import { encryptPassword } from "@/utils/password.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/hmarketplace";
const COUNT = 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || "cookie-session-secret-key-for-hmarketplace";

// Self-contained offline session cookie generator compatible with cookie-session & keygrip
function generateSessionCookie(userId: string): string {
  const sessionData = { passport: { user: userId } };
  const sessionBase64 = Buffer.from(JSON.stringify(sessionData)).toString("base64");

  // Sign the session cookie value using SHA1 HMAC matching keygrip
  const hmacInput = "session=" + sessionBase64;
  const hmac = crypto.createHmac("sha1", SESSION_SECRET);
  const sig = hmac.update(hmacInput).digest("base64")
    .replace(/\/|\+|=/g, (x) => {
      return x === "/" ? "_" : x === "+" ? "-" : "";
    });

  return `session=${sessionBase64}; session.sig=${sig}`;
}

async function run() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected successfully.");

  // 1. Drop existing data in all 22 collections
  const models = [
    User, Seller, Category, Brand, Product, ProductVariant, SellerListing,
    ListingInventory, ListingPricingHistory, Address, Cart, Coupon, CouponUsage,
    Order, ProductAnswer, ProductQuestion, ProductImage, Review, ReviewMedia,
    SellerStore, ShippingProfile, WebhookSubscription
  ];

  console.log("Cleaning all 22 database collections...");
  for (const model of models) {
    await model.deleteMany({});
    console.log(`✔ Cleared collection for model: ${model.modelName}`);
  }

  // 2. Seed master Category
  console.log("Seeding default Category...");
  const category = await Category.create({
    name: "Electronics",
    slug: "electronics",
    level: 1,
    isActive: true,
  });

  // 3. Seed Brand
  console.log("Seeding default Brand...");
  const brand = await Brand.create({
    name: "Stress Brand",
    slug: "stress-brand",
    isVerified: true,
  });

  // 4. Seed Seller User & Profile
  console.log("Seeding default Seller User and Profile...");
  const sellerPassword = "Password123!";
  const sellerUser = await User.create({
    fullName: "Master Seller",
    email: "master.seller@hmarketplace.in",
    phone: "+918888888888",
    passwordHash: sellerPassword, // Handled by pre-save save hook for single encryption
    role: "seller",
    isActive: true,
  });

  console.log("Seeding default Admin User...");
  const adminPassword = "Password123!";
  await User.create({
    fullName: "Master Admin",
    email: "master.admin@hmarketplace.in",
    phone: "+919999999999",
    passwordHash: adminPassword, // Handled by pre-save save hook for single encryption
    role: "admin",
    isActive: true,
  });

  const seller = await Seller.create({
    userId: sellerUser._id,
    businessName: "Stress Testing Store",
    gstNumber: "27AAAAA0000A1Z5",
    businessPhone: "+918888888888",
    businessEmail: "master.seller@hmarketplace.in",
    approvalStatus: "approved",
    isActive: true,
  });

  // 5. Seed 100 Seller Stores (Warehouses)
  console.log("Seeding 100 Seller Stores (Warehouses) with coordinate offsets...");
  const storesToInsert = [];
  for (let i = 1; i <= 100; i++) {
    storesToInsert.push({
      sellerId: seller._id,
      name: `Stress Store ${String(i).padStart(2, "0")}`,
      address: {
        line1: `Warehouse Plot ${i}, Industrial Area Sector ${i % 5}`,
        city: "Mumbai",
        state: "Maharashtra",
        country: "India",
        pincode: "400001",
      },
      location: {
        type: "Point" as const,
        coordinates: [72.8777 + (i * 0.001), 19.0760 + (i * 0.001)], // Offset longitude, latitude in Mumbai area
      },
      isActive: true,
    });
  }
  await SellerStore.insertMany(storesToInsert);
  console.log(`✔ Successfully bulk-inserted 100 Seller Stores.`);

  // 6. Seed 100 Shipping Profiles
  console.log("Seeding 100 Shipping Profiles...");
  const shippingToInsert = [];
  for (let i = 1; i <= 100; i++) {
    shippingToInsert.push({
      sellerId: seller._id,
      name: `Stress Shipping ${String(i).padStart(2, "0")}`,
      processingDays: (i % 3) + 1,
      shippingType: i % 2 === 0 ? ("free" as const) : ("paid" as const),
      baseChargePaise: i % 2 === 0 ? 0 : 5000 + (i * 100),
    });
  }
  const seededShipping = await ShippingProfile.insertMany(shippingToInsert);
  console.log(`✔ Successfully bulk-inserted 100 Shipping Profiles.`);

  // 7. Seed 10 Coupons
  console.log("Seeding 10 Seller Coupon Campaigns...");
  const couponsToInsert = [];
  const couponCodes = ["SAVE10", "STRESS20", "SUPER30", "MEGA40", "ULTRA50", "HYPER60", "BOOST70", "RUSH80", "FLASH90", "MAX100"];
  for (let i = 0; i < 10; i++) {
    couponsToInsert.push({
      sellerId: seller._id,
      code: couponCodes[i],
      discountType: "percent" as const,
      discountValue: (i + 1) * 10,
      minOrderValue: 50000,
      maxDiscountValue: 10000,
      usageLimit: 10000,
      perUserLimit: 1,
      usedCount: 0,
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Active since yesterday
      endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Expirable in 1 year
      isActive: true,
    });
  }
  const seededCoupons = await Coupon.insertMany(couponsToInsert);
  console.log(`✔ Successfully bulk-inserted 10 Coupon campaigns.`);

  // 8. Seed 1,000 Customer Users & Shipping Addresses
  console.log(`Seeding ${COUNT} Customer Users & Addresses...`);
  const usersToInsert = [];
  const addressesToInsert = [];
  const generatedCredentials: any[] = [];

  for (let i = 1; i <= COUNT; i++) {
    const idx = String(i).padStart(4, "0");
    const userId = new mongoose.Types.ObjectId();
    const addressId = new mongoose.Types.ObjectId();
    const password = `SecurePass${idx}!`;
    const email = `customer.stress.${idx}@hmarketplace.in`;

    usersToInsert.push({
      _id: userId,
      fullName: `Stress Customer ${idx}`,
      email,
      phone: `+91987654${idx}`,
      passwordHash: encryptPassword(password), // Direct bypasses save hook on insertMany
      role: "customer",
      isActive: true,
    });

    addressesToInsert.push({
      _id: addressId,
      userId,
      fullName: `Stress Customer ${idx}`,
      phone: `+91987654${idx}`,
      label: "Home",
      line1: `Plot ${i}, Stress Road Sector ${i % 10}`,
      line2: `Landmark Lane ${idx}`,
      landmark: "Central Square Landmark",
      city: "Mumbai",
      state: "Maharashtra",
      country: "India",
      pincode: String(400000 + (i % 9999)).padStart(6, "0"),
      isDefault: true,
    });

    generatedCredentials.push({
      userId,
      addressId,
      email,
      password,
      pincode: String(400000 + (i % 9999)).padStart(6, "0"),
    });
  }

  const seededUsers = await User.insertMany(usersToInsert);
  const seededAddresses = await Address.insertMany(addressesToInsert);
  console.log(`✔ Successfully bulk-inserted ${COUNT} Customer profiles and Delivery Addresses.`);

  // 9. Seed 1,000 Products, Variants, Listings, Inventories, Pricings, Images
  console.log(`Seeding ${COUNT} Products, Variants, Listings, Inventories, Pricings, Images...`);
  const productsToInsert = [];
  const variantsToInsert = [];
  const listingsToInsert = [];
  const inventoriesToInsert = [];
  const pricingToInsert = [];
  const imagesToInsert = [];

  for (let i = 1; i <= COUNT; i++) {
    const idx = String(i).padStart(4, "0");
    const productId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();
    const listingId = new mongoose.Types.ObjectId();
    const sku = `SKU-STRESS-TWS-${idx}`;
    const pricePaise = 100000 + (i * 100);

    productsToInsert.push({
      _id: productId,
      categoryId: category._id,
      brandId: brand._id,
      sellerId: seller._id,
      title: `Stress Earbuds model ${idx}`,
      slug: `stress-earbuds-model-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      description: {
        short: `Short description for earbuds stress model ${idx}`,
        long: `Long description rich text for earbuds stress model ${idx}`,
      },
      shortDescription: `Short description for earbuds stress model ${idx}`,
      longDescription: `Long description rich text for earbuds stress model ${idx}`,
      highlights: ["Wireless Bluetooth 5.3", "IPX5 Waterproof"],
      searchKeywords: ["boat", "stress", "tws", "earbuds"],
      attributeValues: { color: "Jet Black" },
      specifications: { driver: "12mm" },
      richDescription: "Product Rich Text Description Block",
      seo: { metaTitle: `Earbuds ${idx}`, metaDescription: `Earbuds ${idx} TWS`, canonicalUrl: "" },
      status: "active",
      moderationStatus: "approved",
      defaultVariantId: variantId,
      createdBy: sellerUser._id,
    });

    variantsToInsert.push({
      _id: variantId,
      catalogProductId: productId,
      sku,
      variantAttributes: { color: "Jet Black", option1: "Jet Black" },
      dimensions: { length: 5, width: 4, height: 3, unit: "cm" },
      barcode: `8906109${idx}`,
      weight: 0.25,
      isActive: true,
    });

    listingsToInsert.push({
      _id: listingId,
      sellerId: seller._id,
      variantId,
      sellerSku: sku,
      condition: "new",
      procurementType: "stock",
      fulfillmentType: "seller",
      shippingProfileId: seededShipping[i % seededShipping.length]!._id,
      status: "active",
    });

    inventoriesToInsert.push({
      listingId,
      availableQuantity: 10000,
      reservedQuantity: 0,
      damagedQuantity: 0,
      lowStockThreshold: 5,
    });

    pricingToInsert.push({
      listingId,
      mrpPaise: pricePaise + 50000,
      sellingPricePaise: pricePaise,
      startAt: new Date(),
    });

    imagesToInsert.push({
      catalogProductId: productId,
      variantId,
      type: "image" as const,
      imageUrl: `https://picsum.photos/500/500?random=${i}`,
      alt: `Stress Earbuds model ${idx} product photo`,
      angle: "front" as const,
      sortOrder: 1,
      isPrimary: true,
    });

    // Save for interconnected seeding
    const cred = generatedCredentials[i - 1]!;
    cred.productId = productId;
    cred.variantId = variantId;
    cred.listingId = listingId;
    cred.sku = sku;
    cred.mrpPaise = pricePaise + 50000;
    cred.pricePaise = pricePaise;
    cred.title = `Stress Earbuds model ${idx}`;
  }

  await Product.insertMany(productsToInsert);
  await ProductVariant.insertMany(variantsToInsert);
  await SellerListing.insertMany(listingsToInsert);
  await ListingInventory.insertMany(inventoriesToInsert);
  await ListingPricingHistory.insertMany(pricingToInsert);
  await ProductImage.insertMany(imagesToInsert);
  console.log(`✔ Successfully seeded ${COUNT} Products, Variants, Listings, Inventories, Pricings, Images.`);

  // 10. Seed 1,000 Carts (Pre-filled with 1 random product listing snapshotted)
  console.log("Seeding 1,000 pre-filled customer Carts...");
  const cartsToInsert = [];
  for (let i = 0; i < COUNT; i++) {
    const cred = generatedCredentials[i]!;
    cartsToInsert.push({
      userId: cred.userId,
      items: [{
        productId: cred.productId,
        variantId: cred.variantId,
        quantity: 1,
        titleSnapshot: cred.title,
        imageSnapshot: `https://picsum.photos/500/500?random=${i + 1}`,
        pricePaiseSnapshot: cred.pricePaise,
      }],
      couponCode: i % 3 === 0 ? seededCoupons[i % seededCoupons.length]!.code : null,
    });
  }
  await Cart.insertMany(cartsToInsert);
  console.log(`✔ Successfully seeded 1,000 persistent Carts.`);

  // 11. Seed 1,000 Orders, Coupon Usages, and Reviews (Delivered Orders with Verified Purchases)
  console.log("Seeding 1,000 Delivered Orders, Coupon Usages, and Verified Reviews...");
  const ordersToInsert: any[] = [];
  const couponUsagesToInsert: any[] = [];
  const reviewsToInsert: any[] = [];

  for (let i = 0; i < COUNT; i++) {
    const cred = generatedCredentials[i]!;
    const orderId = new mongoose.Types.ObjectId();
    const address = seededAddresses[i]!;
    const coupon = seededCoupons[i % seededCoupons.length]!;

    const mrpTotal = cred.mrpPaise;
    const sellingTotal = cred.pricePaise;
    const isCouponApplied = i % 2 === 0; // 50% orders have coupons
    const couponDiscount = isCouponApplied ? Math.min(Math.floor(sellingTotal * (coupon.discountValue / 100)), coupon.maxDiscountValue || 10000) : 0;
    const orderTotal = sellingTotal - couponDiscount;

    ordersToInsert.push({
      _id: orderId,
      userId: cred.userId,
      addressId: address._id,
      addressSnapshot: {
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark || "",
        city: address.city,
        state: address.state,
        country: address.country,
        pincode: address.pincode,
      },
      items: [{
        productId: cred.productId,
        variantId: cred.variantId,
        listingId: cred.listingId,
        sellerId: seller._id,
        titleSnapshot: cred.title,
        imageSnapshot: `https://picsum.photos/500/500?random=${i + 1}`,
        sku: cred.sku,
        quantity: 1,
        mrpPaiseSnapshot: mrpTotal,
        sellingPricePaiseSnapshot: sellingTotal,
        couponDiscountPaiseForItem: couponDiscount,
      }],
      couponCode: isCouponApplied ? coupon.code : null,
      couponDiscountPaise: couponDiscount,
      mrpTotalPaise: mrpTotal,
      sellingTotalPaise: sellingTotal,
      productDiscountPaise: mrpTotal - sellingTotal,
      totalPaise: orderTotal,
      paymentStatus: "paid" as const,
      paymentMethod: "cod" as const,
      status: "delivered" as const,
      notes: "Delivery stress seed",
    });

    if (isCouponApplied) {
      couponUsagesToInsert.push({
        couponId: coupon._id,
        userId: cred.userId,
        orderId,
        discountPaise: couponDiscount,
        usedAt: new Date(),
      });
    }

    reviewsToInsert.push({
      _id: new mongoose.Types.ObjectId(), // Save review ID for media attachment
      catalogProductId: cred.productId,
      variantId: cred.variantId,
      listingId: cred.listingId,
      userId: cred.userId,
      rating: (i % 3) + 3, // Rating 3, 4, or 5
      title: i % 2 === 0 ? "Excellent earbuds!" : "Great value for money",
      comment: "Sound quality is very nice and charging backup is superb. Recommending this product.",
      verifiedPurchase: true,
      helpfulVotes: i % 5,
      status: "approved" as const,
    });

    // Mappings for offline pool compilation
    cred.addressId = address._id.toString();
  }

  const seededOrders = await Order.insertMany(ordersToInsert);
  const seededCouponUsages = await CouponUsage.insertMany(couponUsagesToInsert);
  const seededReviews = await Review.insertMany(reviewsToInsert);
  console.log(`✔ Successfully seeded ${COUNT} Orders, ${seededCouponUsages.length} Coupon Usages, and 1,000 Verified Reviews.`);

  // 12. Seed 1,000 Review Media (Photos attached to reviews)
  console.log("Seeding 1,000 Review Media documents...");
  const reviewMediaToInsert = [];
  for (let i = 0; i < COUNT; i++) {
    reviewMediaToInsert.push({
      reviewId: seededReviews[i]!._id,
      type: "image" as const,
      url: `https://picsum.photos/400/400?random=review_${i + 1}`,
    });
  }
  await ReviewMedia.insertMany(reviewMediaToInsert);
  console.log(`✔ Successfully seeded 1,000 Review Media files.`);

  // 13. Seed 1,000 Questions & 1,000 Seller Answers
  console.log("Seeding 1,000 Product Questions and Answers...");
  const questionsToInsert = [];
  for (let i = 0; i < COUNT; i++) {
    const cred = generatedCredentials[i]!;
    questionsToInsert.push({
      _id: new mongoose.Types.ObjectId(),
      catalogProductId: cred.productId,
      userId: cred.userId,
      question: i % 2 === 0 ? "Is it waterproof for running?" : "How long does the battery last?",
      status: "approved" as const,
    });
  }
  const seededQuestions = await ProductQuestion.insertMany(questionsToInsert);

  const answersToInsert = [];
  for (let i = 0; i < COUNT; i++) {
    const q = seededQuestions[i]!;
    answersToInsert.push({
      questionId: q._id,
      userId: sellerUser._id,
      answer: i % 2 === 0 ? "Yes, it is IPX5 rated, perfect for sweaty running sessions." : "It provides up to 35 hours of total playback time with charging case.",
      isSellerAnswer: true,
      helpfulVotes: i % 10,
    });
  }
  await ProductAnswer.insertMany(answersToInsert);
  console.log(`✔ Successfully seeded 1,000 Questions and answers.`);

  // 14. Seed 100 Webhook Subscriptions
  console.log("Seeding 100 Webhook Subscriptions...");
  const webhooksToInsert = [];
  for (let i = 0; i < 100; i++) {
    webhooksToInsert.push({
      userId: seededUsers[i % seededUsers.length]!._id,
      url: `https://webhook.site/mock-stress-hook-${i + 1}`,
      events: ["order.created", "product.created"],
      isActive: true,
    });
  }
  await WebhookSubscription.insertMany(webhooksToInsert);
  console.log(`✔ Successfully seeded 100 Webhook Subscriptions.`);

  // 15. Generate pre-authenticated session cookies offline
  console.log("\nGenerating pre-authenticated session cookies and JWT tokens offline...");
  const sessionPool = [];
  for (let i = 0; i < COUNT; i++) {
    const cred = generatedCredentials[i]!;
    const cookie = generateSessionCookie(cred.userId.toString());
    const token = jwt.sign(
      { userId: cred.userId.toString(), role: "customer" },
      process.env.JWT_SECRET || "super-secret-jwt-signing-key-for-hmarketplace-2026",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    sessionPool.push({
      customerEmail: cred.email,
      customerPassword: cred.password,
      userId: cred.userId.toString(),
      addressId: cred.addressId,
      productSku: cred.sku,
      variantId: cred.variantId.toString(),
      listingId: cred.listingId.toString(),
      sessionCookie: cookie,
      authToken: token,
    });
  }

  const outPath = path.join(__dirname, "../postman/test_data.json");
  fs.writeFileSync(outPath, JSON.stringify(sessionPool, null, 2), "utf8");

  console.log(`\n✔ 22-COLLECTION INTERCONNECTED SEEDING COMPLETED SUCCESSFULLY!`);
  console.log(`Saved ${sessionPool.length} pre-authenticated session datasets to: ${outPath}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

run().catch(err => {
  console.error("Critical Execution Error:", err);
  process.exit(1);
});
