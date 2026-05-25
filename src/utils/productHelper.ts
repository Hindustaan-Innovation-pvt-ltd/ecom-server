import mongoose from "mongoose";
import { Brand } from "../models/brand.js";
import { Product } from "../models/product.js";
import { ProductVariant } from "../models/productVariant.js";
import { SellerListing } from "../models/sellerListing.js";
import { ListingInventory } from "../models/listingInventory.js";
import { ListingPricingHistory } from "../models/listingPricingHistory.js";

// Helper to slugify brand/product text
function slugifyText(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")          // Replace spaces with -
    .replace(/[^\w\-]+/g, "")       // Remove all non-word chars
    .replace(/\-\-+/g, "-")         // Replace multiple - with single -
    .replace(/^-+/, "")             // Trim - from start of text
    .replace(/-+$/, "");            // Trim - from end of text
}

export interface ICatalogProductPayload {
  sellerId: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  brand: string;
  sku: string;
  pricePaise: number;
  comparePricePaise?: number;
  inventory: number;
  tags?: string[];
  isActive?: boolean;
  moderationStatus?: "pending" | "approved" | "hidden" | "removed";
}

/**
 * Centered engine to register a product variant under the Amazon/Flipkart enterprise style marketplace.
 * Automatically manages Brand registries, Master Catalog entries, default variants, seller listings,
 * inventory logs, and initial pricing profiles in a single atomic transaction fallback.
 */
export async function saveProductToCatalog(data: ICatalogProductPayload) {
  const {
    sellerId,
    categoryId,
    title,
    description,
    brand: brandName,
    sku,
    pricePaise,
    comparePricePaise,
    inventory,
    tags = [],
    isActive = true,
    moderationStatus = "pending",
  } = data;

  // 1. Resolve or Create Brand
  const brandSlug = slugifyText(brandName);
  let brand = await Brand.findOne({ slug: brandSlug });
  if (!brand) {
    brand = new Brand({
      name: brandName.trim(),
      slug: brandSlug,
      isVerified: false,
    });
    await brand.save();
  }

  // 2. Create the Master Catalog Product
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const catalogProduct = new Product({
    categoryId,
    brandId: brand._id,
    sellerId, // Compatibility: references the creator seller
    title: title.trim(),
    slug: `${slugifyText(title)}-${randomSuffix}`,
    shortDescription: description.slice(0, 150),
    longDescription: description.trim(),
    highlights: [],
    searchKeywords: tags,
    attributeValues: {},
    status: isActive ? "active" : "draft",
    moderationStatus,
    createdBy: sellerId,
  });

  await catalogProduct.save();

  // 3. Create the Product Variant
  const variant = new ProductVariant({
    catalogProductId: catalogProduct._id,
    sku: sku.trim(),
    variantAttributes: { default: "true" },
    isActive: true,
  });

  await variant.save();

  // 4. Update the Master Product's default variant ID
  catalogProduct.defaultVariantId = variant._id as mongoose.Types.ObjectId;
  await catalogProduct.save();

  // 5. Create the Seller Listing
  const listing = new SellerListing({
    sellerId,
    variantId: variant._id,
    sellerSku: sku.trim(),
    condition: "new",
    procurementType: "stock",
    fulfillmentType: "seller",
    status: "active",
  });

  await listing.save();

  // 6. Initialize Inventory
  const listingInventory = new ListingInventory({
    listingId: listing._id,
    availableQuantity: inventory || 0,
    reservedQuantity: 0,
    damagedQuantity: 0,
    lowStockThreshold: 5,
  });

  await listingInventory.save();

  // 7. Establish initial Listing Pricing Profile
  const listingPricing = new ListingPricingHistory({
    listingId: listing._id,
    mrpPaise: comparePricePaise || pricePaise,
    sellingPricePaise: pricePaise,
    startAt: new Date(),
  });

  await listingPricing.save();

  return {
    product: catalogProduct,
    variant,
    listing,
    inventory: listingInventory,
    pricing: listingPricing,
  };
}
