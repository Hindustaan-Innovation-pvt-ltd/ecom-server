# HMarketplace API — Developer Reference Manual

This manual provides the technical specification for all endpoints inside the **HMarketplace Backend** API server.

---

## 1. Global Client Specifications

### Authentication Protocols
HMarketplace supports two parallel state tracking methods:

1. **Stateful Cookie Sessions**: The backend utilizes `cookie-session` storage managed by passport serialization. Responses return a session cookie. Succeeding requests must provide these headers:
   - `Cookie`: `session=<sessionBase64>; session.sig=<signature>`
2. **Stateless Bearer JWT Tokens**: Responses return a JSON Web Token upon registration or login. Succeeding requests must provide:
   - `Authorization`: `Bearer <JWT_TOKEN>`

### Standardized JSON Response Structures
All API endpoints respond with a consistent JSON payload wrapper:

**Success Response (200 / 201):**
```json
{
  "success": true,
  "message": "Action completed successfully.",
  "data": { ... }
}
```

**Error Response (400 / 401 / 403 / 404 / 409 / 422 / 500):**
```json
{
  "success": false,
  "message": "Detailed error description here."
}
```

### Rate Limiting Rules
Sensitive auth endpoints (`/api/auth/register`, `/api/auth/login`, `/api/seller/register`) are throttled at 10 requests per minute. All general `/api` routes are rate-limited to 500 requests per 15 minutes per IP address in production.

---

## 2. Authentication & User Management Module (`/api/auth`)

### 1. Register User (Customer/Admin)
Registers a standard user account. Direct seller registrations are forbidden here.
- **Path**: `POST /api/auth/register`
- **Content-Type**: `multipart/form-data`
- **Body Fields**:
  - `fullName` (String, Required, min 2 chars): Full name.
  - `email` (String, Required, Unique): Email address.
  - `phone` (String, Required, Unique): Mobile phone number.
  - `password` (String, Required): Account password.
  - `role` (String, Optional): `"customer"` or `"admin"`. (Defaults to `"customer"`).
  - `avatar` (File, Optional): Avatar image file (png, jpg, jpeg, webp, gif under 5MB).
- **Responses**:
  - `201 Created`: Returns the User profile and JWT token.
  - `202 Accepted` (Production Mode): Signup payload is buffered into Redis and bulk-flushed via BullMQ write-back workers every 10 seconds.
  - `400 Bad Request`: Missing fields or duplicate credentials.

### 2. User Credentials Login
Verifies credentials and establishes active sessions.
- **Path**: `POST /api/auth/login`
- **Content-Type**: `application/json`
- **Body Fields**:
  - `emailOrPhone` (String, Required): Active email or phone number.
  - `password` (String, Required): Account password.
- **Responses**:
  - `200 OK`: Returns logged-in User profile, session cookies, and fresh JWT token.
  - `401 Unauthorized`: Invalid credentials or suspended account.

### 3. User Session Logout
Destroys the current passport session and clears cookies.
- **Path**: `POST /api/auth/logout`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Confirmation of successful logout.

### 4. Read Active Session Profile
Retrieves the logged-in profile context.
- **Path**: `GET /api/auth/me`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Returns the authenticated user record. If user has role `"seller"`, the linked business `Seller` profile is populated and attached.

### 5. Read All Users List (Admin Only)
- **Path**: `GET /api/auth/users`
- **Headers**: Required Admin Authentication.
- **Query Params**:
  - `page` (Number, Optional): Defaults to 1.
  - `limit` (Number, Optional): Defaults to 10.
- **Responses**:
  - `200 OK`: Paginated list of all users, excluding password hashes.

### 6. Read Specific User Profile
- **Path**: `GET /api/auth/users/:id`
- **Headers**: Required Authentication. (Self or Admin Only).
- **Responses**:
  - `200 OK`: Populated user profile.
  - `404 Not Found`: User does not exist.

### 7. Update Active User Profile (Self Only)
- **Path**: `PUT /api/auth/me`
- **Content-Type**: `multipart/form-data` / `application/json`
- **Headers**: Required Authentication.
- **Body Fields** (All Optional): `fullName`, `email`, `phone`, `password`, `avatar` (File).
- **Responses**:
  - `200 OK`: Returns the updated user profile.

### 8. Suspend or Reactivate User (Admin Only)
Toggles account status. Suspended users are kicked from sessions.
- **Path**: `PUT /api/auth/users/:id/status`
- **Headers**: Required Admin Authentication.
- **Body Fields**:
  - `isActive` (Boolean, Required): User state.
- **Responses**:
  - `200 OK`: Status toggle success confirmation. Triggers an `USER_STATUS_UPDATE` audit log.

### 9. Self Account Deletion (Self Only)
Purges own profiles and cascades linked seller records.
- **Path**: `DELETE /api/auth/me`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Deletion confirmation.

### 10. Force Delete User (Admin Only)
- **Path**: `DELETE /api/auth/users/:id`
- **Headers**: Required Admin Authentication.
- **Responses**:
  - `200 OK`: Cascade delete complete. Triggers an `USER_DELETED` audit log.

---

## 3. Seller Onboarding & Management Module (`/api/seller`)

Sellers must register through a dual transactional rollback onboarding pipeline. All seller-restricted actions are locked behind KYC verification (`isKycCompleted === true`).

### 1. Onboard / Register Seller
- **Path**: `POST /api/seller/register`
- **Content-Type**: `multipart/form-data`
- **Body Fields**:
  - `fullName`, `email`, `phone`, `password` (User credentials fields).
  - `businessName` (String, Required): Registered trade name.
  - `gstNumber` (String, Required): Indian GSTIN (e.g. `27AAAAA0000A1Z5`).
  - `businessPhone` (String, Required): Office number.
  - `businessEmail` (String, Required): Support email.
  - `avatar` (File, Optional): Seller profile logo.
- **Responses**:
  - `201 Created`: Registers user with `role: "seller"` and creates a pending `Seller` record. 
  - **Transaction Rollback**: If the seller profile fails verification checks (like duplicate GST), the newly created User account is deleted automatically to keep the database consistent.

### 2. Read Own Seller Profile
- **Path**: `GET /api/seller/profile`
- **Headers**: Required Seller Authentication.
- **Responses**:
  - `200 OK`: Returns business parameters.

### 3. Read All Registered Sellers List (Admin Only)
- **Path**: `GET /api/seller`
- **Headers**: Required Admin Authentication.
- **Query Params**:
  - `status` (String, Optional): `"pending" | "approved" | "rejected"`.
- **Responses**:
  - `200 OK`: Populated list of seller documents.

### 4. Read Specific Seller (Public)
Publicly exposes seller rankings and details.
- **Path**: `GET /api/seller/:id`
- **Responses**:
  - `200 OK`: Public business stats.

### 5. Update Own Seller Business
- **Path**: `PUT /api/seller/profile`
- **Headers**: Required Seller Authentication.
- **Body Fields** (All Optional): `businessName`, `businessPhone`, `businessEmail`, `gstNumber`.
- **Responses**:
  - `200 OK`: Returns the updated business record.

### 6. Approve / Reject Seller Onboarding (Admin Only)
Verifies business details. Setting status to approved completes their KYC.
- **Path**: `PUT /api/seller/:id/status`
- **Headers**: Required Admin Authentication.
- **Body Fields**:
  - `approvalStatus` (String, Required): `"approved" | "rejected" | "pending"`.
  - `rejectionReason` (String, Required if rejected).
- **Responses**:
  - `200 OK`: Confirms status modification. 
    - Approving sets `isKycCompleted: true` on the `Seller` document, allowing them to list catalog items.
    - Triggers a `SELLER_STATUS_UPDATE` audit log.
    - Dispatches a background decision notification email to the seller.

### 7. Delete Own Seller Business
Removes business profile.
- **Path**: `DELETE /api/seller/profile`
- **Headers**: Required Seller Authentication.
- **Responses**:
  - `200 OK`: Seller document deleted. Reverts user's account role back to `"customer"`.

### 8. Force Delete Seller Account (Admin Only)
- **Path**: `DELETE /api/seller/:id`
- **Headers**: Required Admin Authentication.
- **Responses**:
  - `200 OK`: Cascadable purging complete. Triggers a `SELLER_DELETED` audit log.

### 9. Read Seller Dashboard Analytics
- **Path**: `GET /api/seller/analytics/dashboard`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Query Params**:
  - `threshold` (Number, Optional): Low stock alert count (Defaults to 5).
- **Responses**:
  - `200 OK`: Returns dynamic metrics (revenues, items sold, low stock alerts, recent product reviews) cached in Redis.

### 10. Create Seller Listing
Adds an active seller listing offer for an existing catalog variant. Automatically initializes inventory and pricing logs.
- **Path**: `POST /api/seller/listings`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Body Fields**:
  - `variantId` (String, Required): Target variant ObjectId.
  - `sellerSku` (String, Required): Unique SKU code.
  - `condition` (String, Optional): `"new" | "refurbished" | "used"`. (Defaults to `"new"`).
  - `procurementType` (String, Optional): `"stock" | "express" | "import"`. (Defaults to `"stock"`).
  - `fulfillmentType` (String, Optional): `"seller" | "marketplace"`. (Defaults to `"seller"`).
  - `shippingProfileId` (String, Optional): Shipping profile ObjectId.
  - `availableQuantity` (Number, Optional): Stock quantity. (Defaults to 0).
  - `pricePaise` (Number, Required): Unit selling price in Paise.
  - `comparePricePaise` (Number, Optional): Compare/MRP price in Paise.
- **Responses**:
  - `201 Created`: Offer listing successfully registered with inventory and pricing details.
  - `409 Conflict`: Listing already exists for this variant by the seller.

### 11. Get My Seller Listings
- **Path**: `GET /api/seller/listings`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Query Params**:
  - `page` (Number, Optional): Page number.
  - `limit` (Number, Optional): Page size.
- **Responses**:
  - `200 OK`: Paginated list of seller listings with active inventory levels and selling price snapshots.

### 12. Update Seller Listing
Updates pricing profile history, stock levels, or status configurations.
- **Path**: `PUT /api/seller/listings/:id`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Body Fields** (All Optional):
  - `status` (String): `"active" | "paused" | "blocked"`.
  - `procurementType` (String): Procurement type description.
  - `fulfillmentType` (String): Fulfillment channel description.
  - `shippingProfileId` (String / null): Shipping profile ID.
  - `availableQuantity` (Number): Adjust stock quantity.
  - `pricePaise` (Number): Update unit price in Paise. (Automatically creates a new pricing snapshot).
  - `comparePricePaise` (Number): Update compare/MRP price in Paise.
- **Responses**:
  - `200 OK`: Listing updated.

### 13. Delete Seller Listing
- **Path**: `DELETE /api/seller/listings/:id`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Responses**:
  - `200 OK`: Listing and related inventory/pricing records deleted.

### 14. Register Brand
Submits a custom brand onboarding request.
- **Path**: `POST /api/seller/brands`
- **Content-Type**: `multipart/form-data`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Body Fields**:
  - `name` (String, Required): Custom brand name.
  - `logo` (File, Optional): Brand logo image.
- **Responses**:
  - `201 Created`: Brand registry request submitted. Brand is registered with `isVerified: false`, awaiting admin verification.

### 15. Get My Brands
- **Path**: `GET /api/seller/brands`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Responses**:
  - `200 OK`: Returns array of brand documents registered by the seller.

### 16. Update Brand Verification Status (Admin Only)
- **Path**: `PUT /api/seller/brands/:id/status`
- **Headers**: Required Admin Authentication.
- **Body Fields**:
  - `isVerified` (Boolean, Required): Custom brand verification status.
- **Responses**:
  - `200 OK`: Verification status successfully modified.

---

## 4. Address Management Module (`/api/address`)

Protects delivery calculations with Indian mobile and pincode limits.

### 1. Add Shipping Address
- **Path**: `POST /api/address`
- **Content-Type**: `application/json`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `fullName` (String, Required): Addressee full name.
  - `phone` (String, Required): Indian phone format.
  - `line1` (String, Required): Door/Plot details.
  - `line2` (String, Required): Locality details.
  - `landmark` (String, Required): Proximity hint.
  - `city` (String, Required): District.
  - `state` (String, Required): Indian State or Union Territory name.
  - `pincode` (String, Required): 6-digit Indian PIN code starting with `1-9`.
  - `isDefault` (Boolean, Optional): Set default shipping choice.
- **Responses**:
  - `201 Created`: Address saved. Automatically clears `isDefault` flags from user's other addresses.

### 2. List Own Addresses
- **Path**: `GET /api/address`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Lists addresses. The user's active default address is sorted first.

### 3. Read Specific Address
- **Path**: `GET /api/address/:id`
- **Headers**: Required Authentication. (Owner or Admin Only).
- **Responses**:
  - `200 OK`: Returns the address details.

### 4. Update Address
- **Path**: `PUT /api/address/:id`
- **Headers**: Required Authentication (Owner Only).
- **Body Fields** (All Optional): `fullName`, `phone`, `line1`, `line2`, `landmark`, `city`, `state`, `pincode`, `isDefault`.
- **Responses**:
  - `200 OK`: Returns the updated address.

### 5. Delete Address
- **Path**: `DELETE /api/address/:id`
- **Headers**: Required Authentication (Owner Only).
- **Responses**:
  - `200 OK`: Address deleted. If the deleted address was default, another address is promoted to default automatically.

---

## 5. Product Catalog, Category, & Brand Module (`/api/product`)

Handles categories, products, image assets, and variants. Creating or editing products requires **KYC-approved seller status** (`isKycCompleted: true` and `approvalStatus: "approved"`). Approved sellers list products **directly without admin permission**, and they are approved instantly.

### 1. Create Category (Admin Only)
- **Path**: `POST /api/product/categories`
- **Headers**: Required Admin Authentication.
- **Body Fields**:
  - `name` (String, Required): Category name.
  - `imageUrl` (String, Optional): Category picture link.
  - `parentId` (String, Optional): Parent category ObjectId.
  - `sortOrder` (Number, Optional): Sort precedence. (Defaults to 1).
- **Responses**:
  - `201 Created`: Category created successfully and system categories cache is invalidated.

### 2. Get All Categories (Public)
- **Path**: `GET /api/product/categories`
- **Responses**:
  - `200 OK`: Returns flat array of categories sorted by order and name, cached in Redis for fast rendering.

### 3. Get Verified Brands Catalog (Public)
- **Path**: `GET /api/product/brands`
- **Responses**:
  - `200 OK`: Returns list of system brands and approved custom seller brands sorted alphabetically.

### 4. Create Product
- **Path**: `POST /api/product`
- **Headers**: Required KYC-Approved Seller Authentication.

There are **two supported formats** to insert data:

#### Way A: Standard JSON Payload (`application/json`)
- **Headers**: `Content-Type: application/json`
- **Body Layout**:
```json
{
  "categoryId": "65b2671239f1c7d23a1a1b1c",
  "title": "Stereo Earbuds X1",
  "description": "Premium noise cancelling earbuds",
  "brand": "Stress Brand",
  "sku": "SKU-TWS-X1-BLK",
  "pricePaise": 299900,
  "comparePricePaise": 399900,
  "inventory": 500,
  "tags": ["earbuds", "audio", "tws"],
  "variantAttributes": { "color": "Jet Black" }
}
```

#### Way B: Standard YAML Payload (`application/x-yaml`)
- **Headers**: `Content-Type: application/yaml` (or pass `.yamlPayload` inside request body)
- **Body Layout**:
```yaml
categoryId: "65b2671239f1c7d23a1a1b1c"
title: "Stereo Earbuds X1"
description: "Premium noise cancelling earbuds"
brand: "Stress Brand"
sku: "SKU-TWS-X1-BLK"
pricePaise: 299900
comparePricePaise: 399900
inventory: 500
tags:
  - "earbuds"
  - "audio"
  - "tws"
variantAttributes:
  color: "Jet Black"
```

- **Responses**:
  - `201 Created`: Directly creates product. Since the seller is approved (KYC Completed), the product's `moderationStatus` is set to `"approved"` and is listed publicly immediately.
  - `202 Accepted` (Production Mode): Creation request is enqueued to sequential `ProductQueue` for parallel background streaming.
  - `403 Forbidden`: Seller has not completed KYC validation.

### 5. Advanced Product Query Listing
Highly optimized facet query pipeline. Returns matching products and prices.
- **Path**: `GET /api/product`
- **Query Params** (All Optional):
  - `categoryId`, `brand`, `tag` (Category, Brand, or Tag filter).
  - `minPrice`, `maxPrice` (Price ranges in Paise).
  - `search` (Query text matching titles, descriptions, or tags).
  - `sort` (Sorting option: `"newest"` | `"priceAsc"` | `"priceDesc"`).
  - `page`, `limit` (Pagination markers).
- **Responses**:
  - `200 OK`: Returns pagination details, count, and result list. Hits are cached in Redis.

### 6. Detailed Product Inspection
Retrieves detail properties populated by SEO URL slugs.
- **Path**: `GET /api/product/slug/:slug`
- **Responses**:
  - `200 OK`: Returns populated product details populated by associated image assets, variants list, and active seller listings.

### 7. Update Product
- **Path**: `PUT /api/product/:id`
- **Content-Type**: Supports both JSON and YAML body payloads.
- **Headers**: Required KYC-Approved Seller Authentication (Owner Only).
- **Responses**:
  - `200 OK`: Returns the updated product.

### 8. Delete Product
Purges master catalog product and cascades variant media and listings.
- **Path**: `DELETE /api/product/:id`
- **Headers**: Required Authentication (Owner Seller or Admin Only).
- **Responses**:
  - `200 OK`: Deletion confirmation.

### 9. Upload Extra Product Images
Saves image URLs under Cloudinary. Enforces up to 10 photos.
- **Path**: `POST /api/product/:id/images`
- **Content-Type**: `multipart/form-data`
- **Headers**: Required KYC-Approved Seller Authentication (Owner Only).
- **Body Fields**:
  - `images` (File Array): Multi-file uploads.
- **Responses**:
  - `201 Created`: Upload complete. Falls back to static local storage paths if Cloudinary is unavailable.

### 10. Delete Product Image
- **Path**: `DELETE /api/product/images/:imageId`
- **Headers**: Required KYC-Approved Seller Authentication (Owner Only).
- **Responses**:
  - `200 OK`: Purge confirmation.

### 11. Add Product Variant
- **Path**: `POST /api/product/:id/variants`
- **Headers**: Required KYC-Approved Seller Authentication (Owner Only).
- **Body Fields**:
  - `sku` (String, Required): Unique variant code.
  - `pricePaise` (Number, Required): Variant price in Paise.
  - `inventory` (Number, Optional): Initial stock.
  - `variantAttributes` (Object, Optional): Attributes (e.g. `{ "size": "M", "color": "Blue" }`).
- **Responses**:
  - `201 Created`: Variant registered. Automatically provisions linked seller listings, inventories, and initial pricing history entry.

### 12. Get Specific Variant Details
- **Path**: `GET /api/product/variants/:id`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Returns the requested variant document.
  - `404 Not Found`: Variant does not exist.

### 13. Get All Variants of a Product
- **Path**: `GET /api/product/:id/variants`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Returns an array of variant documents belonging to the catalog product ID.
  - `404 Not Found`: Product does not exist.

### 14. Update Product Variant
- **Path**: `PUT /api/product/variants/:variantId`
- **Headers**: Required KYC-Approved Seller Authentication (Owner Only).
- **Body Fields** (All Optional):
  - `sku` (String): New unique SKU.
  - `pricePaise` (Number): New price in Paise.
  - `inventory` (Number): New available quantity.
  - `variantAttributes` (Object): Updated attributes.
- **Responses**:
  - `200 OK`: Returns the updated variant and updated pricing/inventory listing entries.
  - `404 Not Found`: Variant does not exist.

### 15. Delete Product Variant
- **Path**: `DELETE /api/product/variants/:variantId`
- **Headers**: Required KYC-Approved Seller Authentication (Owner Only).
- **Responses**:
  - `200 OK`: Deletion confirmation. Cascade deletes the variant and related listing, inventory, and pricing history.
  - `404 Not Found`: Variant does not exist.

---

## 6. Cart Persistent Module (`/api/cart`)

Manages client persistent cart records in database. Automatically syncs with stock and computes coupon discounts.

### 1. View Own Cart
- **Path**: `GET /api/cart`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Returns items list with populated product details, coupon codes, and real-time active price snapshots alongside computed discount metrics.

### 2. Add Item to Cart
- **Path**: `POST /api/cart/add`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `productId` (String, Required): Target product catalog ID.
  - `variantId` (String, Optional): Product variant ID. (Defaults to product default variant).
  - `quantity` (Number, Required): Quantity to add (minimum 1).
- **Responses**:
  - `200 OK`: Cart updated. Enforces stock checks against listing inventories.
  - `409 Conflict`: Insufficient stock available.

### 3. Synchronize Cart State
Replaces database cart items with the frontend shopping cart state.
- **Path**: `POST /api/cart/sync`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `items` (Array, Required): List of items.
    - Each item requires: `productId` (String), `variantId` (String), `quantity` (Number), `titleSnapshot` (String), `pricePaiseSnapshot` (Number), `imageSnapshot` (String, Optional).
- **Responses**:
  - `200 OK`: Cart successfully synchronized. Re-evaluates active coupons.

### 4. Clear Cart
- **Path**: `DELETE /api/cart`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Cart emptied.

### 5. Apply Seller Coupon to Cart
- **Path**: `POST /api/cart/coupon`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `code` (String, Required): Coupon code. (Automatically normalized to uppercase).
- **Responses**:
  - `200 OK`: Coupon applied. Returns computed discount value in Paise.
  - `400 Bad Request`: Coupon is invalid, expired, depleted, or cart does not satisfy minimum subtotal.

### 6. Remove Coupon from Cart
- **Path**: `DELETE /api/cart/coupon`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Coupon detached from the cart.

---

## 7. Coupon Campaigns Module (`/api/coupons`)

Provides seller campaign management capabilities. Sellers can issue coupons targeting specific categories, products, or listing variants.

### 1. Create Coupon Campaign
- **Path**: `POST /api/coupons`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Body Fields**:
  - `code` (String, Required): Desired coupon code. (Automatically normalized to uppercase).
  - `discountType` (String, Required): `"flat" | "percent"`.
  - `discountValue` (Number, Required): Flat amount in Paise, or percentage number (e.g. `10` = 10% off).
  - `minOrderValue` (Number, Optional): Minimum order subtotal in Paise required to activate the coupon. (Defaults to 0).
  - `maxDiscountValue` (Number, Optional): Cap on maximum discount value in Paise for percentage coupons.
  - `usageLimit` (Number, Required): Total global usage limit before depletion.
  - `perUserLimit` (Number, Optional): Limit of coupon uses allowed per customer. (Defaults to 1).
  - `startsAt` (String, Required): ISO Date string for campaign start.
  - `endsAt` (String, Required): ISO Date string for campaign expiration.
  - `applicableProducts` (Array, Optional): Array of product ObjectIds this coupon is restricted to.
  - `applicableCategories` (Array, Optional): Array of category ObjectIds this coupon is restricted to.
  - `applicableListings` (Array, Optional): Array of variant ObjectIds this coupon is restricted to.
- **Responses**:
  - `201 Created`: Coupon created successfully.
  - `400 Bad Request`: Duplicate coupon code or invalid date bounds.

### 2. List My Coupon Campaigns
- **Path**: `GET /api/coupons/my`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Responses**:
  - `200 OK`: Returns an array of coupon campaign documents managed by the seller.

### 3. Delete Coupon Campaign
- **Path**: `DELETE /api/coupons/:id`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Responses**:
  - `200 OK`: Coupon successfully deleted.

### 4. Validate Coupon
Exposes coupon validity check. Returns calculated discount in Paise.
- **Path**: `POST /api/coupons/validate`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `code` (String, Required): Coupon code to check.
  - `orderValuePaise` (Number, Required): Order subtotal in Paise.
  - `sellerId` (String, Required): Seller business ID.
- **Responses**:
  - `200 OK`: Coupon validated. Returns the calculated `discountPaise`.
  - `400 Bad Request`: Coupon has expired, is inactive, or minimum subtotal threshold is unmet.

---

## 8. Orders & Checkout Module (`/api/orders`)

Processes order creation, tracking, status updates, and cancellation requests.

### 1. Place Cash on Delivery Order
Executes checkout: locks stock, records coupon usages, saves address snapshots, flushes the cart, and fires event webhooks.
- **Path**: `POST /api/orders`
- **Content-Type**: `application/json`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `addressId` (String, Required): Shipping address ObjectId.
  - `paymentMethod` (String, Required): strictly `"cod"`.
  - `notes` (String, Optional): Delivery instructions.
- **Responses**:
  - `201 Created`: Returns placed order document.
  - `409 Conflict`: Insufficient stock available.

### 2. Get My Orders
- **Path**: `GET /api/orders`
- **Headers**: Required Authentication.
- **Query Params**:
  - `page` (Number, Optional): Page number.
  - `limit` (Number, Optional): Page size.
- **Responses**:
  - `200 OK`: Paginated list of orders placed by the user.

### 3. Get Seller's Orders
- **Path**: `GET /api/orders/seller`
- **Headers**: Required Seller Authentication.
- **Query Params**:
  - `page` (Number, Optional): Page number.
  - `limit` (Number, Optional): Page size.
- **Responses**:
  - `200 OK`: Paginated list of orders containing items belonging to this seller's store.

### 4. Get Specific Order
- **Path**: `GET /api/orders/:orderId`
- **Headers**: Required Authentication. (Owner or Admin Only).
- **Responses**:
  - `200 OK`: Returns populated order details document.

### 5. Cancel Order
Restores inventory levels, reverses coupon counters, and updates status.
- **Path**: `POST /api/orders/:orderId/cancel`
- **Headers**: Required Authentication (Buyer Owner or Admin Only).
- **Body Fields**:
  - `reason` (String, Optional): Cancellation details.
- **Responses**:
  - `200 OK`: Cancellation complete.

### 6. Update Order Status
Updates status of a customer order along valid transition steps.
- **Path**: `PATCH /api/orders/:orderId/status`
- **Headers**: Required Seller or Admin Authentication.
- **Body Fields**:
  - `status` (String, Required): New order status (e.g. `"processing" | "shipped" | "delivered" | "returned"`).
- **Responses**:
  - `200 OK`: Status successfully updated.
  - `409 Conflict`: Invalid status transition sequence.

---

## 9. Community Reviews & Product Q&A Module (`/api`)

Handles community interaction. Includes rating breakdown aggregates, custom sorting, rating filters, and helpfulness voting.

### 1. Submit Product Review
- **Path**: `POST /api/product/:id/reviews`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `rating` (Number, Required): Score from 1 to 5.
  - `title` (String, Required): Title text.
  - `comment` (String, Required): Review comment.
  - `mediaUrls` (Array, Optional): Photo/video links.
- **Responses**:
  - `201 Created`: Review submitted. Recalculates master product averages and counts.

### 2. Get Product Reviews
- **Path**: `GET /api/product/:id/reviews`
- **Query Params** (All Optional):
  - `rating` (Number): Filter reviews by rating level (1 to 5 stars).
  - `sort` (String): Sort by `"helpful"` (upvotes), `"highest"` (ratings DESC), `"lowest"` (ratings ASC), or `"newest"` (default).
  - `page`, `limit`: Pagination.
- **Responses**:
  - `200 OK`: Returns pagination data, matching reviews, populated user avatar media, and the rating distribution breakdown showing counts and percentage values for each rating star level.

### 3. Upvote Review Helpfulness
Increments a review's helpful votes.
- **Path**: `POST /api/reviews/:reviewId/helpful`
- **Headers**: Required Authentication.
- **Responses**:
  - `200 OK`: Returns the updated review.

### 4. Submit Catalog Question
- **Path**: `POST /api/product/:id/questions`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `question` (String, Required): Question text.
- **Responses**:
  - `201 Created`: Question posted.

### 5. Get Product Questions
- **Path**: `GET /api/product/:id/questions`
- **Query Params**: `page`, `limit` (paginated).
- **Responses**:
  - `200 OK`: Paginated list of approved product question documents.

### 6. Submit Question Answer
- **Path**: `POST /api/question/:questionId/answers`
- **Headers**: Required Authentication.
- **Body Fields**:
  - `answer` (String, Required): Answer text.
- **Responses**:
  - `201 Created`: Answer posted. If answered by the product's supplying seller, it flags `isSellerAnswer: true`.

### 7. Get Answers for Question
- **Path**: `GET /api/question/:questionId/answers`
- **Query Params**: `page`, `limit` (paginated).
- **Responses**:
  - `200 OK`: Paginated list of answer documents sorted by helpfulness and date.

---

## 10. Shipping Profiles & Store Locations Module (`/api`)

Supports dispatch profiles and warehouse operations.

### 1. Create Shipping Profile
- **Path**: `POST /api/shipping`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Body Fields**:
  - `name` (String, Required): Name of shipping profile.
  - `processingDays` (Number, Required): Number of operational days before package dispatch.
  - `shippingType` (String, Optional): `"free" | "paid"`. (Automatically resolved to `"free"` if charge is 0).
  - `baseChargePaise` (Number, Optional): Shipping fee in Paise. (Defaults to 0).
  - `codAvailable` (Boolean, Optional): COD delivery option support toggle. (Defaults to `true`).
  - `freeShippingAbove` (Number, Optional): Minimum order subtotal in Paise to waive shipping charges.
- **Responses**:
  - `201 Created`: Profile created successfully.

### 2. Get Shipping Profiles
- **Path**: `GET /api/shipping`
- **Headers**: Required Seller or Admin Authentication.
- **Query Params** (Admin Only):
  - `sellerId` (String, Optional): Filter by seller ID.
- **Responses**:
  - `200 OK`: Returns array of shipping profile documents.

### 3. Create Warehouse Store Location
- **Path**: `POST /api/stores`
- **Headers**: Required KYC-Approved Seller Authentication.
- **Body Fields**:
  - `name` (String, Required): Store location name.
  - `address` (Object, Required): Location address details.
  - `coordinates` (Array, Required): Longitude and latitude list: `[longitude, latitude]`.
- **Responses**:
  - `201 Created`: Store registered successfully.

### 4. Get Warehouse Store Locations
- **Path**: `GET /api/stores`
- **Headers**: Required Seller or Admin Authentication.
- **Query Params** (Admin Only):
  - `sellerId` (String, Optional): Filter by seller ID.
- **Responses**:
  - `200 OK`: Returns list of stores registered under the account profile.

### 5. Geospatial Spatial Nearby Warehouse Search (Public)
Public search finding active stores and warehouses within a circular radius of specified longitude/latitude coordinates.
- **Path**: `GET /api/stores/nearby`
- **Query Params**:
  - `lng` (Number, Required): Longitude coordinate.
  - `lat` (Number, Required): Latitude coordinate.
  - `radiusKm` (Number, Optional): Circular search radius in Kilometers. (Defaults to 10).
- **Responses**:
  - `200 OK`: Returns array of active warehouse stores sorted by distance.

---

## 11. Outgoing Webhook Subscriptions (`/api/webhooks`)

Supports event dispatch integration subscribing to backend state modification events.

### 1. Register Webhook Subscription
- **Path**: `POST /api/webhooks`
- **Headers**: Required Seller or Admin Authentication.
- **Body Fields**:
  - `url` (String, Required): Outgoing listener HTTP URL destination.
  - `events` (Array of Strings, Required): Event subscriptions (e.g. `["order.created", "order.cancelled", "order.status_updated"]`).
- **Responses**:
  - `201 Created`: Webhook subscription saved with a cryptographically generated HMAC secret key attached.
  - `409 Conflict`: Subscription already registered for this target URL destination by the account profile.

### 2. List My Webhook Subscriptions
- **Path**: `GET /api/webhooks`
- **Headers**: Required Seller or Admin Authentication.
- **Responses**:
  - `200 OK`: Returns array of active webhook subscription logs.

### 3. Delete Webhook Subscription
- **Path**: `DELETE /api/webhooks/:id`
- **Headers**: Required Seller or Admin Authentication.
- **Responses**:
  - `200 OK`: Webhook subscription deleted.

---

## 12. Admin Control Module (`/api/admin`)

Requires Admin role authentication (`requireRoles("admin")`).

### 1. Record Platform Expense
- **Path**: `POST /api/admin/expenses`
- **Body Fields**:
  - `title` (String, Required): Expense name.
  - `amountPaise` (Number, Required): Total in Paise (e.g., `50000` = ₹500.00).
  - `category` (String, Required): `"promotions" | "marketing" | "shipping" | "hosting" | "others"`.
  - `description` (String, Optional): Operational details.
- **Responses**:
  - `201 Created`: Expense recorded. Triggers an `EXPENSE_CREATED` audit log.

### 2. View Platform Expenses
- **Path**: `GET /api/admin/expenses`
- **Query Params** (All Optional):
  - `category` (String): Filter category.
  - `startDate`, `endDate` (String): Date range boundaries.
- **Responses**:
  - `200 OK`: Paginated list of platform expenses.

### 3. Financial Dynamic Summaries
Dynamically aggregates sales revenues against promotion coupon costs and administrative expenses to calculate platform profit margins.
- **Path**: `GET /api/admin/expenses/summary`
- **Responses**:
  - `200 OK`: Financial dashboard metrics in Paise and Rupees.

### 4. View Audit Action Logs
- **Path**: `GET /api/admin/audit-logs`
- **Query Params** (All Optional):
  - `action` (String): Action string filter.
  - `performedBy` (String): ObjectId of the performing admin.
- **Responses**:
  - `200 OK`: Paginated administrative log actions.

### 5. View Products Awaiting Moderation
- **Path**: `GET /api/admin/moderation/products`
- **Responses**:
  - `200 OK`: Paginated products queue whose `moderationStatus` is `"pending"`.

### 6. Process Bulk Product Moderation Decisions
Performs bulk moderation on a list of product IDs.
- **Path**: `POST /api/admin/moderation/products/bulk`
- **Body Fields**:
  - `productIds` (Array of Strings, Required): Valid product ObjectIds.
  - `action` (String, Required): `"approve" | "reject" | "hide"`.
  - `reason` (String, Optional): Details.
- **Responses**:
  - `200 OK`: Moderation complete. Updates states, logs `BULK_PRODUCT_MODERATION` audit logs, and enqueues alert notifications to sellers.
