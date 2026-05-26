# HMarketplace — Entity Relationship (ER) Diagram

Below is the complete entity-relationship structure representing the currently implemented database architecture for the HMarketplace backend.

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
    
    SELLER ||--o{ PRODUCT : "supplies (1:N)"
    SELLER ||--o{ SELLER_LISTING : "owns selling listing (1:N)"
    SELLER ||--o{ COUPON : "issues promotional coupons (1:N)"
    SELLER ||--o{ ORDER_ITEM : "fulfills (1:N)"
    
    CATEGORY ||--o{ PRODUCT : "classifies (1:N)"
    CATEGORY ||--o{ CATEGORY : "has subcategory parentId (1:N)"
    
    BRAND ||--o{ PRODUCT : "brands (1:N)"
    
    PRODUCT ||--o{ PRODUCT_IMAGE : "has additional photos (1:N)"
    PRODUCT ||--o{ PRODUCT_VARIANT : "has variations (1:N)"
    
    PRODUCT_VARIANT ||--o{ SELLER_LISTING : "sold under listing (1:N)"
    
    SELLER_LISTING ||--|| LISTING_INVENTORY : "tracks available stock (1:1)"
    SELLER_LISTING ||--o{ LISTING_PRICING_HISTORY : "logs price variations (1:N)"
    
    CART ||--o{ CART_ITEM : "contains embedded (1:N)"
    CART_ITEM }|--|| PRODUCT : "references (M:1)"
    CART_ITEM }|--|| PRODUCT_VARIANT : "references (M:1)"

    COUPON ||--o{ COUPON_USAGE : "has been used (1:N)"
    ORDER ||--o{ COUPON_USAGE : "associated with coupon ledger (1:N)"

    ORDER ||--o{ ORDER_ITEM : "contains embedded (1:N)"
    ORDER_ITEM }|--|| PRODUCT : "references (M:1)"
    ORDER_ITEM }|--|| PRODUCT_VARIANT : "references (M:1)"
    ORDER_ITEM }|--|| SELLER_LISTING : "references (M:1)"

    USER {
        ObjectId id PK
        string fullName
        string email "unique"
        string phone "unique"
        string passwordHash
        string avatarUrl
        string role "customer | seller | admin"
        boolean isActive
        Date lastLoginAt
        Date createdAt
        Date updatedAt
    }

    SELLER {
        ObjectId id PK
        ObjectId userId FK "User.id, unique"
        string businessName
        string gstNumber "unique"
        string businessPhone
        string businessEmail
        string approvalStatus "pending | approved | rejected"
        string rejectionReason
        ObjectId approvedBy FK
        Date approvedAt
        number ratingAverage
        number totalSales
        Date createdAt
        Date updatedAt
    }

    ADDRESS {
        ObjectId id PK
        ObjectId userId FK "User.id"
        string fullName
        string phone
        string line1
        string line2
        string landmark
        string city
        string state
        string country
        string pincode
        boolean isDefault
        Date createdAt
        Date updatedAt
    }

    CATEGORY {
        ObjectId id PK
        string name
        string slug "unique"
        ObjectId parentId FK "Category.id"
        number level
        string_array path
        boolean isLeaf
        number sortOrder
        boolean isActive
        Date createdAt
        Date updatedAt
    }

    BRAND {
        ObjectId id PK
        string name
        string slug "unique"
        string logoUrl
        boolean isVerified
        Date createdAt
    }

    PRODUCT {
        ObjectId id PK
        ObjectId categoryId FK "Category.id"
        ObjectId brandId FK "Brand.id"
        ObjectId sellerId FK "Seller.id"
        string title
        string slug "unique"
        string shortDescription
        string longDescription
        string_array highlights
        string_array searchKeywords
        Mixed attributeValues
        ObjectId defaultVariantId FK "ProductVariant.id"
        string status "draft | active | blocked"
        string moderationStatus "pending | approved | hidden | removed"
        string moderationReason
        ObjectId moderatedBy FK
        number ratingAverage
        number reviewCount
        ObjectId createdBy FK "User.id"
        ObjectId approvedBy FK "User.id"
        Date createdAt
        Date updatedAt
    }

    PRODUCT_IMAGE {
        ObjectId id PK
        ObjectId catalogProductId FK "Product.id"
        string imageUrl
        string type "image | video"
        number sortOrder
        boolean isPrimary
        Date createdAt
    }

    PRODUCT_VARIANT {
        ObjectId id PK
        ObjectId catalogProductId FK "Product.id"
        string sku "unique"
        Object variantAttributes
        string barcode
        number weight
        Object dimensions
        boolean isActive
        Date createdAt
        Date updatedAt
    }

    SELLER_LISTING {
        ObjectId id PK
        ObjectId sellerId FK "Seller.id"
        ObjectId variantId FK "ProductVariant.id"
        string sellerSku
        string condition "new | refurbished"
        string status "active | paused | blocked"
        Date createdAt
        Date updatedAt
    }

    LISTING_INVENTORY {
        ObjectId id PK
        ObjectId listingId FK "SellerListing.id"
        number availableQuantity
        number reservedQuantity
        number damagedQuantity
        number lowStockThreshold
        Date updatedAt
    }

    LISTING_PRICING_HISTORY {
        ObjectId id PK
        ObjectId listingId FK "SellerListing.id"
        number mrpPaise
        number sellingPricePaise
        number discountPercentage
        Date startAt
        Date endAt
    }

    CART {
        ObjectId id PK
        ObjectId userId FK "User.id, unique"
        string couponCode "optional"
        Date createdAt
        Date updatedAt
    }

    CART_ITEM {
        ObjectId productId FK "Product.id"
        ObjectId variantId FK "ProductVariant.id"
        number quantity
        string titleSnapshot
        string imageSnapshot
        number pricePaiseSnapshot
    }

    COUPON {
        ObjectId id PK
        ObjectId sellerId FK "Seller.id"
        string code "unique"
        string discountType "percent | flat"
        number discountValue
        number minOrderValue
        number maxDiscountValue
        number usageLimit
        number perUserLimit
        number usedCount
        Date startsAt
        Date endsAt
        boolean isActive
        ObjectId[] applicableProducts FK "Product.id"
        ObjectId[] applicableCategories FK "Category.id"
        ObjectId[] applicableListings FK "SellerListing.id"
        Date createdAt
        Date updatedAt
    }

    COUPON_USAGE {
        ObjectId couponId FK "Coupon.id"
        ObjectId userId FK "User.id"
        ObjectId orderId FK "Order.id"
        number discountPaise
        Date usedAt
    }

    ORDER {
        ObjectId id PK
        ObjectId userId FK "User.id"
        ObjectId addressId FK "Address.id"
        Object addressSnapshot "embedded Address fields"
        string couponCode "optional"
        number couponDiscountPaise
        number mrpTotalPaise
        number sellingTotalPaise
        number productDiscountPaise
        number totalPaise
        string paymentStatus "pending | paid | failed | refunded | partially_refunded"
        string paymentMethod "cod"
        string status "pending | confirmed | processing | shipped | delivered | cancelled | return_requested | returned"
        string notes
        string cancellationReason
        Date createdAt
        Date updatedAt
    }

    ORDER_ITEM {
        ObjectId productId FK "Product.id"
        ObjectId variantId FK "ProductVariant.id, optional"
        ObjectId listingId FK "SellerListing.id, optional"
        ObjectId sellerId FK "Seller.id"
        string titleSnapshot
        string imageSnapshot
        string sku "optional"
        number quantity
        number mrpPaiseSnapshot
        number sellingPricePaiseSnapshot
        number couponDiscountPaiseForItem
    }

    WEBHOOK_SUBSCRIPTION {
        ObjectId id PK
        ObjectId userId FK "User.id"
        string url
        string secret "unique"
        string_array events
        boolean isActive
        Date createdAt
        Date updatedAt
    }
```

---

## 📝 Relationship Design Context

1. **User & Seller (1:1)**:
   A `User` can register to become a `Seller`. The seller profile contains business details (business name, GST number) and maintains a direct `userId` reference to its owner user account. If onboarding fails at creation time, a unified rollback cascades to keep data consistent.
2. **Products, Variants & Listings (1:M:M)**:
   A catalog product represents the shared specification (e.g. *iPhone 15*). The product is divided into one or more variations (`ProductVariant` color/storage). Multiple independent sellers can list the same variant for sale using `SellerListing`. This maps to high-performance aggregators.
3. **Cart & CartItems (Embedded 1:N)**:
   Instead of running costly database multi-joins, the customer's cart stores a single document referencing the `User`. Cart lines are embedded directly as a sub-document array.
4. **Seller Coupons (1:N) & coupon scoping**:
   Sellers issue promotional coupons (`Coupon`). The coupon can be scoped by products, categories, or seller listings. The cart validator dynamically filters cart items using these scoping arrays to calculate discounts.
5. **Coupon Usage Tracking**:
   Every coupon redemption is recorded inside the transactional `CouponUsage` ledger. This provides compound-index backed validation for per-user limits and guarantees auditable logs.
6. **Orders & OrderItems (Embedded 1:N)**:
   Placed orders are saved as individual `Order` documents referencing the `User` and `Address` snapshots. Line items are embedded directly inside each order as an `OrderItem` array, keeping snapshots of title, sku, pricing, and pro-rated coupon discounts frozen at purchase time for bookkeeping integrity. The payment gateway integrations are completely bypassed in favor of instant Cash on Delivery confirmation.
7. **Outgoing Webhook Subscriptions (1:N)**:
   Sellers and administrators can register outgoing webhook URLs to receive real-time, `HMAC-SHA256` signed JSON events. Webhook configurations are tracked inside the `WebhookSubscription` schema, supporting secure background notifications of crucial updates.
