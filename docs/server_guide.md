# HMarketplace Backend — Server Setup, Architecture & API Guide

Welcome to the central developer documentation for the HMarketplace backend. This guide details the environment setup, database designs, file upload pipelines, authentication paradigms, and complete API endpoint specifications for the system.

---

## 1. Project Overview & Tech Stack
The HMarketplace backend is built to run a high-performance, type-safe, and highly secure e-commerce application.
- **Runtime**: Node.js
- **Framework**: Express.js with TypeScript (`nodenext` ESM modules)
- **Database**: MongoDB utilizing the Mongoose ODM
- **Authentication**: Passport.js stateful Local Strategy with `cookie-session` storage
- **Security**: AES-256-CBC stable password encryption with SHA-256 key derivation and role-based permissions (RBAC)
- **File Uploads**: Multer multi-part parser integrated with **Cloudinary** cloud storage with recursive folders and local caching fallbacks
- **Clustering**: Built-in production core clustering for load balancing

---

## 2. Setup & Installation

### Prerequisites
1. **Node.js**: v20+ recommended
2. **MongoDB**: Local standalone instance or remote cluster (Atlas)
3. **Cloudinary Account**: Needed if cloud profile image upload is desired. Falls back to local serving if not set.

### Installation Steps
1. Navigate to the backend directory and install dependencies:
   ```bash
   npm install
   ```
2. Create and configure your `.env` file (copied from `.env.example`):
   ```bash
   cp .env.example .env
   ```

### Configuration Parameters (`.env`)
| Key | Type | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `string` | Defines runtime mode: `development` or `production`. |
| `PORT` | `number` | Port on which Express server binds (default: `8888` / `8080`). |
| `MONGODB_URI` | `string` | MongoDB Mongoose connection string. |
| `SESSION_SECRET` | `string` | Secret key used to encrypt and sign cookie-sessions. |
| `ENCRYPTION_KEY` | `string` | Passphrase used to derive 32-byte AES key for password encryption. |
| `CLOUDINARY_CLOUD_NAME` | `string` | Cloudinary account Cloud Name (also accepts `CLOUDINARY_BUCKET_NAME`). |
| `CLOUDINARY_API_KEY` | `string` | Cloudinary API Key. |
| `CLOUDINARY_API_SECRET` | `string` | Cloudinary API Secret. |
| `REDIS_URL` | `string` | Redis connection URL (default: `redis://127.0.0.1:6379`). |
| `SMTP_HOST` | `string` | Nodemailer SMTP server host name (e.g. `smtp.mailtrap.io`). |
| `SMTP_PORT` | `number` | SMTP server port number (e.g. `2525`, `465`, `587`). |
| `SMTP_USER` | `string` | SMTP username. |
| `SMTP_PASS` | `string` | SMTP password. |
| `EMAIL_FROM` | `string` | Email from header (e.g. `"HMarketplace <noreply@hmarketplace.com>"`). |

### Running the Server
- **Development Mode** (with Nodemon auto-reload, TSX env binding, and type watching):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  node dist/server.js
  ```
- **TypeScript Type Verification**:
  ```bash
  npx tsc --noEmit
  ```

---

## 3. Core Architecture Breakdown

```
 ┌──────────────────────────┐
 │      Express Client      │
 └────────────┬─────────────┘
              │ (Multipart / JSON)
              ▼
 ┌──────────────────────────┐
 │    Multer File upload    │  ──► Saves temp local copy in uploads/user_profile/
 └────────────┬─────────────┘
              │ (Streams local copy)
              ▼
 ┌──────────────────────────┐
 │   Cloudinary Cloud sync  │  ──► Uploads file to Cloudinary, returns HTTPS secure URL.
 └────────────┬─────────────┘      (Falls back to local static routing if blank)
              │
              ▼
 ┌──────────────────────────┐
 │    Passport.js Strategy  │  ──► Validates email/phone, compares passwords
 └────────────┬─────────────┘      via derived AES-256-CBC, and stores session id
              │
              ▼
 ┌──────────────────────────┐
 │    Mongoose Database     │  ──► Unified rollbacks: Deletes User if Seller
 └──────────────────────────┘      profile creation fails. Strict validations.
```

### Password Encryption Model
Unlike traditional hash methods, this project implements a stable two-way AES-256-CBC password encryption algorithm defined in `src/utils/password.ts`.
- **Derived AES Key**: The key is loaded from `.env` (`ENCRYPTION_KEY`). If the passphrase length is not exactly 64-hexadecimal characters, it is passed through a **SHA-256** hash to secure a stable 32-byte key. A default developer fallback key is hashed if none is specified, preventing users from getting locked out upon restarts.
- **Salt & IV**: Every encryption call derives a secure 16-byte initialization vector (`crypto.randomBytes(16)`), prepending it to the hexadecimal ciphertext separated by a colon (`ivHex:ciphertextHex`) to allow decryption.

### Unified Image Upload & Fail-safe Pipeline
- Profile pictures are uploaded via the **Multer** middleware (`src/middleware/upload.ts`) which enforces size limitations (5MB) and type constraints (jpeg, jpg, png, webp, gif).
- Uploads are saved in `uploads/user_profile/` with timestamped and randomized suffixes (`avatar-timestamp-random.ext`) to avoid collisons.
- The **Cloudinary Utility** (`src/utils/cloudinary.ts`) receives the local copy, and performs upload using the Cloudinary uploader API under the `hmarketplace/user_profile` namespace. Upon success, it fetches the HTTPS `secure_url`.
- **Fail-safe Fallback**: If cloud credentials are empty or the cloud service is offline, the system automatically redirects the URL to a local static served Express path: `/uploads/user_profile/filename.ext`, guaranteeing local environments are never blocked.

### Resilient Email Dispatch & Template Engine
The application uses a decoupled, fail-safe email generation and transmission system (`src/services/email.ts` and `src/services/emailTemplates.ts`).
- **Separation of Concerns**: Layout structures and templates are stored separately in `emailTemplates.ts`. This contains the base HTML wrapper (`getHtmlTemplate`) featuring standard e-commerce responsive layouts, and generator functions for specific emails (`getWelcomeEmail`, `getSellerPendingEmail`, `getSellerStatusEmail`).
- **Nodemailer SMTP Transporter**: The main service in `email.ts` initializes SMTP configurations with reject-unauthorized flags to support self-signed local certs, falling back to dynamic Ethereal testing accounts in development.
- **Dry-run Console Fallback**: If offline or if credentials/SMTP configuration is missing entirely, the system intercepts mail dispatches gracefully and writes complete plain-text mail formats straight to the process stdout logs, preventing database flow blockages.

### Admin Approval Security Layer for Sellers
Every seller profile is initially created with a `pending` status. To prevent unapproved sellers from listing offers, registering custom brands, or creating catalog products, the backend implements a strict, status-based verification middleware:
- **`requireApprovedSeller` Middleware** (`src/middleware/auth.ts`): Applied to all seller-restricted routes. It verifies that the caller's seller profile status is `"approved"`.
- **Administrator Bypass**: Admins are automatically bypassed by the check to ensure they can administer products, stores, and shipping configurations on overlapping route paths.
- **Access Control**: Sellers in `pending` or `rejected` status are restricted to `/profile` (view status and cancel application) and blocked from all other seller operations (responding with `403 Forbidden`).

---

## 4. Complete API Endpoint Specification

All requests returning success or failure conform to a unified JSON layout:
```json
{
  "success": true | false,
  "message": "Descriptive message.",
  "user": {},
  "seller": {}
}
```

---

### User & Authentication Module (`/api/auth`)

#### 1. Create User
- **Method & Path**: `POST /api/auth/register`
- **Content-Type**: `multipart/form-data`
- **Body Fields**:
  - `fullName` (String, required, min 2 chars)
  - `email` (String, required, unique)
  - `phone` (String, required, unique)
  - `password` (String, required)
  - `avatar` (File, Optional, profile picture upload)
  - `role` (String, optional: `customer` | `admin`, defaults to `customer`)
- **Response**: `201 Created`
- **Session state**: Establishes Passport session cookie.

#### 2. User Credentials Login
- **Method & Path**: `POST /api/auth/login`
- **Content-Type**: `application/json`
- **Body Fields**:
  - `emailOrPhone` (String, required, maps to email or phone number in database)
  - `password` (String, required)
- **Response**: `200 OK`
- **Session state**: Establishes Passport session cookie.

#### 3. User Session Logout
- **Method & Path**: `POST /api/auth/logout`
- **Response**: `200 OK`
- **Session state**: Destroys active passport session and wipes cookie session structures.

#### 4. Read Active Session Profile
- **Method & Path**: `GET /api/auth/me`
- **Authentication**: Requires active passport session.
- **Response**: `200 OK` with user details (and attached seller details if user's role is `seller`).

#### 5. Read All Users List (Admin Only)
- **Method & Path**: `GET /api/auth/users`
- **Authentication**: Requires active passport session with `admin` role permissions.
- **Response**: `200 OK` containing array of user documents (excluding credentials hashes).

#### 6. Read Specific User Profile
- **Method & Path**: `GET /api/auth/users/:id`
- **Authentication**: Requires active passport session. Limited to **Admin** or the **User themselves**.
- **Response**: `200 OK` containing requested profile.

#### 7. Update Active User Profile (Self Only)
- **Method & Path**: `PUT /api/auth/me`
- **Authentication**: Requires active passport session.
- **Content-Type**: `multipart/form-data` / `application/json`
- **Body Fields**:
  - `fullName` (String, optional)
  - `email` (String, optional, checked for uniqueness)
  - `phone` (String, optional, checked for uniqueness)
  - `password` (String, optional)
  - `avatar` (File, optional avatar picture update)
- **Response**: `200 OK` with updated user document.

#### 8. Suspend or Reactivate User (Admin Only)
- **Method & Path**: `PUT /api/auth/users/:id/status`
- **Authentication**: Requires active passport session with `admin` role permissions.
- **Body Fields**:
  - `isActive` (Boolean, required status toggle)
- **Response**: `200 OK` confirming toggle success. Suspended users will be forced out of active sessions.

#### 9. Self Account Deletion (Self Only)
- **Method & Path**: `DELETE /api/auth/me`
- **Authentication**: Requires active passport session.
- **Response**: `200 OK` confirming deletion. Destroys linked seller documents and active passport session.

#### 10. Force Delete User (Admin Only)
- **Method & Path**: `DELETE /api/auth/users/:id`
- **Authentication**: Requires active passport session with `admin` role permissions.
- **Response**: `200 OK` confirming deletion and cascading linked seller profile removals.

---

### Seller Onboarding & Management Module (`/api/seller`)

#### 1. Onboard / Register Seller
- **Method & Path**: `POST /api/seller/register`
- **Content-Type**: `multipart/form-data`
- **Body Fields**:
  - **User Account Fields**:
    - `fullName`, `email`, `phone`, `password`, `avatar` (File, optional)
  - **Business Details Fields**:
    - `businessName` (String, required)
    - `gstNumber` (String, required, Indian format validated)
    - `businessPhone` (String, required)
    - `businessEmail` (String, required)
- **Two-Step Creation Flow**:
  1. Creates User account with `role: "seller"`.
  2. Extracts User ID, assigns to Seller `userId` field, and creates Seller profile.
  3. **Rollback**: If Seller profile creation fails (e.g. invalid GST number or duplicate), the User account is automatically deleted to keep databases consistent.
- **Response**: `201 Created` with linked User & Seller profiles.
- **Session state**: Establishes Passport session cookie.

#### 2. Read Own Seller Business Profile (Seller Only)
- **Method & Path**: `GET /api/seller/profile`
- **Authentication**: Requires active passport session with `seller` role permissions.
- **Response**: `200 OK` returning seller business fields.

#### 3. Read All Registered Sellers List (Admin Only)
- **Method & Path**: `GET /api/seller`
- **Authentication**: Requires active passport session with `admin` role permissions.
- **Query Params**:
  - `status` (String, optional: `pending` | `approved` | `rejected`)
- **Response**: `200 OK` returning populated seller profiles.

#### 4. Read Specific Seller Business Profile (Public)
- **Method & Path**: `GET /api/seller/:id`
- **Authentication**: Publicly available (allows customers to check store ratings and details).
- **Response**: `200 OK` with populated seller business and rating profile.

#### 5. Update Own Seller Business Profile (Seller Only)
- **Method & Path**: `PUT /api/seller/profile`
- **Authentication**: Requires active passport session with `seller` role permissions.
- **Body Fields**:
  - `businessName`, `businessPhone`, `businessEmail`, `gstNumber` (All optional, validates GST uniqueness)
- **Response**: `200 OK` with updated seller business document.

#### 6. Approve / Reject Seller Onboarding (Admin Only)
- **Method & Path**: `PUT /api/seller/:id/status`
- **Authentication**: Requires active passport session with `admin` role permissions.
- **Body Fields**:
  - `approvalStatus` (String, required: `approved` | `rejected` | `pending`)
  - `rejectionReason` (String, required if rejected, clears if approved)
- **Response**: `200 OK` with updated status.

#### 7. Delete Own Seller Business Profile (Seller Only)
- **Method & Path**: `DELETE /api/seller/profile`
- **Authentication**: Requires active passport session with `seller` role permissions.
- **Response**: `200 OK` confirming deletion. The seller business record is removed, and the caller user account role is automatically reverted to `customer`.

#### 8. Force Delete Seller Account (Admin Only)
- **Method & Path**: `DELETE /api/seller/:id`
- **Authentication**: Requires active passport session with `admin` role permissions.
- **Response**: `200 OK`. Deletes the seller record and automatically cascades deletion to the linked user account.

---

### Address Management Module (`/api/address`)

All endpoints require a valid active customer or seller session.

#### 1. Add Shipping Address
- **Method & Path**: `POST /api/address`
- **Content-Type**: `application/json`
- **Body Fields**:
  - `fullName` (String, required)
  - `phone` (String, required, valid Indian mobile format e.g. `+919876543210` or `09876543210`)
  - `line1` (String, required, flat/house/building details)
  - `line2` (String, required, area/sector/street details)
  - `landmark` (String, required, near landmark - *critical in India*)
  - `city` (String, required, city/district)
  - `state` (String, required, valid Indian State or UT name)
  - `pincode` (String, required, strictly 6-digit Indian PIN code starting with `1-9` e.g. `400001`)
  - `isDefault` (Boolean, optional, defaults to `false`)
- **Pre-save Hook**: Automatically toggles off default status for any other address of the same user if this one is set as default.
- **Response**: `201 Created`

#### 2. List Own Addresses
- **Method & Path**: `GET /api/address`
- **Response**: `200 OK`
- **Sorting**: Automatically sorts the active default address first, followed by the rest in descending order of last updated.

#### 3. Read Specific Address
- **Method & Path**: `GET /api/address/:id`
- **Authentication**: Owner or Admin only.
- **Response**: `200 OK`

#### 4. Update Own Address Details
- **Method & Path**: `PUT /api/address/:id`
- **Content-Type**: `application/json`
- **Body Fields**: (All optional) `fullName`, `phone`, `line1`, `line2`, `landmark`, `city`, `state`, `pincode`, `isDefault`
- **Response**: `200 OK`

#### 5. Delete Own Address
- **Method & Path**: `DELETE /api/address/:id`
- **Fallback Promotion**: If the deleted address was the user's default, the system automatically promotes their next most recently updated address to default.
- **Response**: `200 OK`

---

### Product Catalog & Inventory Module (`/api/product`)

Handles categories, products, image assets, and variants.

#### 1. Create Category
- **Method & Path**: `POST /api/product/categories`
- **Authentication**: Admin only.
- **Body Fields**:
  - `name` (String, required)
  - `imageUrl` (String, optional)
- **Response**: `201 Created`

#### 2. Get All Categories
- **Method & Path**: `GET /api/product/categories`
- **Authentication**: Public.
- **Response**: `200 OK`

#### 3. Create Product
- **Method & Path**: `POST /api/product`
- **Authentication**: Seller only.
- **Body Fields**:
  - `categoryId` (String, required, valid Category Object ID)
  - `title` (String, required)
  - `description` (String, required)
  - `brand` (String, required)
  - `sku` (String, required, unique stock keeping unit code)
  - `pricePaise` (Number, required, INR Price represented in *Paise* integers to prevent floating-point calculation errors)
  - `comparePricePaise` (Number, optional, comparison Price in Paise)
  - `inventory` (Number, required)
  - `tags` (Array or comma-separated string, optional)
- **Response**: `201 Created` (Saves as `moderationStatus: "pending"`)

#### 4. Advanced Product Query Listing
- **Method & Path**: `GET /api/product`
- **Authentication**: Public (returns active, approved products only).
- **Query Parameters**:
  - `categoryId`, `brand`, `tag` (Filter fields)
  - `minPrice`, `maxPrice` (INR price range filters, passed in Paise)
  - `search` (Search query matches Title, Description, Brand, or Tags using regex)
  - `sort` (`newest` | `priceAsc` | `priceDesc`)
  - `page`, `limit` (Pagination controls)
- **Response**: `200 OK` with populated category/seller profiles, pagination metadata, and total count.

#### 5. Detailed Product Inspection (Slug-based)
- **Method & Path**: `GET /api/product/slug/:slug`
- **Authentication**: Public.
- **Response**: `200 OK` with fully populated category and seller profiles, alongside embedded arrays for all extra images and variants.

#### 6. Update Product
- **Method & Path**: `PUT /api/product/:id`
- **Authentication**: Owner Seller only.
- **Response**: `200 OK`

#### 7. Delete Product
- **Method & Path**: `DELETE /api/product/:id`
- **Authentication**: Owner Seller or Admin.
- **Cascading Action**: Deleting a product automatically cascades in parallel to erase all associated product variants and image assets from the database.
- **Response**: `200 OK`

#### 8. Upload Extra Product Images
- **Method & Path**: `POST /api/product/:id/images`
- **Authentication**: Owner Seller only.
- **Content-Type**: `multipart/form-data`
- **File Field**: `images` (Supports array upload up to 10 image files, routed through Cloudinary with local upload fallbacks)
- **Response**: `201 Created`

#### 9. Delete Product Image
- **Method & Path**: `DELETE /api/product/images/:imageId`
- **Authentication**: Owner Seller only.
- **Response**: `200 OK`

#### 10. Add Product Variant
- **Method & Path**: `POST /api/product/:id/variants`
- **Authentication**: Owner Seller only.
- **Body Fields**:
  - `option1` (String, required e.g., Size, Volume)
  - `option2`, `option3` (String, optional)
  - `pricePaise` (Number, required, variant price in Paise)
  - `inventory` (Number, optional, defaults to 0)
  - `sku` (String, required, unique variant SKU)
- **Response**: `201 Created`

#### 11. Update Product Variant
- **Method & Path**: `PUT /api/product/variants/:variantId`
- **Authentication**: Owner Seller only.
- **Response**: `200 OK`

#### 12. Delete Product Variant
- **Method & Path**: `DELETE /api/product/variants/:variantId`
- **Authentication**: Owner Seller only.
- **Response**: `200 OK`

---

## 5. Verification & Testing

This project leverages TypeScript compiler diagnostics and a local dev server setup for validation.

### Type Safety Verification
To perform static code analysis and verify type safety across the entire application:
```bash
npx tsc --noEmit
```

### Development Runtime
Start the Express server with local automatic restarts, TSX, and environment variable bindings:
```bash
npm run dev
```
