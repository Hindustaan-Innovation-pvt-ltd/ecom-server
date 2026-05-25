# HMarketplace — MongoDB Database Architecture

## Database Type
- Database: MongoDB
- ODM: Mongoose
- Language: TypeScript
- Backend: Node.js + Express
- Cache: Redis
- Payment Provider: Razorpay

---

# Collections Overview

1. users
2. sellers
3. addresses
4. categories
5. products
6. product_images
7. product_variants
8. carts
9. cart_items
10. coupons
11. orders
12. order_items
13. payments
14. returns
15. refunds
16. reviews
17. seller_payouts
18. admin_audit_logs

---

# 1. users

```json
{
  "_id": "ObjectId",
  "fullName": "string",
  "email": "string",
  "phone": "string",
  "passwordHash": "string",
  "avatarUrl": "string",
  "role": "customer | seller | admin",
  "isActive": true,
  "lastLoginAt": "Date",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- email (unique)
- phone (unique)
- role

Relations:
- users._id -> sellers.userId
- users._id -> addresses.userId
- users._id -> carts.userId
- users._id -> orders.userId
- users._id -> reviews.userId

---

# 2. sellers

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "businessName": "string",
  "gstNumber": "string",
  "businessPhone": "string",
  "businessEmail": "string",
  "approvalStatus": "pending | approved | rejected",
  "rejectionReason": "string",
  "approvedBy": "ObjectId",
  "approvedAt": "Date",
  "ratingAverage": 0,
  "totalSales": 0,
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- userId
- approvalStatus

Relations:
- sellers.userId -> users._id

---

# 3. addresses

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "fullName": "string",
  "phone": "string",
  "line1": "string",
  "line2": "string",
  "city": "string",
  "state": "string",
  "country": "string",
  "pincode": "string",
  "landmark": "string",
  "isDefault": true,
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- userId

Relations:
- addresses.userId -> users._id

---

# 4. categories

```json
{
  "_id": "ObjectId",
  "name": "string",
  "slug": "string",
  "imageUrl": "string",
  "isActive": true,
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- slug (unique)

Relations:
- categories._id -> products.categoryId

---

# 5. products

```json
{
  "_id": "ObjectId",
  "sellerId": "ObjectId",
  "categoryId": "ObjectId",

  "title": "string",
  "slug": "string",
  "description": "string",

  "brand": "string",
  "sku": "string",

  "pricePaise": 0,
  "comparePricePaise": 0,

  "inventory": 0,

  "tags": ["string"],

  "isActive": true,

  "moderationStatus": "pending | approved | hidden | removed",
  "moderationReason": "string",

  "moderatedBy": "ObjectId",

  "ratingAverage": 0,
  "reviewCount": 0,

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- sellerId
- categoryId
- slug (unique)
- moderationStatus
- tags

Relations:
- products.sellerId -> sellers._id
- products.categoryId -> categories._id

---

# 6. product_images

```json
{
  "_id": "ObjectId",
  "productId": "ObjectId",
  "imageUrl": "string",
  "sortOrder": 0,
  "createdAt": "Date"
}
```

Indexes:
- productId

Relations:
- product_images.productId -> products._id

---

# 7. product_variants

```json
{
  "_id": "ObjectId",
  "productId": "ObjectId",

  "option1": "string",
  "option2": "string",
  "option3": "string",

  "pricePaise": 0,
  "inventory": 0,

  "sku": "string",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- productId
- sku

Relations:
- product_variants.productId -> products._id

---

# 8. carts

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- userId

Relations:
- carts.userId -> users._id

---

# 9. cart_items

```json
{
  "_id": "ObjectId",
  "cartId": "ObjectId",

  "productId": "ObjectId",
  "variantId": "ObjectId",

  "quantity": 1,

  "unitPricePaise": 0,

  "titleSnapshot": "string",
  "imageSnapshot": "string",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- cartId
- productId

Relations:
- cart_items.cartId -> carts._id
- cart_items.productId -> products._id

---

# 10. coupons

```json
{
  "_id": "ObjectId",

  "code": "string",

  "discountType": "percent | flat",

  "discountValue": 0,

  "minOrderValue": 0,
  "maxDiscountValue": 0,

  "usageLimit": 0,
  "perUserLimit": 0,

  "usedCount": 0,

  "startsAt": "Date",
  "endsAt": "Date",

  "isActive": true,

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- code (unique)

---

# 11. orders

```json
{
  "_id": "ObjectId",

  "orderNumber": "string",

  "userId": "ObjectId",

  "addressId": "ObjectId",

  "status": "pending_payment | confirmed | cancelled | fulfilled | refunded",

  "currency": "INR",

  "subtotalPaise": 0,
  "shippingPaise": 0,
  "discountPaise": 0,
  "taxPaise": 0,
  "totalPaise": 0,

  "couponCode": "string",

  "placedAt": "Date",
  "confirmedAt": "Date",
  "cancelledAt": "Date",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- userId
- orderNumber (unique)
- status

Relations:
- orders.userId -> users._id
- orders.addressId -> addresses._id

---

# 12. order_items

```json
{
  "_id": "ObjectId",

  "orderId": "ObjectId",

  "productId": "ObjectId",
  "sellerId": "ObjectId",
  "variantId": "ObjectId",

  "productTitle": "string",
  "productImage": "string",

  "quantity": 1,

  "unitPricePaise": 0,
  "lineTotalPaise": 0,

  "fulfillmentStatus": "pending | shipped | delivered | returned",

  "createdAt": "Date"
}
```

Indexes:
- orderId
- sellerId
- fulfillmentStatus

Relations:
- order_items.orderId -> orders._id
- order_items.productId -> products._id
- order_items.sellerId -> sellers._id

---

# 13. payments

```json
{
  "_id": "ObjectId",

  "orderId": "ObjectId",

  "provider": "razorpay",

  "razorpayOrderId": "string",
  "razorpayPaymentId": "string",

  "status": "created | authorized | captured | failed | refunded",

  "amountPaise": 0,
  "currency": "INR",

  "failureReason": "string",

  "paidAt": "Date",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- orderId
- razorpayOrderId
- razorpayPaymentId

Relations:
- payments.orderId -> orders._id

---

# 14. returns

```json
{
  "_id": "ObjectId",

  "orderId": "ObjectId",
  "orderItemId": "ObjectId",

  "sellerId": "ObjectId",

  "reason": "string",

  "status": "requested | approved | rejected | received | refunded",

  "requestedAt": "Date",

  "updatedAt": "Date"
}
```

Indexes:
- orderId
- orderItemId
- sellerId

Relations:
- returns.orderId -> orders._id
- returns.orderItemId -> order_items._id

---

# 15. refunds

```json
{
  "_id": "ObjectId",

  "returnId": "ObjectId",
  "paymentId": "ObjectId",

  "amountPaise": 0,

  "providerRefundId": "string",

  "status": "initiated | processed | failed",

  "processedAt": "Date",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- returnId
- paymentId

Relations:
- refunds.returnId -> returns._id
- refunds.paymentId -> payments._id

---

# 16. reviews

```json
{
  "_id": "ObjectId",

  "userId": "ObjectId",
  "productId": "ObjectId",
  "sellerId": "ObjectId",

  "rating": 5,

  "title": "string",
  "comment": "string",

  "status": "pending | approved | hidden",

  "createdAt": "Date",
  "updatedAt": "Date"
}
```

Indexes:
- productId
- sellerId
- rating

Relations:
- reviews.userId -> users._id
- reviews.productId -> products._id

---

# 17. seller_payouts

```json
{
  "_id": "ObjectId",

  "sellerId": "ObjectId",

  "orderId": "ObjectId",

  "amountPaise": 0,

  "status": "pending | paid | failed",

  "payoutRef": "string",

  "paidAt": "Date",

  "createdAt": "Date"
}
```

Indexes:
- sellerId
- orderId

Relations:
- seller_payouts.sellerId -> sellers._id

---

# 18. admin_audit_logs

```json
{
  "_id": "ObjectId",

  "adminId": "ObjectId",

  "action": "string",

  "entityType": "string",

  "entityId": "ObjectId",

  "metadata": {},

  "createdAt": "Date"
}
```

Indexes:
- adminId
- entityType
- entityId

Relations:
- admin_audit_logs.adminId -> users._id

---

# Recommended Redis Usage

```md
Redis:
- session store
- cart cache
- product cache
- rate limiting
- temporary OTP storage
- background queues
```

---

# Recommended Storage Architecture

```md
Media Storage:
- Product Images
- Seller Documents
- Invoice PDFs
- Review Images

Possible Providers:
- AWS S3
- Cloudinary
- MEGA
- Supabase Storage
```

---

# Recommended MongoDB Patterns

```md
Use References:
- users
- products
- orders
- sellers

Use Snapshots:
- order_items productTitle
- order_items productImage
- cart_items titleSnapshot

Avoid Deep Embedding:
- products should not fully embed reviews
- orders should not fully embed payments

Use Transactions:
- payment capture
- inventory update
- order confirmation
- refund processing
```