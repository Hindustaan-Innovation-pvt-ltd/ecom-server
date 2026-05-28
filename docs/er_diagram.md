# HMarketplace — Entity Relationship (ER) Diagram & Route Operations Map

Below is the comprehensive architectural specification for the HMarketplace backend database. This document serves as a complete reference, containing the unified entity relationship structures, Mongoose schemas, and the explicit database interactions for every single API route.

---

## 📊 Database Relationship Diagram

```mermaid
erDiagram
    USER ||--o| SELLER : "onboards as (1:1)"
    USER ||--o{ ADDRESS : "has shipping address (1:N)"
    USER ||--o| CART : "owns (1:1)"
    USER ||--o{ PRODUCT : "created catalog entry (1:N)"
    USER ||--o{ COUPON_USAGE : "redeemed (1:N)"
    USER ||--o{ ORDER : "places (1:N)"
    USER ||--o{ WEBHOOK_SUBSCRIPTION : "registers (1:N)"
    USER ||--o{ REVIEW : "submits product reviews (1:N)"
    USER ||--o{ PRODUCT_QUESTION : "asks product Q&A (1:N)"
    USER ||--o{ PRODUCT_ANSWER : "posts answer replies (1:N)"
    
    SELLER ||--o{ PRODUCT : "supplies (1:N)"
    SELLER ||--o{ SELLER_LISTING : "owns selling listing (1:N)"
    SELLER ||--o{ COUPON : "issues promotional coupons (1:N)"
    SELLER ||--o{ ORDER_ITEM : "fulfills (1:N)"
    SELLER ||--o{ SHIPPING_PROFILE : "configures logistics pricing (1:N)"
    SELLER ||--o{ SELLER_STORE : "manages depot stores (1:N)"
    
    CATEGORY ||--o{ PRODUCT : "classifies (1:N)"
    CATEGORY ||--o{ CATEGORY : "has subcategory parentId (1:N)"
    CATEGORY ||--o{ COUPON : "scopable discount rules (1:N)"
    
    BRAND ||--o{ PRODUCT : "brands (1:N)"
    
    PRODUCT ||--o{ PRODUCT_IMAGE : "has additional photos (1:N)"
    PRODUCT ||--o{ PRODUCT_VARIANT : "has variations (1:N)"
    PRODUCT ||--o{ REVIEW : "attracts buyers reviews (1:N)"
    PRODUCT ||--o{ PRODUCT_QUESTION : "attracts product Q&A (1:N)"
    PRODUCT ||--o{ COUPON : "scopable discount rules (1:N)"
    
    PRODUCT_VARIANT ||--o{ SELLER_LISTING : "sold under listing (1:N)"
    PRODUCT_VARIANT ||--o{ REVIEW : "scoped review context (1:N)"
    
    SELLER_LISTING ||--|| LISTING_INVENTORY : "tracks available stock (1:1)"
    SELLER_LISTING ||--o{ LISTING_PRICING_HISTORY : "logs price variations (1:N)"
    SELLER_LISTING ||--o{ REVIEW : "scoped review context (1:N)"
    SELLER_LISTING ||--o{ COUPON : "scopable discount rules (1:N)"
    
    CART ||--o{ CART_ITEM : "contains embedded (1:N)"
    CART_ITEM }|--|| PRODUCT : "references (M:1)"
    CART_ITEM }|--|| PRODUCT_VARIANT : "references (M:1)"
 
    COUPON ||--o{ COUPON_USAGE : "has been used (1:N)"
    ORDER ||--o{ COUPON_USAGE : "associated with coupon ledger (1:N)"
 
    ORDER ||--o{ ORDER_ITEM : "contains embedded (1:N)"
    ORDER_ITEM }|--|| PRODUCT : "references (M:1)"
    ORDER_ITEM }|--|| PRODUCT_VARIANT : "references (M:1)"
    ORDER_ITEM }|--|| SELLER_LISTING : "references (M:1)"
 
    REVIEW ||--o{ REVIEW_MEDIA : "contains buyer photos/videos (1:N)"
    PRODUCT_QUESTION ||--o{ PRODUCT_ANSWER : "answered by Q&A replies (1:N)"
```

---

## 🗃️ Database Entities & Field Specifications

### 1. USER
```json
{
  "_id": "ObjectId",
  "fullName": "string",
  "email": "string [unique]",
  "phone": "string [unique]",
  "passwordHash": "string",
  "avatarUrl": "string",
  "role": "customer | seller | admin [default: customer]",
  "isActive": "boolean [default: true]",
  "lastLoginAt": "Date",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 2. SELLER
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId [ref: User, unique]",
  "businessName": "string",
  "gstNumber": "string [unique]",
  "businessPhone": "string",
  "businessEmail": "string",
  "approvalStatus": "pending | approved | rejected [default: pending]",
  "isKycCompleted": "boolean [default: false]",
  "rejectionReason": "string [default: '']",
  "approvedBy": "ObjectId [ref: User]",
  "approvedAt": "Date",
  "ratingAverage": "number [default: 0]",
  "totalSales": "number [default: 0]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 3. ADDRESS
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId [ref: User]",
  "fullName": "string",
  "phone": "string",
  "line1": "string",
  "line2": "string",
  "landmark": "string",
  "city": "string",
  "state": "string",
  "country": "string",
  "pincode": "string",
  "isDefault": "boolean [default: false]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 4. CATEGORY
```json
{
  "_id": "ObjectId",
  "name": "string",
  "slug": "string [unique]",
  "parentId": "ObjectId [ref: Category, null]",
  "level": "number [default: 1]",
  "path": "string[]",
  "isLeaf": "boolean [default: true]",
  "sortOrder": "number [default: 1]",
  "imageUrl": "string [default: '']",
  "isActive": "boolean [default: true]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 5. BRAND
```json
{
  "_id": "ObjectId",
  "name": "string",
  "slug": "string [unique]",
  "logoUrl": "string [default: '']",
  "isVerified": "boolean [default: false]",
  "createdBy": "ObjectId [ref: User, null]",
  "createdAt": "Date"
}
```

### 6. PRODUCT (Master Catalog)
```json
{
  "_id": "ObjectId",
  "categoryId": "ObjectId [ref: Category]",
  "brandId": "ObjectId [ref: Brand]",
  "sellerId": "ObjectId [ref: Seller, null]",
  "title": "string",
  "slug": "string [unique]",
  "description": {
    "short": "string",
    "long": "string"
  },
  "highlights": "string[]",
  "searchKeywords": "string[]",
  "attributeValues": "Mixed",
  "defaultVariantId": "ObjectId [ref: ProductVariant, null]",
  "status": "draft | active | blocked [default: active]",
  "moderationStatus": "pending | approved | hidden | removed [default: pending]",
  "moderationReason": "string [default: '']",
  "moderatedBy": "ObjectId [ref: User]",
  "ratingAverage": "number [default: 0]",
  "reviewCount": "number [default: 0]",
  "createdBy": "ObjectId [ref: User]",
  "approvedBy": "ObjectId [ref: User]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 7. PRODUCT_IMAGE
```json
{
  "_id": "ObjectId",
  "catalogProductId": "ObjectId [ref: Product]",
  "variantId": "ObjectId [ref: ProductVariant, null]",
  "type": "image | video [default: image]",
  "imageUrl": "string",
  "alt": "string [default: '']",
  "angle": "front | back | side | top | isometric | detail | lifestyle | other [default: null]",
  "sortOrder": "number [default: 0]",
  "isPrimary": "boolean [default: false]",
  "createdAt": "Date"
}
```

### 8. PRODUCT_VARIANT
```json
{
  "_id": "ObjectId",
  "catalogProductId": "ObjectId [ref: Product]",
  "sku": "string [unique]",
  "variantAttributes": "Record<string, string>",
  "barcode": "string [default: '']",
  "weight": "number [default: 0]",
  "dimensions": {
    "length": "number [default: 0]",
    "width": "number [default: 0]",
    "height": "number [default: 0]"
  },
  "isActive": "boolean [default: true]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 9. SELLER_LISTING
```json
{
  "_id": "ObjectId",
  "sellerId": "ObjectId [ref: Seller]",
  "variantId": "ObjectId [ref: ProductVariant]",
  "sellerSku": "string",
  "condition": "new | refurbished [default: new]",
  "procurementType": "stock | dropship [default: stock]",
  "fulfillmentType": "seller | platform [default: seller]",
  "shippingProfileId": "ObjectId [ref: ShippingProfile, null]",
  "status": "active | paused | blocked [default: active]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 10. LISTING_INVENTORY
```json
{
  "_id": "ObjectId",
  "listingId": "ObjectId [ref: SellerListing]",
  "availableQuantity": "number [default: 0]",
  "reservedQuantity": "number [default: 0]",
  "damagedQuantity": "number [default: 0]",
  "lowStockThreshold": "number [default: 5]"
}
```

### 11. LISTING_PRICING_HISTORY
```json
{
  "_id": "ObjectId",
  "listingId": "ObjectId [ref: SellerListing]",
  "mrpPaise": "number",
  "sellingPricePaise": "number",
  "endAt": "Date [null if currently active]",
  "startAt": "Date",
  "createdAt": "Date"
}
```

### 12. CART
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId [ref: User, unique]",
  "couponCode": "string [null]",
  "items": [
    {
      "productId": "ObjectId [ref: Product]",
      "variantId": "ObjectId [ref: ProductVariant, null]",
      "quantity": "number [min: 1]",
      "titleSnapshot": "string",
      "imageSnapshot": "string [default: '']",
      "pricePaiseSnapshot": "number"
    }
  ],
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 13. COUPON
```json
{
  "_id": "ObjectId",
  "sellerId": "ObjectId [ref: Seller]",
  "code": "string [unique]",
  "discountType": "percent | flat",
  "discountValue": "number",
  "minOrderValue": "number [default: 0]",
  "maxDiscountValue": "number",
  "usageLimit": "number",
  "perUserLimit": "number [default: 1]",
  "usedCount": "number [default: 0]",
  "startsAt": "Date",
  "endsAt": "Date",
  "isActive": "boolean [default: true]",
  "applicableProducts": "ObjectId[] [ref: Product]",
  "applicableCategories": "ObjectId[] [ref: Category]",
  "applicableListings": "ObjectId[] [ref: ProductVariant]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 14. COUPON_USAGE
```json
{
  "couponId": "ObjectId [ref: Coupon]",
  "userId": "ObjectId [ref: User]",
  "orderId": "ObjectId [ref: Order]",
  "discountPaise": "number",
  "usedAt": "Date"
}
```

### 15. ORDER
```json
{
  "_id": "ObjectId",
  "orderNumber": "string [unique]",
  "userId": "ObjectId [ref: User]",
  "addressId": "ObjectId [ref: Address]",
  "addressSnapshot": {
    "fullName": "string",
    "phone": "string",
    "line1": "string",
    "line2": "string",
    "landmark": "string",
    "city": "string",
    "state": "string",
    "country": "string",
    "pincode": "string"
  },
  "couponCode": "string",
  "couponDiscountPaise": "number [default: 0]",
  "mrpTotalPaise": "number",
  "sellingTotalPaise": "number",
  "productDiscountPaise": "number [default: 0]",
  "totalPaise": "number",
  "paymentStatus": "pending | paid | failed | refunded | partially_refunded [default: pending]",
  "paymentMethod": "cod",
  "status": "pending | confirmed | processing | shipped | delivered | cancelled | return_requested | returned [default: pending]",
  "notes": "string",
  "cancellationReason": "string [default: '']",
  "items": [
    {
      "productId": "ObjectId [ref: Product]",
      "variantId": "ObjectId [ref: ProductVariant, null]",
      "listingId": "ObjectId [ref: SellerListing, null]",
      "sellerId": "ObjectId [ref: Seller]",
      "titleSnapshot": "string",
      "imageSnapshot": "string [default: '']",
      "sku": "string",
      "quantity": "number [default: 1]",
      "mrpPaiseSnapshot": "number",
      "sellingPricePaiseSnapshot": "number",
      "couponDiscountPaiseForItem": "number"
    }
  ],
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 16. WEBHOOK_SUBSCRIPTION
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId [ref: User]",
  "url": "string",
  "secret": "string",
  "events": "string[]",
  "isActive": "boolean [default: true]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 17. REVIEW
```json
{
  "_id": "ObjectId",
  "catalogProductId": "ObjectId [ref: Product]",
  "variantId": "ObjectId [ref: ProductVariant, null]",
  "listingId": "ObjectId [ref: SellerListing, null]",
  "userId": "ObjectId [ref: User]",
  "rating": "number [1-5]",
  "title": "string",
  "comment": "string",
  "verifiedPurchase": "boolean [default: false]",
  "helpfulVotes": "number [default: 0]",
  "status": "pending | approved | hidden [default: approved]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 18. REVIEW_MEDIA
```json
{
  "_id": "ObjectId",
  "reviewId": "ObjectId [ref: Review]",
  "type": "image | video [default: image]",
  "url": "string",
  "createdAt": "Date"
}
```

### 19. PRODUCT_QUESTION
```json
{
  "_id": "ObjectId",
  "catalogProductId": "ObjectId [ref: Product]",
  "userId": "ObjectId [ref: User]",
  "question": "string",
  "status": "pending | approved | hidden [default: approved]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 20. PRODUCT_ANSWER
```json
{
  "_id": "ObjectId",
  "questionId": "ObjectId [ref: ProductQuestion]",
  "userId": "ObjectId [ref: User]",
  "answer": "string",
  "isSellerAnswer": "boolean [default: false]",
  "helpfulVotes": "number [default: 0]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 21. SHIPPING_PROFILE
```json
{
  "_id": "ObjectId",
  "sellerId": "ObjectId [ref: Seller]",
  "name": "string",
  "processingDays": "number",
  "shippingType": "free | paid [default: free]",
  "baseChargePaise": "number [default: 0]",
  "codAvailable": "boolean [default: true]",
  "freeShippingAbove": "number [default: null]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### 22. SELLER_STORE
```json
{
  "_id": "ObjectId",
  "sellerId": "ObjectId [ref: Seller]",
  "name": "string",
  "address": {
    "line1": "string",
    "city": "string",
    "state": "string",
    "country": "string",
    "pincode": "string"
  },
  "location": {
    "type": "Point",
    "coordinates": "number[]"
  },
  "isActive": "boolean [default: true]",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

---

## 🛣️ HTTP Route Map & Entity Operations Flow

This section details how Express route requests interact with the database collections.

```
[HTTP Request] ──(Route Path)──> [Controller Action] ──(Queries/Updates)──> [MongoDB Database]
```

### 1. Authentication & Users (`/api/auth`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | *Multer (Avatar Upload)* | Creates a new `USER` document. If Redis is active, buffers to a Redis Set before write-back worker flushes to DB. |
| `POST` | `/login` | *Passport Local Strategy* | Verifies `USER` password, updates `USER.lastLoginAt`, and establishes Passport session. |
| `POST` | `/logout` | *authenticateUser* | Terminates active user session cookie. |
| `GET` | `/me` | *authenticateUser* | Reads active `USER` session, populates and attaches the user's `SELLER` profile details. |
| `GET` | `/users` | *authenticateUser + requireRoles("admin")* | Reads all `USER` records from DB (excluding password hashes). |
| `GET` | `/users/:id` | *authenticateUser* | Retrieves `USER` profile by direct ID parameter. (Self or Admin Only). |
| `PUT` | `/me` | *authenticateUser + Multer* | Updates own fields on the `USER` model, replaces user avatar picture. |
| `PUT` | `/users/:id/status`| *authenticateUser + requireRoles("admin")* | Toggles `USER.isActive` boolean (suspends or activates user). |
| `DELETE` | `/me` | *authenticateUser* | Deletes own `USER` profile and cascades to delete associated `SELLER` document. |
| `DELETE` | `/users/:id` | *authenticateUser + requireRoles("admin")* | Admin force-deletes `USER` profile and cascades to delete associated `SELLER` document. |

### 2. Sellers Onboarding & Management (`/api/seller`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | *Multer* | Decoupled seller onboarding. Creates `USER` with role `"seller"`, then provisions `SELLER` with pending approval. |
| `GET` | `/profile` | *authenticateUser + requireRoles("seller")*| Fetches the logged in seller's `SELLER` database record. |
| `GET` | `/` | *authenticateUser + requireRoles("admin")*| Retrieves a list of all `SELLER` profiles, filtering by approval status. |
| `GET` | `/:id` | *None* | Public route. Retrieves public seller contact info by ID. |
| `PUT` | `/profile` | *authenticateUser + requireRoles("seller")*| Updates own `SELLER` business attributes. |
| `PUT` | `/:id/status` | *authenticateUser + requireRoles("admin")*| Updates `SELLER.approvalStatus` ("approved" \| "rejected"), triggers `isKycCompleted: true` upon approval, and issues background decision email. |
| `DELETE`| `/profile` | *authenticateUser + requireRoles("seller")*| Deletes `SELLER` document and reverts user's `USER.role` to `"customer"`. |
| `DELETE`| `/:id` | *authenticateUser + requireRoles("admin")*| Admin force-deletes `SELLER` profile and the referenced `USER` record. |
| `GET` | `/analytics/dashboard`| *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Compiles seller analytics statistics (revenue, items sold, low stock warehouse alerts, recent reviews) from database and caches results in Redis. |
| `POST` | `/listings` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Creates a new `SELLER_LISTING` offer for a variant, and initializes matching `LISTING_INVENTORY` and active `LISTING_PRICING_HISTORY` records. |
| `GET` | `/listings` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Returns the seller's `SELLER_LISTING` documents, populating and attaching active inventory levels and selling price snapshots. |
| `PUT` | `/listings/:id` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Modifies listing status or details. If price is updated, closes active `LISTING_PRICING_HISTORY` and inserts a new historical price entry. |
| `DELETE`| `/listings/:id` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Cascades deletions across `SELLER_LISTING`, associated `LISTING_INVENTORY`, and all `LISTING_PRICING_HISTORY` logs. |
| `POST` | `/brands` | *authenticateUser + requireRoles("seller") + requireApprovedSeller + Multer*| Submits a custom brand onboarding request (`BRAND`) with pending unverified status (`isVerified: false`). |
| `GET` | `/brands` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Returns list of custom `BRAND` documents registered by this seller. |
| `PUT` | `/brands/:id/status`| *authenticateUser + requireRoles("admin")* | Admin approval toggle. Approves or revokes custom brand registration status (`BRAND.isVerified`). |

### 3. Addresses Management (`/api/address`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | *authenticateUser* | Saves a new `ADDRESS` record. If marked default, clears other user addresses' default bit. |
| `GET` | `/` | *authenticateUser* | Lists all shipping `ADDRESS` records belonging to the caller `userId`, sorting default address first. |
| `GET` | `/:id` | *authenticateUser* | Retrieves shipping `ADDRESS` by direct ID. (Owner or Admin only). |
| `PUT` | `/:id` | *authenticateUser* | Edits specific address. (Ownership enforced). |
| `DELETE` | `/:id` | *authenticateUser* | Deletes target `ADDRESS` document and promotes the next address to default automatically if the deleted item was default. |

### 4. Catalog Products & Categories (`/api/product`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/categories` | *authenticateUser + requireRoles("admin")*| Creates a new category entry (`CATEGORY`) and invalidates cache keys. |
| `GET` | `/categories` | *None* | Fetches active categories from cache if present; otherwise, queries `CATEGORY` and caches results in Redis. |
| `GET` | `/brands` | *None* | Fetches public catalog of verified system brands and approved custom seller brands (`BRAND.isVerified === true`). |
| `POST` | `/` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Directly registers a new catalog `PRODUCT`. Automatically parses standard JSON payload or YAML formatted layouts. Instantly approved for KYC sellers. |
| `GET` | `/` | *None* | Advanced products search listing. Joins variants, listings, and pricing history models to calculate faceted price bounds, returning paginated products, cached in Redis. |
| `GET` | `/slug/:slug` | *None* | Fetches detailed product view by unique slug, populating `PRODUCT_IMAGE`s, `PRODUCT_VARIANT`s, and active `SELLER_LISTING`s with warehouse stock. |
| `PUT` | `/:id` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Edits catalog product metadata (`PRODUCT`). Supports standard JSON and YAML payload overrides. (Owner Only). |
| `DELETE`| `/:id` | *authenticateUser + requireRoles("seller", "admin") + requireApprovedSeller*| Performs cascading deletions on catalog `PRODUCT` and all referenced variants, listings, media assets, inventories, and pricing histories. |

### 5. Media Uploads & Variants (`/api/product`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/:id/images` | *authenticateUser + requireRoles("seller") + requireApprovedSeller + Multer* | Uploads product images array to Cloudinary, saving up to 10 entries to `PRODUCT_IMAGE` database records. |
| `DELETE`| `/images/:imageId`| *authenticateUser + requireRoles("seller") + requireApprovedSeller* | Removes specific media record from `PRODUCT_IMAGE` database and Cloudinary storage. |
| `GET` | `/variants/:id`| *authenticateUser* | Retrieves single `PRODUCT_VARIANT` details. |
| `GET` | `/:id/variants`| *authenticateUser* | Returns array of all `PRODUCT_VARIANT` documents belonging to the catalog product ID. |
| `POST` | `/:id/variants`| *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Creates a new `PRODUCT_VARIANT` and automatically inserts a `SELLER_LISTING`, `LISTING_INVENTORY`, and `LISTING_PRICING_HISTORY`. |
| `PUT` | `/variants/:variantId`| *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Updates variant attributes, SKUs, and dynamically updates inventory levels and pricing entries. |
| `DELETE`| `/variants/:variantId`| *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Deletes variant and performs cascading deletions on related listing components. |

### 6. Cart PERSISTENCE & Shopping Sessions (`/api/cart`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | *authenticateUser + requireRoles("customer", "seller", "admin")* | Retrieves customer's `CART`, executing real-time pricing updates and dynamic coupon validity calculations. |
| `POST` | `/add` | *authenticateUser + requireRoles("customer", "seller", "admin")* | Appends item to `CART.items` array. Fallback variant resolver checks first product variants if variantId is not specified. Runs active stock and best price lookups. |
| `POST` | `/sync` | *authenticateUser + requireRoles("customer", "seller", "admin")* | Synchronizes database cart with the frontend shopping state, overwriting `CART.items` and re-evaluating coupons. |
| `DELETE`| `/` | *authenticateUser + requireRoles("customer", "seller", "admin")* | Empties the customer's `CART` document, clearing items and coupon codes. |
| `POST` | `/coupon` | *authenticateUser + requireRoles("customer", "seller", "admin")* | Attaches coupon code to `CART.couponCode` after checking dates, global limits, user limits, minimum subtotals, and seller product scopes. |
| `DELETE`| `/coupon` | *authenticateUser + requireRoles("customer", "seller", "admin")* | Removes coupon and detaches it from the user's `CART`. |

### 7. Coupons campaigns (`/api/coupons`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Creates a promotional `COUPON` scoped to specific product, category, or listing parameters. |
| `GET` | `/my` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Fetches active coupon list owned by the seller. |
| `DELETE`| `/:id` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Removes a `COUPON` from availability. |
| `POST` | `/validate`| *authenticateUser* | Verifies coupon eligibility against order values, seller, and user limits, returning the calculated Paise discount value. |

### 8. Order Placement & FulfIllment (`/api/orders`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | *authenticateUser* | Processes checkout inside a transaction: validates stock, calculates discounts, saves `ORDER` with embedded `ORDER_ITEM`s, reduces `LISTING_INVENTORY` atomically, logs `COUPON_USAGE`, flushes the user's `CART`, and dispatches order-creation webhooks. |
| `GET` | `/` | *authenticateUser* | Retrieves order history for the logged in buyer `USER`. |
| `GET` | `/seller` | *authenticateUser* | Seller orders lookup. Returns paginated list of orders containing items supplied by this seller. |
| `GET` | `/:orderId`| *authenticateUser* | Retrieves specific order details (Ownership or Admin enforced). |
| `POST` | `/:orderId/cancel`| *authenticateUser* | Cancels `ORDER` (if pending/confirmed), restocks warehouse inventory, reverses coupon counters, and triggers order cancellation webhooks. |
| `PATCH` | `/:orderId/status`| *authenticateUser* | Updates order delivery status sequence (confirmed -> processing -> shipped -> delivered return) if performed by Admin or the supplier seller. |

### 9. Product Reviews & Media (`/api`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/product/:id/reviews`| *authenticateUser* | Submits product rating review. Creates `REVIEW` and optional `REVIEW_MEDIA` records, then recalculates `PRODUCT.ratingAverage` and `PRODUCT.reviewCount` dynamically. |
| `GET` | `/product/:id/reviews`| *None* | Public route. Lists approved `REVIEW` records populated with user profiles and review media, and returns aggregated rating break-down stats. |
| `POST` | `/reviews/:reviewId/helpful`| *authenticateUser* | Increments the helpful votes counter (`REVIEW.helpfulVotes`) on a product review. |

### 10. Product Q&A Systems (`/api`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/product/:id/questions`| *authenticateUser* | Submits buyer question to `PRODUCT_QUESTION` model. |
| `GET` | `/product/:id/questions`| *None* | Public route. Retrieves paginated, approved questions for a product. |
| `POST` | `/question/:questionId/answers`| *authenticateUser* | Submits answer to `PRODUCT_ANSWER` model, automatically marking `isSellerAnswer` true if answered by the creator seller. |
| `GET` | `/question/:questionId/answers`| *None* | Public route. Retrieves question answers sorted by helpful votes. |

### 11. Shipping Logistics (`/api`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/shipping` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Configures custom logistics rules, saving to the `SHIPPING_PROFILE` collection. |
| `GET` | `/shipping` | *authenticateUser + requireRoles("seller", "admin") + requireApprovedSeller*| Returns shipping options registered to the caller seller. (Admins can filter by sellerId query). |

### 12. Depots & Warehouse Stores (`/api`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/stores` | *authenticateUser + requireRoles("seller") + requireApprovedSeller*| Registers a fulfillment center location to the `SELLER_STORE` collection. Coordinates are saved as a GeoJSON Point for spatial calculations. |
| `GET` | `/stores` | *authenticateUser + requireRoles("seller", "admin") + requireApprovedSeller*| Returns active warehouse store locations belonging to the seller. (Admins can filter by sellerId query). |
| `GET` | `/stores/nearby`| *None* | Public route. Performs geospatial spatial queries using Mongo `$near` within a circular radius to find nearby active warehouse store depots. |

### 13. Outgoing Webhooks (`/api/webhooks`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | *authenticateUser + requireRoles("seller", "admin")* | Registers an outgoing webhook destination (`WEBHOOK_SUBSCRIPTION`) with an auto-generated HMAC cryptographic signature verification key. |
| `GET` | `/` | *authenticateUser + requireRoles("seller", "admin")* | Lists active webhook subscriptions registered to the active seller/admin. |
| `DELETE` | `/:id` | *authenticateUser + requireRoles("seller", "admin")* | Removes a webhook subscription. (Ownership or Admin enforced). |

### 14. Platform Admin Subsystem (`/api/admin`)

| Method | Endpoint Path | Middlewares | Operations on Entities |
| :--- | :--- | :--- | :--- |
| `POST` | `/expenses` | *authenticateUser + requireRoles("admin")* | Saves an administrative operational platform expense. |
| `GET` | `/expenses` | *authenticateUser + requireRoles("admin")* | Returns paginated platform expenses, filterable by date and category. |
| `GET` | `/expenses/summary`| *authenticateUser + requireRoles("admin")* | Aggregates all order revenues against administrative expenses and discount coupon totals to compute active profit Rupee margins. |
| `GET` | `/audit-logs` | *authenticateUser + requireRoles("admin")* | Lists platform operations admin audit logs. |
| `GET` | `/moderation/products`| *authenticateUser + requireRoles("admin")* | Returns paginated list of catalog products awaiting moderation review. |
| `POST` | `/moderation/products/bulk`| *authenticateUser + requireRoles("admin")* | Bulk moderation decision. Batch approves, rejects, or hides catalog products, and queues notifications alerts for sellers. |
