import fs from "node:fs"
import path from "node:path"

const collectionPath = path.join(__dirname, 'hmarketplace_collection.json');

// Comprehensive test scripts for each request
const testScripts = {
  "Health Check": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Health check success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.message).to.include(\"healthy\");",
    "});"
  ],
  "Register User": [
    "pm.test(\"Status code is 201 or 202\", function () {",
    "    pm.expect(pm.response.code).to.be.oneOf([201, 202]);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Registration success flag\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});",
    "if (jsonData.user && (jsonData.user._id || jsonData.user.id)) {",
    "    var uId = jsonData.user._id || jsonData.user.id;",
    "    pm.collectionVariables.set(\"userId\", uId);",
    "}"
  ],
  "Login User": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Login successful\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.user).to.exist;",
    "});",
    "if (jsonData.user && (jsonData.user._id || jsonData.user.id)) {",
    "    var uId = jsonData.user._id || jsonData.user.id;",
    "    pm.collectionVariables.set(\"userId\", uId);",
    "}"
  ],
  "Get Profile (Me)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve profile success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.user).to.exist;",
    "});",
    "if (jsonData.user && (jsonData.user._id || jsonData.user.id)) {",
    "    var uId = jsonData.user._id || jsonData.user.id;",
    "    pm.collectionVariables.set(\"userId\", uId);",
    "}"
  ],
  "Get User By ID": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"User matches ID\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.user).to.exist;",
    "});"
  ],
  "Get All Users (Admin)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve users success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.users).to.be.an(\"array\");",
    "});"
  ],
  "Update Profile": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Update profile success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.user).to.exist;",
    "});"
  ],
  "Update User Status & Role (Admin)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Status update success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete Profile": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Profile deleted successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete User By ID (Admin)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Admin forced delete user success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Logout User": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Logout success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Register Seller": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Seller registration success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.seller).to.exist;",
    "});",
    "if (jsonData.seller && (jsonData.seller._id || jsonData.seller.id)) {",
    "    var sId = jsonData.seller._id || jsonData.seller.id;",
    "    pm.collectionVariables.set(\"sellerId\", sId);",
    "}",
    "if (jsonData.user && (jsonData.user._id || jsonData.user.id)) {",
    "    var uId = jsonData.user._id || jsonData.user.id;",
    "    pm.collectionVariables.set(\"userId\", uId);",
    "}"
  ],
  "Get Seller Profile": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve seller profile success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.seller).to.exist;",
    "});",
    "if (jsonData.seller && (jsonData.seller._id || jsonData.seller.id)) {",
    "    var sId = jsonData.seller._id || jsonData.seller.id;",
    "    pm.collectionVariables.set(\"sellerId\", sId);",
    "}"
  ],
  "Get All Sellers (Admin)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve sellers success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.sellers).to.be.an(\"array\");",
    "});"
  ],
  "Get Public Seller Details": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve public seller success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.seller).to.exist;",
    "});"
  ],
  "Update Seller Profile": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Update seller profile success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.seller).to.exist;",
    "});"
  ],
  "Update Seller Status (Admin Approval)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Approval status update success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.seller.approvalStatus).to.be.oneOf([\"approved\", \"rejected\", \"pending\"]);",
    "});"
  ],
  "Delete Seller Profile": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Seller profile deleted successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete Seller By ID (Admin)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Admin forced delete seller success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Create Address": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Create address success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.address).to.exist;",
    "});",
    "if (jsonData.address && (jsonData.address._id || jsonData.address.id)) {",
    "    var addrId = jsonData.address._id || jsonData.address.id;",
    "    pm.collectionVariables.set(\"addressId\", addrId);",
    "}"
  ],
  "Get My Addresses": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve addresses success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.addresses).to.be.an(\"array\");",
    "});"
  ],
  "Get Address By ID": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Address details success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.address).to.exist;",
    "});"
  ],
  "Update Address": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Address updated success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete Address": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Address deleted success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Create Category (Admin Only)": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Category created success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.category).to.exist;",
    "});",
    "if (jsonData.category && (jsonData.category._id || jsonData.category.id)) {",
    "    var catId = jsonData.category._id || jsonData.category.id;",
    "    pm.collectionVariables.set(\"categoryId\", catId);",
    "}"
  ],
  "Get All Categories": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve categories success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.categories).to.be.an(\"array\");",
    "});"
  ],
  "Create Product": [
    "pm.test(\"Status code is 201 or 202\", function () {",
    "    pm.expect(pm.response.code).to.be.oneOf([201, 202]);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Product creation queued or succeeded\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});",
    "if (jsonData.product && (jsonData.product._id || jsonData.product.id)) {",
    "    var prodId = jsonData.product._id || jsonData.product.id;",
    "    pm.collectionVariables.set(\"productId\", prodId);",
    "    if (jsonData.product.slug) {",
    "        pm.collectionVariables.set(\"productSlug\", jsonData.product.slug);",
    "    }",
    "}"
  ],
  "Get All Products (Public)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve products list success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.products).to.be.an(\"array\");",
    "});"
  ],
  "Get Product By Slug (Public)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Product inspected by slug success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.product).to.exist;",
    "});",
    "if (jsonData.product && (jsonData.product._id || jsonData.product.id)) {",
    "    var prodId = jsonData.product._id || jsonData.product.id;",
    "    pm.collectionVariables.set(\"productId\", prodId);",
    "}"
  ],
  "Update Product Details": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Product update success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete Product": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Product deleted success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Upload Product Images": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Image uploaded successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete Product Image": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Image deleted successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Create Product Variant": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Variant created successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.variant).to.exist;",
    "});",
    "if (jsonData.variant && (jsonData.variant._id || jsonData.variant.id)) {",
    "    var vId = jsonData.variant._id || jsonData.variant.id;",
    "    pm.collectionVariables.set(\"variantId\", vId);",
    "}"
  ],
  "Update Product Variant": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Variant updated successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Delete Product Variant": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Variant deleted successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Create Product Review": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Review created successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.review).to.exist;",
    "});",
    "if (jsonData.review && (jsonData.review._id || jsonData.review.id)) {",
    "    var revId = jsonData.review._id || jsonData.review.id;",
    "    pm.collectionVariables.set(\"reviewId\", revId);",
    "}"
  ],
  "Get Product Reviews": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Reviews list retrieved success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.reviews).to.be.an(\"array\");",
    "});"
  ],
  "Create Product Question": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Question posted successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.question).to.exist;",
    "});",
    "if (jsonData.question && (jsonData.question._id || jsonData.question.id)) {",
    "    var qId = jsonData.question._id || jsonData.question.id;",
    "    pm.collectionVariables.set(\"questionId\", qId);",
    "}"
  ],
  "Get Product Questions": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Questions retrieved success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.questions).to.be.an(\"array\");",
    "});"
  ],
  "Create Question Answer": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Answer posted successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.answer).to.exist;",
    "});"
  ],
  "Get Question Answers": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Answers retrieved success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.answers).to.be.an(\"array\");",
    "});"
  ],
  "Create Shipping Profile": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Shipping profile created success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.shippingProfile).to.exist;",
    "});",
    "if (jsonData.shippingProfile && (jsonData.shippingProfile._id || jsonData.shippingProfile.id)) {",
    "    var shpId = jsonData.shippingProfile._id || jsonData.shippingProfile.id;",
    "    pm.collectionVariables.set(\"shippingProfileId\", shpId);",
    "}"
  ],
  "Get Shipping Profiles": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Shipping profiles retrieved success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.shippingProfiles).to.be.an(\"array\");",
    "});"
  ],
  "Create Seller Store Depot": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Seller store depot created success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.store).to.exist;",
    "});",
    "if (jsonData.store && (jsonData.store._id || jsonData.store.id)) {",
    "    var stId = jsonData.store._id || jsonData.store.id;",
    "    pm.collectionVariables.set(\"storeId\", stId);",
    "}"
  ],
  "Get Seller Stores": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Seller stores retrieved success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.stores).to.be.an(\"array\");",
    "});"
  ],
  "Get Cart": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Cart retrieved success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.cart).to.exist;",
    "});"
  ],
  "Sync Cart State": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Cart sync success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Apply Cart Coupon": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Coupon applied successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Remove Cart Coupon": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Coupon removed successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Clear Cart": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Cart cleared successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Create Coupon Campaign": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Coupon campaign created success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.coupon).to.exist;",
    "});",
    "if (jsonData.coupon) {",
    "    if (jsonData.coupon._id || jsonData.coupon.id) {",
    "        var cpId = jsonData.coupon._id || jsonData.coupon.id;",
    "        pm.collectionVariables.set(\"couponId\", cpId);",
    "    }",
    "    if (jsonData.coupon.code) {",
    "        pm.collectionVariables.set(\"couponCode\", jsonData.coupon.code);",
    "    }",
    "}"
  ],
  "Get My Coupons": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve my coupons success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.coupons).to.be.an(\"array\");",
    "});"
  ],
  "Validate Coupon Code": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Coupon code validation check success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.valid).to.exist;",
    "});"
  ],
  "Delete Coupon Campaign": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Coupon campaign deleted success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Place Order": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Order placed successfully\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.order).to.exist;",
    "});",
    "if (jsonData.order && (jsonData.order._id || jsonData.order.id)) {",
    "    var ordId = jsonData.order._id || jsonData.order.id;",
    "    pm.collectionVariables.set(\"orderId\", ordId);",
    "}"
  ],
  "Get My Orders": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve my orders success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.orders).to.be.an(\"array\");",
    "});"
  ],
  "Get Seller Orders": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve seller orders success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.orders).to.be.an(\"array\");",
    "});"
  ],
  "Get Order By ID": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve order detail success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.order).to.exist;",
    "});"
  ],
  "Cancel Order": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Order cancelled success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Update Order Status (Seller / Admin)": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Order status updated success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ],
  "Create Webhook Subscription": [
    "pm.test(\"Status code is 201\", function () {",
    "    pm.response.to.have.status(201);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Webhook subscription created success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.subscription).to.exist;",
    "});",
    "if (jsonData.subscription && (jsonData.subscription._id || jsonData.subscription.id)) {",
    "    var webId = jsonData.subscription._id || jsonData.subscription.id;",
    "    pm.collectionVariables.set(\"webhookId\", webId);",
    "}"
  ],
  "Get Subscriptions": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Retrieve webhook subscriptions success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "    pm.expect(jsonData.subscriptions).to.be.an(\"array\");",
    "});"
  ],
  "Delete Webhook Subscription": [
    "pm.test(\"Status code is 200\", function () {",
    "    pm.response.to.have.status(200);",
    "});",
    "var jsonData = pm.response.json();",
    "pm.test(\"Webhook subscription deleted success\", function () {",
    "    pm.expect(jsonData.success).to.be.true;",
    "});"
  ]
};

// Helper function to build the test event structure
function makeTestEvent(scriptLines) {
  return [
    {
      "listen": "test",
      "script": {
        "exec": scriptLines,
        "type": "text/javascript"
      }
    }
  ];
}

console.log('Reading Postman collection from:', collectionPath);
const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

let updatedCount = 0;

// Recursive function to walk through the collection items
function processItems(items) {
  for (const item of items) {
    if (item.item && Array.isArray(item.item)) {
      processItems(item.item);
    } else if (item.name && item.request) {
      const script = testScripts[item.name];
      if (script) {
        item.event = makeTestEvent(script);
        updatedCount++;
      } else {
        console.warn('No test script found for request name:', item.name);
      }
    }
  }
}

processItems(collection.item);
console.log(`Enriched ${updatedCount} requests with comprehensive automated tests.`);

// Ensure all variables exist in the collection.variable structure
const expectedVariables = [
  "userId",
  "sellerId",
  "addressId",
  "categoryId",
  "productId",
  "productSlug",
  "variantId",
  "questionId",
  "couponId",
  "couponCode",
  "orderId",
  "webhookId",
  "shippingProfileId",
  "storeId",
  "reviewId"
];

if (!collection.variable) {
  collection.variable = [];
}

const hasBaseUrl = collection.variable.some(v => v.key === 'baseUrl');
if (!hasBaseUrl) {
  collection.variable.push({
    "key": "baseUrl",
    "value": "http://localhost:3000",
    "type": "string"
  });
}

for (const varKey of expectedVariables) {
  const exists = collection.variable.some(v => v.key === varKey);
  if (!exists) {
    collection.variable.push({
      "key": varKey,
      "value": "",
      "type": "string"
    });
  }
}

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
console.log('Postman collection successfully updated at:', collectionPath);
