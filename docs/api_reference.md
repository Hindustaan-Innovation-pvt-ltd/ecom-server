# HMarketplace API Reference

> **Base URL**: `http://localhost:3000/api`
> **Auth**: All protected endpoints accept either **cookie-session** (Passport.js) or the **JWT token** returned by `POST /api/auth/login`. Browser clients deployed on Netlify must send requests with credentials enabled if they rely on cookies, and they must set `FRONTEND_ORIGIN`/`CORS_ORIGIN` to the deployed frontend URL.

### Browser / Postman auth examples

If you use cookie auth in the browser:

```js
fetch("https://your-site.netlify.app/.netlify/functions/api/auth/me", {
  method: "GET",
  credentials: "include",
});
```

If you use JWT auth instead:

```js
fetch("https://your-site.netlify.app/.netlify/functions/api/auth/me", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

In Postman, either keep the cookie jar enabled after login or add `Authorization: Bearer <token>` to protected requests.

---

## Authentication & Role System

| Role | Description |
|---|---|
| `customer` | Registered buyer. Can browse, cart, and order. |
| `seller` | Approved seller. Can manage products, listings, coupons, and shipping. |
| `admin` | Platform administrator. Full access across all entities. |

All `seller` routes additionally require **`requireApprovedSeller`** — the seller's `approvalStatus` must be `"approved"`.

---

## 📋 Table of Contents

1. [Auth & Users](#1-auth--users)
2. [Addresses](#2-addresses)
3. [Products & Catalog](#3-products--catalog)
4. [Product Variants](#4-product-variants)
5. [Product Images](#5-product-images)
6. [Sellers](#6-sellers)
7. [Seller Listings](#7-seller-listings)
8. [Seller Brands](#8-seller-brands)
9. [Cart](#9-cart)
10. [Coupons](#10-coupons)
11. [Orders](#11-orders)
12. [Reviews](#12-reviews)
13. [Product Q&A](#13-product-qa)
14. [Shipping Profiles](#14-shipping-profiles)
15. [Seller Stores / Warehouses](#15-seller-stores--warehouses)
16. [Webhooks](#16-webhooks)
17. [Admin Panel](#17-admin-panel)

---

## 1. Auth & Users

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register a new user account |
| `POST` | `/auth/login` | Public | Login and open a session |
| `POST` | `/auth/logout` | Public | Destroy the current session |
| `GET` | `/auth/me` | Any | Get own profile |
| `PUT` | `/auth/me` | Any | Update own profile & avatar |
| `DELETE` | `/auth/me` | Any | Delete own account |
| `GET` | `/auth/users` | Admin | List all users (paginated) |
| `GET` | `/auth/users/:id` | Any | Get user by ID |
| `PUT` | `/auth/users/:id/status` | Admin | Activate or ban a user |
| `DELETE` | `/auth/users/:id` | Admin | Hard-delete a user record |

### `POST /auth/register`
```json
// Body (multipart/form-data)
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "password": "securepass123",
  "avatar": "<file>"         // optional
}

// 201 Response
{
  "success": true,
  "message": "Registration successful.",
  "user": { "_id": "...", "fullName": "John Doe", "email": "...", "role": "customer" }
}
```

### `POST /auth/login`
```json
// Body
{ "email": "john@example.com", "password": "securepass123" }

// 200 Response
{ "success": true, "message": "Login successful.", "user": { ... } }
```

### `PUT /auth/me`
```json
// Body (multipart/form-data) — all fields optional
{
  "fullName": "John Updated",
  "avatar": "<file>"
}
```

### `PUT /auth/users/:id/status`
```json
// Body (Admin)
{ "isActive": false }  // true to reactivate, false to ban
```

---

## 2. Addresses

> All routes require authentication. Users can only access their own addresses.

| Method | Path | Description |
|---|---|---|
| `POST` | `/address` | Create a new delivery address |
| `GET` | `/address` | List all own addresses |
| `GET` | `/address/:id` | Get a specific address |
| `PUT` | `/address/:id` | Update an address |
| `DELETE` | `/address/:id` | Delete an address |

### `POST /address`
```json
// Body
{
  "fullName": "John Doe",
  "phone": "9876543210",
  "line1": "42 MG Road",
  "line2": "Apt 4B",          // optional
  "landmark": "Near Park",    // optional
  "city": "Bengaluru",
  "state": "Karnataka",
  "country": "India",
  "pincode": "560001"
}

// 201 Response
{ "success": true, "address": { "_id": "...", ... } }
```

---

## 3. Products & Catalog

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/product` | Public | List all products (paginated + filtered) |
| `GET` | `/product/slug/:slug` | Public | Get a product by URL slug |
| `GET` | `/product/brands` | Public | List all verified brands |
| `POST` | `/product` | Seller | Create a new catalog product |
| `PUT` | `/product/:id` | Seller | Update a catalog product |
| `DELETE` | `/product/:id` | Seller/Admin | Delete a product + cascade |
| `GET` | `/product/categories` | Public | List all active categories |
| `GET` | `/product/categories/:id` | Public | Get a single category by ID |
| `POST` | `/product/categories` | Admin | Create a new category |
| `PUT` | `/product/categories/:id` | Admin | Update a category |
| `DELETE` | `/product/categories/:id` | Admin | Soft-delete a category |

### `GET /product` — Query Parameters
```
?page=1&limit=20
?categoryId=<id>
?brandId=<id>
?search=<keyword>         // Full-text search
?minPrice=1000&maxPrice=5000  // In paise (₹10 = 1000 paise)
?sort=price_asc|price_desc|newest|rating
```

### `POST /product`
```json
// Body (multipart/form-data or JSON)
{
  "title": "Classic Cotton T-Shirt",
  "description": "100% pure cotton, breathable fabric",
  "categoryId": "<ObjectId>",
  "brandId": "<ObjectId>",     // optional
  "tags": ["cotton", "casual"],
  "seo": {
    "metaTitle": "Buy Cotton T-Shirt",
    "metaDescription": "Best cotton t-shirt in India"
  }
}
// 201 Response
{ "success": true, "product": { "_id": "...", "slug": "classic-cotton-t-shirt", ... } }
```

### `POST /product/categories`
```json
// Body (Admin)
{
  "name": "Men's Clothing",
  "imageUrl": "https://cdn.example.com/cat.jpg",
  "parentId": "<ObjectId>",   // optional — creates sub-category
  "sortOrder": 1
}
```

### `PUT /product/categories/:id`
```json
// Body (Admin) — all fields optional
{
  "name": "Men's Apparel",
  "sortOrder": 2,
  "isActive": true
}
```

---

## 4. Product Variants

> Variants represent specific SKUs (e.g., Size: L, Color: Red) under a catalog product. Creating a variant automatically provisions a `SellerListing`, `ListingInventory`, and initial `ListingPricingHistory`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/product/:id/variants` | Any | List all variants for a product |
| `POST` | `/product/:id/variants` | Seller | Create a variant + auto-provision listing |
| `GET` | `/product/variants/:id` | Any | Get a single variant by ID |
| `PUT` | `/product/variants/:variantId` | Seller | Update variant attributes, price, stock |
| `DELETE` | `/product/variants/:variantId` | Seller | Delete variant + cascade listing/inventory |

### `POST /product/:id/variants`
```json
// Body
{
  "option1": "Large",       // Required — primary attribute (e.g., Size)
  "option2": "Red",         // optional
  "option3": "Cotton",      // optional
  "sku": "TSHIRT-L-RED-001",
  "pricePaise": 49900,      // ₹499.00
  "inventory": 50           // initial stock quantity
}

// 201 Response
{
  "success": true,
  "variant": { "_id": "...", "sku": "...", "pricePaise": 49900, "inventory": 50 }
}
```

---

## 5. Product Images

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/product/:id/images` | Seller | Upload up to 10 product images |
| `DELETE` | `/product/images/:imageId` | Seller | Delete a specific product image |

### `POST /product/:id/images`
```
Content-Type: multipart/form-data
Field name: "images"  (array, max 10 files)
```

---

## 6. Sellers

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/seller/register` | Public | Register seller account + profile |
| `GET` | `/seller/profile` | Seller | Get own seller profile |
| `PUT` | `/seller/profile` | Seller | Update own profile |
| `DELETE` | `/seller/profile` | Seller | Delete own profile |
| `GET` | `/seller/analytics/dashboard` | Seller | Revenue & performance dashboard |
| `GET` | `/seller` | Admin | List all sellers (paginated) |
| `GET` | `/seller/:id` | Public | Get seller public profile by ID |
| `PUT` | `/seller/:id/status` | Admin | Approve or reject a seller |
| `DELETE` | `/seller/:id` | Admin | Force-delete seller + user record |

### `POST /seller/register`
```json
// Body (multipart/form-data)
{
  "fullName": "Ravi Kumar",
  "email": "ravi@shop.com",
  "password": "secret",
  "businessName": "Ravi's Electronics",
  "businessEmail": "support@ravielectronics.com",
  "businessPhone": "9900112233",
  "gstNumber": "22AAAAA0000A1Z5",  // optional
  "avatar": "<file>"               // optional
}
```

### `GET /seller/analytics/dashboard`
```json
// 200 Response
{
  "success": true,
  "analytics": {
    "totalRevenuePaise": 4980000,
    "totalOrders": 42,
    "totalProducts": 18,
    "totalListings": 35,
    "recentOrders": [ ... ]
  }
}
```

### `PUT /seller/:id/status` (Admin)
```json
{ "approvalStatus": "approved" }  // or "rejected"
```

---

## 7. Seller Listings

> Listings are the seller's specific offers for a product variant — they hold price and inventory.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/seller/listings` | Seller | Create a manual listing for an existing variant |
| `GET` | `/seller/listings` | Seller | List all own listings |
| `PUT` | `/seller/listings/:id` | Seller | Update listing price / compare price |
| `DELETE` | `/seller/listings/:id` | Seller | Delete listing + inventory + pricing history |

### `POST /seller/listings`
```json
// Body
{
  "variantId": "<ObjectId>",
  "sellerSku": "MY-SKU-001",
  "condition": "new",          // "new" | "used" | "refurbished"
  "pricePaise": 59900,
  "comparePricePaise": 79900,  // optional MRP / strikethrough price
  "inventory": 100
}
```

### `PUT /seller/listings/:id`
```json
// Body — all optional
{
  "pricePaise": 54900,
  "comparePricePaise": 79900,
  "inventory": 80,
  "status": "active"  // "active" | "inactive"
}
```

---

## 8. Seller Brands

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/seller/brands` | Seller | Register a custom brand (pending admin review) |
| `GET` | `/seller/brands` | Seller | List own registered brands |
| `PUT` | `/seller/brands/:id/status` | Admin | Approve or revoke brand verification |
| `DELETE` | `/seller/brands/:id` | Seller/Admin | Delete a brand (blocked if products use it) |
| `GET` | `/product/brands` | Public | List all platform-verified brands |

### `POST /seller/brands`
```
Content-Type: multipart/form-data
Fields: name (required), logo (optional file)
```

### `PUT /seller/brands/:id/status` (Admin)
```json
{ "isVerified": true }  // or false to revoke
```

---

## 9. Cart

> Requires authentication. Any role (customer, seller, admin) can use a cart.

| Method | Path | Description |
|---|---|---|
| `GET` | `/cart` | Get cart + live coupon discount calculation |
| `POST` | `/cart/add` | Add a product to the cart |
| `POST` | `/cart/sync` | Replace entire cart contents (for client-side sync) |
| `DELETE` | `/cart` | Clear all items from the cart |
| `POST` | `/cart/coupon` | Apply a coupon code to the cart |
| `DELETE` | `/cart/coupon` | Remove the applied coupon from the cart |

### `POST /cart/add`
```json
// Body
{
  "productId": "<ObjectId>",
  "variantId": "<ObjectId>",  // optional — auto-resolved to defaultVariant
  "quantity": 2
}

// 200 Response
{
  "success": true,
  "cart": {
    "items": [
      {
        "productId": "...",
        "variantId": "...",
        "quantity": 2,
        "titleSnapshot": "Classic Cotton T-Shirt",
        "pricePaiseSnapshot": 49900
      }
    ]
  }
}
```

### `POST /cart/sync`
```json
// Body — replaces existing cart entirely
{
  "items": [
    {
      "productId": "<ObjectId>",
      "variantId": "<ObjectId>",
      "quantity": 1,
      "titleSnapshot": "Product Name",
      "pricePaiseSnapshot": 49900
    }
  ]
}
```

### `POST /cart/coupon`
```json
{ "code": "SAVE20" }
```

---

## 10. Coupons

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/coupons` | Seller | Create a promotional coupon |
| `GET` | `/coupons/my` | Seller | List own coupons |
| `PUT` | `/coupons/:id` | Seller | Update a coupon |
| `DELETE` | `/coupons/:id` | Seller | Delete a coupon |
| `POST` | `/coupons/validate` | Any | Validate a coupon code |

### `POST /coupons`
```json
// Body
{
  "code": "SAVE20",
  "discountType": "percent",    // "percent" | "flat"
  "discountValue": 20,          // 20% or ₹20 (in paise for flat)
  "minOrderValue": 50000,       // in paise — ₹500 minimum
  "maxDiscountValue": 20000,    // optional cap — in paise (for percent coupons)
  "usageLimit": 100,
  "perUserLimit": 1,
  "startsAt": "2025-06-01T00:00:00Z",
  "endsAt": "2025-06-30T23:59:59Z",
  "applicableProducts": [],     // [] = all products
  "applicableCategories": [],   // [] = all categories
  "applicableListings": []      // [] = all listings
}
```

### `POST /coupons/validate`
```json
// Body
{
  "code": "SAVE20",
  "orderValuePaise": 75000,
  "sellerId": "<ObjectId>"
}

// 200 Response
{
  "success": true,
  "discountPaise": 15000,
  "coupon": { "code": "SAVE20", "discountType": "percent", ... }
}
```

---

## 11. Orders

> All order routes require authentication.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/orders` | Any | Place an order (COD) |
| `GET` | `/orders` | Any | List own orders (paginated) |
| `GET` | `/orders/all` | Admin | List all platform orders with filters |
| `GET` | `/orders/seller` | Seller | List orders containing seller's items |
| `GET` | `/orders/:orderId` | Any | Get a specific order (self or admin) |
| `POST` | `/orders/:orderId/cancel` | Any | Cancel a pending or confirmed order |
| `PATCH` | `/orders/:orderId/status` | Seller/Admin | Advance order status through workflow |

### `POST /orders` — Place Order (COD)
```json
// Body
{
  "addressId": "<ObjectId>",
  "paymentMethod": "cod",
  "notes": "Please ring the bell"  // optional
}

// 201 Response
{
  "success": true,
  "order": {
    "_id": "...",
    "status": "confirmed",
    "paymentMethod": "cod",
    "totalPaise": 94820,
    "couponCode": "SAVE20",
    "couponDiscountPaise": 15000,
    "items": [ ... ],
    "addressSnapshot": { ... }
  }
}
```

### `GET /orders/all` (Admin)
```
Query: ?status=confirmed&userId=<id>&startDate=2025-01-01&endDate=2025-12-31&page=1&limit=20
```

### `PATCH /orders/:orderId/status`
```json
// Body — allowed transitions:
// confirmed → processing → shipped → delivered → return_requested → returned
{ "status": "processing" }
```

### `POST /orders/:orderId/cancel`
```json
// Body — optional
{ "reason": "Changed my mind" }
// Note: Restores inventory and reverses coupon usage atomically
```

---

## 12. Reviews

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/product/:id/reviews` | Any | Submit a review for a product |
| `GET` | `/product/:id/reviews` | Public | Get paginated reviews with rating stats |
| `POST` | `/reviews/:reviewId/helpful` | Any | Vote a review as helpful |
| `DELETE` | `/reviews/:reviewId` | Owner/Admin | Delete a review + cascade media |
| `PUT` | `/reviews/:reviewId/status` | Admin | Moderate review status |

### `POST /product/:id/reviews`
```json
// Body
{
  "rating": 5,                   // 1–5
  "title": "Excellent quality!",
  "comment": "Wore it all week, still looks great.",
  "variantId": "<ObjectId>",     // optional
  "listingId": "<ObjectId>",     // optional
  "mediaUrls": ["https://..."]   // optional image URLs
}
```

### `GET /product/:id/reviews`
```
Query: ?page=1&limit=10&rating=5&sort=helpful|highest|lowest
```
```json
// 200 Response
{
  "success": true,
  "statistics": {
    "totalReviews": 48,
    "ratingAverage": 4.3,
    "breakdown": {
      "5": { "count": 28, "percentage": 58.3 },
      "4": { "count": 12, "percentage": 25.0 },
      ...
    }
  },
  "reviews": [ ... ],
  "pagination": { "page": 1, "limit": 10, "total": 48, "pages": 5 }
}
```

### `PUT /reviews/:reviewId/status` (Admin)
```json
{ "status": "approved" }  // "approved" | "hidden" | "pending"
```

---

## 13. Product Q&A

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/product/:id/questions` | Any | Post a question on a product |
| `GET` | `/product/:id/questions` | Public | Get paginated questions |
| `DELETE` | `/question/:questionId` | Owner/Admin | Delete question + cascade answers |
| `PUT` | `/question/:questionId/status` | Admin | Moderate question status |
| `POST` | `/question/:questionId/answers` | Any | Post an answer to a question |
| `GET` | `/question/:questionId/answers` | Public | Get paginated answers (sorted by helpfulness) |
| `DELETE` | `/answers/:answerId` | Owner/Admin | Delete an answer |
| `POST` | `/answers/:answerId/helpful` | Any | Vote an answer as helpful |

### `POST /product/:id/questions`
```json
{ "question": "Is this machine washable?" }
```

### `POST /question/:questionId/answers`
```json
{ "answer": "Yes, cold wash only. Avoid tumble drying." }
// isSellerAnswer is auto-detected based on product ownership
```

### `PUT /question/:questionId/status` (Admin)
```json
{ "status": "hidden" }  // "approved" | "hidden" | "pending"
```

---

## 14. Shipping Profiles

> Sellers configure their custom logistics rules. Admins can view all by passing `?sellerId=`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/shipping` | Seller | Create a shipping profile |
| `GET` | `/shipping` | Seller/Admin | List own profiles (Admin: filter `?sellerId=`) |
| `PUT` | `/shipping/:id` | Seller | Update a shipping profile |
| `DELETE` | `/shipping/:id` | Seller/Admin | Delete a shipping profile |

### `POST /shipping`
```json
// Body
{
  "name": "Standard Delivery",
  "processingDays": 2,
  "shippingType": "paid",     // "free" | "paid" | "flat" (auto-resolved if omitted)
  "baseChargePaise": 4900,    // ₹49
  "codAvailable": true,
  "freeShippingAbove": 50000  // free shipping if cart > ₹500 (in paise)
}
```

### `PUT /shipping/:id`
```json
// Body — all optional
{
  "baseChargePaise": 3900,
  "freeShippingAbove": 30000,
  "codAvailable": false
}
```

---

## 15. Seller Stores / Warehouses

> Stores use MongoDB 2dsphere GeoJSON for geospatial proximity queries.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/stores` | Seller | Register a warehouse/store location |
| `GET` | `/stores` | Seller/Admin | List own stores (Admin: filter `?sellerId=`) |
| `PUT` | `/stores/:id` | Seller | Update a store |
| `DELETE` | `/stores/:id` | Seller/Admin | Delete a store |
| `GET` | `/stores/nearby` | Public | Find active stores within radius |

### `POST /stores`
```json
// Body
{
  "name": "South Warehouse",
  "address": {
    "line1": "Plot 12, Industrial Estate",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "pincode": "600001"
  },
  "coordinates": [80.2707, 13.0827]  // [longitude, latitude] — GeoJSON order
}
```

### `GET /stores/nearby` (Public)
```
Query: ?lng=80.2707&lat=13.0827&radiusKm=15
```
```json
// 200 Response
{
  "stores": [
    {
      "_id": "...",
      "name": "South Warehouse",
      "sellerId": { "businessName": "...", "ratingAverage": 4.5 },
      "location": { "type": "Point", "coordinates": [80.27, 13.08] }
    }
  ]
}
```

---

## 16. Webhooks

> Sellers and admins can register URLs to receive real-time event notifications via HTTP POST.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/webhooks` | Seller/Admin | Register a webhook subscription |
| `GET` | `/webhooks` | Seller/Admin | List own webhooks (Admin: all) |
| `PUT` | `/webhooks/:id` | Seller/Admin | Update webhook URL, events, or active status |
| `DELETE` | `/webhooks/:id` | Seller/Admin | Delete a subscription |

### `POST /webhooks`
```json
// Body
{
  "url": "https://myapp.com/hooks/hmarketplace",
  "events": ["order.created", "order.cancelled", "order.status_updated"]
}

// 201 Response
{
  "subscription": {
    "_id": "...",
    "url": "https://myapp.com/hooks/hmarketplace",
    "events": ["order.created", ...],
    "secret": "whsec_...",  // HMAC secret — use this to verify incoming payloads
    "isActive": true
  }
}
```

### Available Event Types
| Event | Triggered By |
|---|---|
| `order.created` | `placeOrder` |
| `order.cancelled` | `cancelOrder` |
| `order.status_updated` | `updateOrderStatus` |

### `PUT /webhooks/:id`
```json
// Body — all optional
{
  "url": "https://myapp.com/hooks/v2",
  "events": ["order.created"],
  "isActive": false
}
```

---

## 17. Admin Panel

> All endpoints under `/admin` apply `authenticateUser` + `requireRoles("admin")` globally.

| Method | Path | Description |
|---|---|---|
| `POST` | `/admin/expenses` | Record a platform operational expense |
| `GET` | `/admin/expenses` | List expenses (filterable by date/category) |
| `GET` | `/admin/expenses/summary` | Revenue vs. expense net-profit summary |
| `GET` | `/admin/audit-logs` | Browse platform audit log events |
| `GET` | `/admin/moderation/products` | Paginated list of products awaiting moderation |
| `POST` | `/admin/moderation/products/bulk` | Bulk approve / reject / hide products |
| `GET` | `/admin/brands` | List all platform brands (paginated + filterable) |
| `PATCH` | `/admin/brands/:id/status` | Update verification and activation status of a brand |

### `GET /admin/expenses/summary`
```json
// 200 Response
{
  "summary": {
    "totalRevenuePaise": 12450000,
    "totalExpensesPaise": 3200000,
    "netProfitPaise": 9250000,
    "expensesByCategory": { "marketing": 1500000, "logistics": 1700000 }
  }
}
```

### `POST /admin/moderation/products/bulk`
```json
// Body
{
  "productIds": ["<ObjectId>", "<ObjectId>"],
  "action": "approved"  // "approved" | "rejected" | "hidden"
}
// Queues notification emails to affected sellers
```

### `GET /admin/brands`
```json
// Query options: ?page=1&limit=20&name=apple&isActive=true&isVerified=true
// 200 Response
{
  "success": true,
  "brands": [
    {
      "_id": "6474b5c7f1a3b4e1a0c8b9a1",
      "name": "Apple",
      "slug": "apple",
      "isVerified": true,
      "isActive": true,
      "createdBy": "6474b5c7f1a3b4e1a0c8b9d0",
      "sellerId": "6474b5c7f1a3b4e1a0c8b9f1",
      "createdAt": "2026-05-29T11:00:00.000Z",
      "updatedAt": "2026-05-29T11:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### `PATCH /admin/brands/:id/status`
```json
// Body (both optional, at least one required)
{
  "isActive": false,
  "isVerified": true
}

// 200 Response
{
  "success": true,
  "message": "Brand status updated successfully.",
  "brand": {
    "_id": "6474b5c7f1a3b4e1a0c8b9a1",
    "name": "Apple",
    "slug": "apple",
    "isVerified": true,
    "isActive": false,
    "createdBy": "6474b5c7f1a3b4e1a0c8b9d0",
    "sellerId": "6474b5c7f1a3b4e1a0c8b9f1",
    "createdAt": "2026-05-29T11:00:00.000Z",
    "updatedAt": "2026-05-29T18:20:00.000Z"
  }
}
```

---

## 💡 Common Patterns

### Pagination
All list endpoints support:
```
?page=1&limit=20
```
Responses include:
```json
"pagination": { "page": 1, "limit": 20, "total": 150, "pages": 8 }
```

### Money / Prices
All monetary values are stored and transmitted in **paise** (1/100th of a rupee):
- ₹499 → `49900 paise`
- ₹0.50 → `50 paise`

### Error Responses
```json
// 400 Bad Request
{ "success": false, "message": "Required fields: code, discountType, ..." }

// 401 Unauthorized
{ "success": false, "message": "Not authenticated." }

// 403 Forbidden
{ "success": false, "message": "Forbidden. You do not own this resource." }

// 404 Not Found
{ "success": false, "message": "Order not found." }

// 409 Conflict
{ "success": false, "message": "Insufficient stock for: Classic Cotton T-Shirt." }

// 500 Internal Server Error
{ "success": false, "message": "Internal server error." }
```

### Health Check
```
GET /health
→ 200 { "success": true, "message": "Server is healthy." }
```
