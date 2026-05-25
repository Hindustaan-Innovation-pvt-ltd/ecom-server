# HMarketplace — Enterprise Product Management Database Tables
## Amazon / Flipkart Style Marketplace Product Architecture

---

# Architecture Philosophy

This architecture separates:

```yaml
Catalog Product:
  Shared product information

Product Variant:
  Actual purchasable variation

Seller Listing:
  Seller-specific product selling entry

Inventory:
  Warehouse/store stock tracking

Pricing:
  Dynamic seller pricing history

Attributes:
  Dynamic category specification system
```

---

# Core Product Tables

```yaml
categories
category_attribute_groups
category_attributes

brands

catalog_products

product_variants

product_media

seller_listings

listing_inventory

listing_pricing_history

inventory_logs

product_reviews

review_media

product_questions

product_answers

product_search_index

product_analytics

product_recommendations

product_moderation_logs

shipping_profiles

seller_stores
```

---

# 1. categories

Hierarchical category tree.

Example:
- Electronics
  - Mobiles
  - Laptops

```json
{
  "_id": "ObjectId",

  "name": "Mobiles",

  "slug": "mobiles",

  "parentId": "ObjectId",

  "level": 2,

  "path": [
    "electronics",
    "mobiles"
  ],

  "isLeaf": true,

  "sortOrder": 1,

  "isActive": true,

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

## Indexes

```yaml
- slug: unique
- parentId
- path
```

---

# 2. category_attribute_groups

Used to group specifications visually.

Example:
- General
- Display
- Battery
- Camera

```json
{
  "_id": "ObjectId",

  "categoryId": "ObjectId",

  "name": "Display",

  "sortOrder": 1
}
```

---

# 3. category_attributes

Dynamic product specification system.

This powers:
- filters
- product comparison
- search
- specifications

```json
{
  "_id": "ObjectId",

  "categoryId": "ObjectId",

  "groupId": "ObjectId",

  "name": "RAM",

  "slug": "ram",

  "type": "text | number | boolean | select",

  "unit": "GB",

  "isRequired": true,

  "isFilterable": true,

  "isComparable": true,

  "isVariantAttribute": false,

  "options": [
    "4",
    "6",
    "8",
    "12"
  ],

  "sortOrder": 1
}
```

## Important Notes

```yaml
isVariantAttribute:
  true:
    Used for variants
    Example:
      color
      size
      storage

  false:
    Product-level specs
    Example:
      battery
      display
      processor
```

---

# 4. brands

Brand registry system.

```json
{
  "_id": "ObjectId",

  "name": "Apple",

  "slug": "apple",

  "logoUrl": "string",

  "isVerified": true,

  "createdAt": "Date"
}
```

## Indexes

```yaml
- slug: unique
- name
```

---

# 5. catalog_products

MASTER PRODUCT.

Shared across all sellers.

Example:
- iPhone 15

NOT seller-specific.

```json
{
  "_id": "ObjectId",

  "categoryId": "ObjectId",

  "brandId": "ObjectId",

  "title": "Apple iPhone 15",

  "slug": "apple-iphone-15",

  "shortDescription": "string",

  "longDescription": "string",

  "highlights": [
    "48MP Camera",
    "A16 Bionic"
  ],

  "searchKeywords": [
    "iphone",
    "apple",
    "ios"
  ],

  "attributeValues": {
    "display_size": "6.1",
    "battery_capacity": "4000"
  },

  "defaultVariantId": "ObjectId",

  "status": "draft | active | blocked",

  "ratingAverage": 4.5,

  "reviewCount": 1000,

  "createdBy": "ObjectId",

  "approvedBy": "ObjectId",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

## Indexes

```yaml
- categoryId
- brandId
- slug: unique
- title
- searchKeywords
- status
```

---

# 6. product_variants

Actual purchasable product variation.

Example:
- Black 128GB
- Blue 256GB

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "sku": "IPH15-BLK-128",

  "variantAttributes": {
    "color": "Black",
    "storage": "128GB"
  },

  "barcode": "string",

  "weight": 0.5,

  "dimensions": {
    "length": 10,
    "width": 5,
    "height": 2
  },

  "isActive": true,

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

## Indexes

```yaml
- catalogProductId
- sku: unique
- barcode
```

---

# 7. product_media

Shared media system.

Supports:
- images
- videos
- 360 views

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "variantId": "ObjectId",

  "type": "image | video",

  "url": "string",

  "alt": "string",

  "sortOrder": 1,

  "isPrimary": true,

  "createdAt": "Date"
}
```

---

# 8. seller_listings

MOST IMPORTANT TABLE.

This is how Amazon works.

Multiple sellers can sell SAME variant.

```json
{
  "_id": "ObjectId",

  "sellerId": "ObjectId",

  "variantId": "ObjectId",

  "sellerSku": "SELLER-IPH15",

  "condition": "new | refurbished",

  "procurementType": "stock | dropship",

  "fulfillmentType": "seller | platform",

  "shippingProfileId": "ObjectId",

  "status": "active | paused | blocked",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

## Indexes

```yaml
- sellerId
- variantId
- status
```

---

# 9. listing_inventory

Inventory tracking.

Supports:
- multi-store inventory
- warehouse stock
- reserved inventory

```json
{
  "_id": "ObjectId",

  "listingId": "ObjectId",

  "storeId": "ObjectId",

  "availableQuantity": 10,

  "reservedQuantity": 2,

  "damagedQuantity": 0,

  "lowStockThreshold": 5,

  "updatedAt": "Date"
}
```

---

# 10. listing_pricing_history

Tracks all price changes.

```json
{
  "_id": "ObjectId",

  "listingId": "ObjectId",

  "mrpPaise": 8000000,

  "sellingPricePaise": 7499900,

  "discountPercentage": 6,

  "startAt": "Date",

  "endAt": "Date"
}
```

---

# 11. inventory_logs

Inventory audit system.

```json
{
  "_id": "ObjectId",

  "listingInventoryId": "ObjectId",

  "type": "sale | return | admin_update",

  "quantityBefore": 10,

  "quantityChanged": -1,

  "quantityAfter": 9,

  "reason": "Order #123",

  "performedBy": "ObjectId",

  "createdAt": "Date"
}
```

---

# 12. product_reviews

Review architecture.

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "variantId": "ObjectId",

  "listingId": "ObjectId",

  "userId": "ObjectId",

  "rating": 5,

  "title": "Excellent Product",

  "comment": "Very good quality",

  "verifiedPurchase": true,

  "helpfulVotes": 20,

  "status": "approved | hidden",

  "createdAt": "Date"
}
```

---

# 13. review_media

Review images/videos.

```json
{
  "_id": "ObjectId",

  "reviewId": "ObjectId",

  "type": "image | video",

  "url": "string",

  "createdAt": "Date"
}
```

---

# 14. product_questions

Amazon-style Q&A.

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "userId": "ObjectId",

  "question": "Does it support 5G?",

  "status": "approved",

  "createdAt": "Date"
}
```

---

# 15. product_answers

Answers system.

```json
{
  "_id": "ObjectId",

  "questionId": "ObjectId",

  "userId": "ObjectId",

  "answer": "Yes it supports 5G.",

  "isSellerAnswer": true,

  "helpfulVotes": 10,

  "createdAt": "Date"
}
```

---

# 16. product_search_index

Search optimization.

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "searchText": "iphone apple ios smartphone mobile",

  "keywords": [
    "iphone",
    "apple"
  ],

  "popularityScore": 100,

  "salesScore": 50,

  "reviewScore": 4.5,

  "updatedAt": "Date"
}
```

---

# 17. product_analytics

Analytics dashboard support.

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "views": 10000,

  "wishlistAdds": 500,

  "cartAdds": 200,

  "purchases": 100,

  "conversionRate": 2.5,

  "updatedAt": "Date"
}
```

---

# 18. product_recommendations

AI recommendation support.

```json
{
  "_id": "ObjectId",

  "productId": "ObjectId",

  "relatedProducts": [
    {
      "productId": "ObjectId",
      "score": 0.9
    }
  ],

  "updatedAt": "Date"
}
```

---

# 19. product_moderation_logs

Product moderation workflow.

```json
{
  "_id": "ObjectId",

  "catalogProductId": "ObjectId",

  "adminId": "ObjectId",

  "action": "approved | rejected | hidden",

  "reason": "Policy issue",

  "createdAt": "Date"
}
```

---

# 20. shipping_profiles

Shipping configuration system.

```json
{
  "_id": "ObjectId",

  "sellerId": "ObjectId",

  "name": "Standard Shipping",

  "processingDays": 2,

  "shippingType": "free | paid",

  "baseChargePaise": 4000,

  "createdAt": "Date"
}
```

---

# 21. seller_stores

Warehouse / pickup locations.

```json
{
  "_id": "ObjectId",

  "sellerId": "ObjectId",

  "name": "Main Warehouse",

  "address": {
    "line1": "string",
    "city": "string",
    "state": "string",
    "country": "string",
    "pincode": "string"
  },

  "location": {
    "type": "Point",
    "coordinates": [81.6296, 21.2514]
  },

  "isActive": true,

  "createdAt": "Date"
}
```

---

# Relationship Architecture

```yaml
Category:
  -> attributes
  -> products

Catalog Product:
  -> variants
  -> media
  -> analytics
  -> reviews
  -> search index

Variant:
  -> seller listings

Seller Listing:
  -> inventory
  -> pricing

Orders:
  -> seller listing
  -> variant
  -> product snapshot
```

---

# Enterprise Features Enabled

```yaml
Supports:
  - Multiple sellers per product
  - Dynamic specifications
  - Advanced filtering
  - AI recommendations
  - Product comparison
  - Smart search
  - Warehouse inventory
  - Seller inventory
  - Dynamic pricing
  - Product moderation
  - Product Q&A
  - Analytics dashboards
  - Brand registry
  - SEO optimized catalog
  - Infinite scaling
```