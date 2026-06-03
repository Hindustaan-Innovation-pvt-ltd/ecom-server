/**
 * HMarketplace – Postman Collection Builder
 * Generates hmarketplace_collection.json with all routes, automated test
 * assertions, and variable extraction scripts.
 * Run: node postman/build_collection.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");

const COOKIE_EXTRACTION_SCRIPT = [
  "var headers = [];",
  "if (pm.response && pm.response.headers) {",
  "  var h = pm.response.headers;",
  "  if (typeof h.all === 'function') {",
  "    headers = h.all();",
  "  } else if (Array.isArray(h)) {",
  "    headers = h;",
  "  } else if (typeof h === 'object') {",
  "    headers = Object.keys(h).map(function(k) { return { key: k, value: h[k] }; });",
  "  }",
  "}",
  "var cookies = headers.filter(function(item) {",
  "  var k = item.key || item.name || '';",
  "  return k.toLowerCase() === 'set-cookie';",
  "});",
  "if (cookies && cookies.length > 0) {",
  "  var sess = '';",
  "  var sig = '';",
  "  cookies.forEach(function(c) {",
  "    var val = c.value || '';",
  "    var firstPart = val.split(';')[0];",
  "    if (firstPart.startsWith('session=')) sess = firstPart;",
  "    else if (firstPart.startsWith('session.sig=')) sig = firstPart;",
  "  });",
  "  if (sess && sig) {",
  "    pm.collectionVariables.set('sessionCookie', sess + '; ' + sig);",
  "  } else {",
  "    var combined = cookies.map(function(c) { return (c.value || '').split(';')[0]; }).join('; ');",
  "    if (combined) pm.collectionVariables.set('sessionCookie', combined);",
  "  }",
  "}",
  "try {",
  "  var resBody = pm.response.json();",
  "  if (resBody && resBody.token) {",
  "    pm.collectionVariables.set('authToken', resBody.token);",
  "  }",
  "} catch(e) {}"
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function req(name, method, rawUrl, pathArr, body, description, testLines = []) {
  const event = testLines.length
    ? [{ listen: "test", script: { exec: testLines, type: "text/javascript" } }]
    : [];
  return {
    name,
    request: {
      method,
      header: [
        { key: "Cookie", value: "{{sessionCookie}}", type: "text" },
        { key: "Authorization", value: "Bearer {{authToken}}", type: "text" }
      ],
      body: body || undefined,
      url: { raw: rawUrl, host: ["{{baseUrl}}"], path: pathArr },
      description
    },
    response: [],
    event
  };
}

function jsonBody(obj) {
  return { mode: "raw", raw: JSON.stringify(obj, null, 2), options: { raw: { language: "json" } } };
}

function rawBody(text, language = "text") {
  return { mode: "raw", raw: text, options: { raw: { language } } };
}

function formdataBody(fields) {
  return { mode: "formdata", formdata: fields.map(([key, value, type = "text"]) => ({ key, value, type })) };
}

function folder(name, items, description = "") {
  return { name, description, item: items };
}

function tests(...lines) { return lines; }

function statusTest(code) { return `pm.test("Status ${code}", () => pm.response.to.have.status(${code}));`; }
function successTest() { return `pm.test("success flag", () => pm.expect(pm.response.json().success).to.be.true);`; }
function saveVar(varName, expr) { return `pm.collectionVariables.set("${varName}", ${expr});`; }

// ─── Base URL ────────────────────────────────────────────────────────────────

const BASE = "{{baseUrl}}";

// ─── 0. Health Check ─────────────────────────────────────────────────────────

const healthCheck = req(
  "Health Check", "GET", `${BASE}/health`, ["health"], null,
  "Server + DB health probe.",
  tests(
    statusTest(200),
    successTest(),
    `pm.test("message includes 'healthy'", () => pm.expect(pm.response.json().message).to.include("healthy"));`
  )
);

// ─── 0.1 Developer Documentation ─────────────────────────────────────────────

const developerDocs = req(
  "Developer Documentation (Plain Text)", "GET", `${BASE}/docs`, ["docs"], null,
  "Fetch the raw developer server guide (plain text markdown).",
  tests(
    statusTest(200),
    `pm.test("Content-Type is text/plain", () => {
      var contentType = pm.response.headers.get("Content-Type");
      pm.expect(contentType).to.include("text/plain");
    });`,
    `pm.test("includes guide headers", () => {
      pm.expect(pm.response.text()).to.include("# HMarketplace Backend");
    });`
  )
);

// ─── 0.2 Sentry Debug Endpoints ─────────────────────────────────────────────

const sentryFolder = folder("Sentry Debugging", [

  req("Test Legacy Sentry Error", "GET",
    `${BASE}/debug-sentry`, ["debug-sentry"],
    null,
    "Triggers a simple unhandled synchronous error to verify Sentry capture.",
    tests(statusTest(500))
  ),

  req("Sentry Sync Error", "GET",
    `${BASE}/debug-sentry/sync-error`, ["debug-sentry", "sync-error"],
    null,
    "Triggers an unhandled synchronous error.",
    tests(statusTest(500))
  ),

  req("Sentry Async Error", "GET",
    `${BASE}/debug-sentry/async-error`, ["debug-sentry", "async-error"],
    null,
    "Triggers an unhandled asynchronous error inside a Promise chain.",
    tests(statusTest(500))
  ),

  req("Sentry Captured Error (Manual)", "GET",
    `${BASE}/debug-sentry/captured-error`, ["debug-sentry", "captured-error"],
    null,
    "Tests manually capturing an exception using Sentry SDK. Returns the Sentry Event ID.",
    tests(statusTest(200), successTest())
  ),

  req("Sentry Performance APM Test", "GET",
    `${BASE}/debug-sentry/performance`, ["debug-sentry", "performance"],
    null,
    "Triggers a latency simulation (500ms delay) to test Sentry's APM Transaction Performance tracing.",
    tests(statusTest(200), successTest())
  ),

], "Endpoints to verify, trace, and debug the Sentry Node SDK integration.");

// ─── 1. Auth & Users ─────────────────────────────────────────────────────────

const authFolder = folder("Authentication & Users", [

  req("Register Customer", "POST", `${BASE}/api/auth/register`, ["api", "auth", "register"],
    formdataBody([
      ["fullName", "{{customerName}}"],
      ["email", "{{customerEmail}}"],
      ["phone", "{{customerPhone}}"],
      ["password", "{{customerPassword}}"],
      ["role", "customer"]
    ]),
    "Register a new customer account. Returns the user object on success.",
    tests(
      `pm.test("Status 201 or 202", () => pm.expect(pm.response.code).to.be.oneOf([201, 202]));`,
      successTest(),
      `var d = pm.response.json();
      if (d.user) {
        pm.test("userId present", () => pm.expect(d.user._id).to.be.a("string"));
        pm.collectionVariables.set("userId", d.user._id);
      }`,
      `pm.collectionVariables.set("customerEmail", pm.iterationData.get("customerEmail") || pm.collectionVariables.get("customerEmail") || "john.doe@example.com");`,
      `pm.collectionVariables.set("customerPassword", pm.iterationData.get("customerPassword") || pm.collectionVariables.get("customerPassword") || "Password123!");`,
      ...COOKIE_EXTRACTION_SCRIPT
    )
  ),

  req("Login as Customer", "POST", `${BASE}/api/auth/login`, ["api", "auth", "login"],
    jsonBody({ emailOrPhone: "{{customerEmail}}", password: "{{customerPassword}}" }),
    "Login and receive a session cookie for subsequent authenticated requests.",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("user in response", () => pm.expect(pm.response.json().user).to.be.an("object"));`,
      `pm.test("cookie set", () => {
        var hasCookie = false;
        if (pm.cookies && typeof pm.cookies.has === 'function') {
          hasCookie = pm.cookies.has('session');
        } else if (pm.response && pm.response.headers) {
          var h = pm.response.headers;
          var list = [];
          if (typeof h.all === 'function') list = h.all();
          else if (Array.isArray(h)) list = h;
          else if (typeof h === 'object') list = Object.keys(h).map(function(k) { return { key: k, value: h[k] }; });
          
          hasCookie = list.some(function(item) {
            var k = item.key || item.name || '';
            var v = item.value || '';
            return k.toLowerCase() === 'set-cookie' && v.indexOf('session=') !== -1;
          });
        }
        pm.expect(hasCookie).to.be.true;
      });`,
      ...COOKIE_EXTRACTION_SCRIPT
    )
  ),

  req("Login as Seller", "POST", `${BASE}/api/auth/login`, ["api", "auth", "login"],
    jsonBody({ emailOrPhone: "{{sellerEmail}}", password: "{{sellerPassword}}" }),
    "Login as seller user. Cookie is shared across the session.",
    tests(
      statusTest(200),
      successTest(),
      ...COOKIE_EXTRACTION_SCRIPT
    )
  ),

  req("Login as Admin", "POST", `${BASE}/api/auth/login`, ["api", "auth", "login"],
    jsonBody({ emailOrPhone: "{{adminEmail}}", password: "{{adminPassword}}" }),
    "Login as admin user to execute administrative operations.",
    tests(
      statusTest(200),
      successTest(),
      ...COOKIE_EXTRACTION_SCRIPT
    )
  ),

  req("Get My Profile (me)", "GET", `${BASE}/api/auth/me`, ["api", "auth", "me"],
    null,
    "Fetch the currently authenticated user's profile.",
    tests(statusTest(200), successTest(), `pm.test("email correct", () => pm.expect(pm.response.json().user.email).to.be.a("string"));`)
  ),

  req("Update My Profile", "PUT", `${BASE}/api/auth/me`, ["api", "auth", "me"],
    formdataBody([["fullName", "John Updated Doe"]]),
    "Update the authenticated user's profile (supports optional avatar upload).",
    tests(statusTest(200), successTest())
  ),

  req("Get All Users (Admin)", "GET", `${BASE}/api/auth/users`, ["api", "auth", "users"],
    null,
    "Admin-only: list all registered users.",
    tests(statusTest(200), successTest(), `pm.test("users array", () => pm.expect(pm.response.json().users).to.be.an("array"));`)
  ),

  req("Get User By ID", "GET", `${BASE}/api/auth/users/{{userId}}`, ["api", "auth", "users", "{{userId}}"],
    null,
    "Fetch a specific user by their ID.",
    tests(statusTest(200), successTest())
  ),

  req("Update User Status (Admin)", "PUT",
    `${BASE}/api/auth/users/{{userId}}/status`, ["api", "auth", "users", "{{userId}}", "status"],
    jsonBody({ status: "active" }),
    "Admin-only: enable or disable a user account.",
    tests(statusTest(200), successTest())
  ),

  req("Delete My Account", "DELETE", `${BASE}/api/auth/me`, ["api", "auth", "me"],
    null,
    "Permanently deletes the authenticated user's own account.",
    tests(statusTest(200), successTest())
  ),

  req("Delete User By ID (Admin)", "DELETE",
    `${BASE}/api/auth/users/{{userId}}`, ["api", "auth", "users", "{{userId}}"],
    null,
    "Admin-only: delete any user account.",
    tests(statusTest(200), successTest())
  ),

  req("Logout", "POST", `${BASE}/api/auth/logout`, ["api", "auth", "logout"],
    null,
    "Destroys the current session and clears the session cookie.",
    tests(statusTest(200), successTest())
  ),

], "All authentication, registration, session, and user management endpoints.");

// ─── 2. Sellers ──────────────────────────────────────────────────────────────

const sellerFolder = folder("Sellers", [

  req("Register Seller", "POST",
    `${BASE}/api/seller/register`, ["api", "seller", "register"],
    formdataBody([
      ["fullName", "{{businessName}} User"],
      ["email", "{{sellerEmail}}"],
      ["phone", "{{businessPhone}}"],
      ["password", "{{sellerPassword}}"],
      ["businessName", "{{businessName}}"],
      ["gstNumber", "{{gstNumber}}"],
      ["businessPhone", "{{businessPhone}}"],
      ["businessEmail", "{{businessEmail}}"]
    ]),
    "Unified Seller onboarding: creates both the seller user account and business profile.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("sellerUserId", "pm.response.json().user._id"),
      saveVar("sellerId", "pm.response.json().seller._id"),
      ...COOKIE_EXTRACTION_SCRIPT
    )
  ),

  req("Get My Seller Profile", "GET",
    `${BASE}/api/seller/profile`, ["api", "seller", "profile"],
    null,
    "Fetch the authenticated seller's own business profile.",
    tests(statusTest(200), successTest())
  ),

  req("Update Seller Profile", "PUT",
    `${BASE}/api/seller/profile`, ["api", "seller", "profile"],
    formdataBody([["businessName", "Jane's Electronics (Updated)"]]),
    "Update the seller's own business profile fields.",
    tests(statusTest(200), successTest())
  ),

  req("Get All Sellers (Admin)", "GET",
    `${BASE}/api/seller`, ["api", "seller"],
    null,
    "Admin-only: paginated list of all registered sellers.",
    tests(statusTest(200), successTest(), `pm.test("sellers array", () => pm.expect(pm.response.json().sellers).to.be.an("array"));`)
  ),

  req("Get Seller By ID (Public)", "GET",
    `${BASE}/api/seller/{{sellerId}}`, ["api", "seller", "{{sellerId}}"],
    null,
    "Publicly accessible seller business details page.",
    tests(statusTest(200), successTest())
  ),

  req("Update Seller Status (Admin)", "PUT",
    `${BASE}/api/seller/{{sellerId}}/status`, ["api", "seller", "{{sellerId}}", "status"],
    jsonBody({ isActive: true }),
    "Admin-only: approve or suspend a seller.",
    tests(statusTest(200), successTest())
  ),

  req("Delete My Seller Profile", "DELETE",
    `${BASE}/api/seller/profile`, ["api", "seller", "profile"],
    null,
    "Deletes the authenticated seller's own profile.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Seller By ID (Admin)", "DELETE",
    `${BASE}/api/seller/{{sellerId}}`, ["api", "seller", "{{sellerId}}"],
    null,
    "Admin-only: permanently removes a seller account.",
    tests(statusTest(200), successTest())
  ),

  req("Get Seller Dashboard Analytics", "GET",
    `${BASE}/api/seller/analytics/dashboard`, ["api", "seller", "analytics", "dashboard"],
    null,
    "Fetch pro-rated financial sales and revenue analytics, low-stock notifications, and review logs cached in Redis.",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("analytics object present", () => pm.expect(pm.response.json().analytics).to.be.an("object"));`
    )
  ),

  req("Register Seller Custom Brand", "POST",
    `${BASE}/api/seller/brands`, ["api", "seller", "brands"],
    formdataBody([
      ["name", "Seller Custom Brand"],
      ["logo", "logo.png"]
    ]),
    "Sellers can register custom brands pending admin verification.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("brandId", "pm.response.json().brand._id")
    )
  ),

  req("Get My Custom Brands", "GET",
    `${BASE}/api/seller/brands`, ["api", "seller", "brands"],
    null,
    "Sellers retrieve their list of custom brands.",
    tests(statusTest(200), successTest())
  ),

  req("Approve Custom Brand (Admin)", "PUT",
    `${BASE}/api/seller/brands/{{brandId}}/status`, ["api", "seller", "brands", "{{brandId}}", "status"],
    jsonBody({ isVerified: true }),
    "Admin approves a seller's custom brand.",
    tests(statusTest(200), successTest())
  ),

  req("Create Seller Listing", "POST",
    `${BASE}/api/seller/listings`, ["api", "seller", "listings"],
    jsonBody({
      variantId: "{{variantId}}",
      pricePaise: 29900,
      comparePricePaise: 39900,
      availableQuantity: 15,
      sellerSku: "SKU-SELLER-123",
      condition: "new",
      procurementType: "in_stock",
      fulfillmentType: "fbm"
    }),
    "Sellers register an offer listing for a product variant, initializing inventory logs and pricing history.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("listingId", "pm.response.json().listing._id")
    )
  ),

  req("Get My Seller Listings", "GET",
    `${BASE}/api/seller/listings`, ["api", "seller", "listings"],
    null,
    "Sellers retrieve their list of offer listings.",
    tests(statusTest(200), successTest())
  ),

  req("Update Seller Listing", "PUT",
    `${BASE}/api/seller/listings/{{listingId}}`, ["api", "seller", "listings", "{{listingId}}"],
    jsonBody({
      pricePaise: 27900,
      availableQuantity: 20
    }),
    "Sellers update pricing or stock, logging historical pricing logs and clearing Redis analytics caches.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Seller Listing", "DELETE",
    `${BASE}/api/seller/listings/{{listingId}}`, ["api", "seller", "listings", "{{listingId}}"],
    null,
    "Sellers delete an offer listing, cascadingly purging inventory records, pricing histories, and clear Redis analytics caches.",
    tests(statusTest(200), successTest())
  ),

], "Seller onboarding, profile management, and admin control endpoints.");

// ─── 3. Addresses ─────────────────────────────────────────────────────────────

const addressFolder = folder("Addresses", [

  req("Create Address", "POST",
    `${BASE}/api/address`, ["api", "address"],
    jsonBody({
      label: "Home",
      fullName: "John Doe",
      phone: "+919876543211",
      line1: "12 Baker Street",
      line2: "Flat 4B",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      country: "India",
      isDefault: true
    }),
    "Creates a new delivery address for the authenticated user.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("addressId", "pm.response.json().address._id")
    )
  ),

  req("Get My Addresses", "GET",
    `${BASE}/api/address`, ["api", "address"],
    null,
    "Lists all saved delivery addresses for the authenticated user.",
    tests(statusTest(200), successTest(), `pm.test("addresses array", () => pm.expect(pm.response.json().addresses).to.be.an("array"));`)
  ),

  req("Get Address By ID", "GET",
    `${BASE}/api/address/{{addressId}}`, ["api", "address", "{{addressId}}"],
    null,
    "Fetch a single address record by ID.",
    tests(statusTest(200), successTest())
  ),

  req("Update Address", "PUT",
    `${BASE}/api/address/{{addressId}}`, ["api", "address", "{{addressId}}"],
    jsonBody({ city: "Pune", pincode: "411001" }),
    "Partially update an existing address record.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Address", "DELETE",
    `${BASE}/api/address/{{addressId}}`, ["api", "address", "{{addressId}}"],
    null,
    "Permanently deletes a saved address.",
    tests(statusTest(200), successTest())
  ),

], "User delivery address CRUD endpoints.");

// ─── 4. Products ──────────────────────────────────────────────────────────────

// 4a: Category sub-folder
const categorySubFolder = folder("Categories", [

  req("Create Category (Admin)", "POST",
    `${BASE}/api/product/categories`, ["api", "product", "categories"],
    jsonBody({
      name: "Electronics",
      slug: "electronics",
      parentId: null,
      level: 1,
      isLeaf: false,
      sortOrder: 1,
      isActive: true
    }),
    "Admin-only: creates a new product category.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("categoryId", "pm.response.json().category._id")
    )
  ),

  req("Get All Categories", "GET",
    `${BASE}/api/product/categories`, ["api", "product", "categories"],
    null,
    "Public: returns all active product categories.",
    tests(statusTest(200), successTest(), `pm.test("categories array", () => pm.expect(pm.response.json().categories).to.be.an("array"));`)
  ),

], "Product category management.");

// 4b: Product CRUD sub-folder
const productCrudSubFolder = folder("Product CRUD", [

  req("Create Product – JSON (Standard)", "POST",
    `${BASE}/api/product`, ["api", "product"],
    jsonBody({
      categoryId: "{{categoryId}}",
      title: "boAt Airdopes Alpha",
      description: {
        short: "Premium true wireless earbuds with 35-hour playback and ENx technology.",
        long: "<h2>boAt Airdopes Alpha</h2><p>Experience unmatched audio clarity with ENx noise-cancellation and up to <strong>35 hours</strong> of total playback time. IPX4-rated, Type-C charging, and seamless Bluetooth 5.3 connectivity make these the perfect daily companion.</p>"
      },
      brand: "boAt",
      sku: "BOAT-ALPHA-BLK-001",
      pricePaise: 499900,
      comparePricePaise: 699900,
      inventory: 200,
      tags: ["boat", "earbuds", "tws", "bluetooth"],
      highlights: ["35 Hours Total Playback", "ENx Technology", "IPX4 Water Resistant", "Type-C Charging", "Bluetooth 5.3"],
      specifications: {
        battery: "75mAh (earbuds) + 600mAh (case)",
        connectivity: "Bluetooth 5.3",
        driver: "10mm Dynamic Driver",
        waterRating: "IPX4"
      },
      attributeValues: {
        color: "Midnight Black",
        storage: "N/A",
        material: "ABS Plastic"
      },
      seo: {
        metaTitle: "boAt Airdopes Alpha – Best TWS Earbuds Under ₹5000",
        metaDescription: "Shop boAt Airdopes Alpha with 35-hour playback, ENx technology, IPX4 rating. Free delivery.",
        canonicalUrl: "https://hmarketplace.in/products/boat-airdopes-alpha"
      },
      variantAttributes: {
        color: "Midnight Black",
        option1: "Midnight Black"
      },
      barcode: "8906109342812",
      weight: 0.3,
      dimensions: {
        length: 6.5,
        width: 4.5,
        height: 3.0,
        unit: "cm"
      }
    }),
    "Seller: Creates a new catalog product with JSON body. Supports nested description object, rich specifications, variant attributes, SEO metadata, and physical dimensions.",
    tests(
      `pm.test("Status 201 or 202", () => pm.expect([201,202]).to.include(pm.response.code));`,
      successTest(),
      `var d = pm.response.json();`,
      `if (d.product) pm.collectionVariables.set("productId", d.product._id);`,
      `if (d.product) pm.collectionVariables.set("productSlug", d.product.slug);`,
      `pm.test("product or jobId present", () => pm.expect(d.product || d.jobId).to.exist);`
    )
  ),

  req("Create Product – Rich Text (HTML Description)", "POST",
    `${BASE}/api/product`, ["api", "product"],
    jsonBody({
      categoryId: "{{categoryId}}",
      title: "Sony WH-1000XM5 Headphones",
      description: "<h1>Sony WH-1000XM5</h1><p>Industry-leading noise cancellation with <strong>30-hour battery</strong> and Speak-to-Chat technology. Foldable design for travel comfort.</p><ul><li>30-hour battery life</li><li>Multipoint Connection – 2 devices</li><li>LDAC support</li></ul>",
      brand: "Sony",
      sku: "SONY-WH1000XM5-BLK",
      pricePaise: 2999900,
      comparePricePaise: 3499900,
      inventory: 50,
      tags: ["sony", "headphones", "anc", "wireless"],
      richDescription: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "World-Class Noise Cancellation" }] },
          { type: "paragraph", content: [{ type: "text", text: "The WH-1000XM5 uses two processors and eight microphones to deliver best-in-class noise cancellation." }] }
        ]
      },
      seo: {
        metaTitle: "Sony WH-1000XM5 – Best Noise Cancelling Headphones",
        metaDescription: "Buy Sony WH-1000XM5 with industry-leading noise cancellation, 30hr battery, and LDAC.",
        canonicalUrl: "https://hmarketplace.in/products/sony-wh1000xm5"
      },
      specifications: {
        driver: "30mm",
        frequency: "4Hz – 40,000Hz",
        weight: "250g",
        codecs: "SBC, AAC, LDAC"
      },
      variantAttributes: { color: "Black" },
      barcode: "4548736132498",
      weight: 0.25
    }),
    "Seller: Creates a product where `description` is raw HTML (rich text editor output) and `richDescription` holds structured editor JSON (Tiptap/ProseMirror blocks).",
    tests(
      `pm.test("Status 201 or 202", () => pm.expect([201,202]).to.include(pm.response.code));`,
      successTest()
    )
  ),

  req("Create Product – YAML Payload", "POST",
    `${BASE}/api/product`, ["api", "product"],
    rawBody(
      `categoryId: "{{categoryId}}"
title: "Apple iPhone 15 128GB"
description:
  short: "Apple iPhone 15 with Dynamic Island and USB-C charging."
  long: |
    <h2>Apple iPhone 15</h2>
    <p>Powered by the A16 Bionic chip with 48MP main camera,
    Dynamic Island, and USB-C charging port.</p>
brand: "Apple"
sku: "APPLE-IP15-BLK-128"
pricePaise: 7999900
comparePricePaise: 8499900
inventory: 100
tags:
  - apple
  - iphone
  - smartphone
highlights:
  - Dynamic Island
  - 48MP Main Camera
  - USB-C Charging
  - A16 Bionic Chip
specifications:
  display: "6.1-inch Super Retina XDR"
  chip: "A16 Bionic"
  storage: "128GB"
  camera: "48MP + 12MP Dual System"
  battery: "3877 mAh"
  os: "iOS 17"
attributeValues:
  color: "Black Titanium"
  storage: "128GB"
seo:
  metaTitle: "iPhone 15 128GB – Buy at HMarketplace"
  metaDescription: "Apple iPhone 15 128GB with A16 Bionic, 48MP camera, and USB-C. Fast shipping across India."
  canonicalUrl: "https://hmarketplace.in/products/apple-iphone-15-128gb"
variantAttributes:
  color: "Black Titanium"
  storage: "128GB"
barcode: "0194253386568"
weight: 0.171
dimensions:
  length: 14.76
  width: 7.12
  height: 0.78
  unit: cm`,
      "yaml"
    ),
    "Seller: Creates a product from a raw YAML payload. Set Content-Type to 'text/yaml' or include yamlPayload field. All new enterprise fields are supported: nested description, specifications, attributeValues, seo, dimensions, variantAttributes.",
    tests(
      `pm.test("Status 201 or 202", () => pm.expect([201,202]).to.include(pm.response.code));`,
      successTest(),
      `pm.test("YAML parsed correctly", () => pm.expect(pm.response.json().product || pm.response.json().jobId).to.exist);`
    )
  ),

  {
    ...req("Create Product – YAML Payload (field)", "POST",
      `${BASE}/api/product`, ["api", "product"],
      jsonBody({
        yamlPayload: `categoryId: "{{categoryId}}"
title: "Nike Air Max 270"
description:
  short: "Nike Air Max 270 running shoes with full-length Air unit."
  long: |
    <h2>Nike Air Max 270</h2><p>Featuring Nike's largest heel Air unit yet for all-day cushioning.</p>
brand: "Nike"
sku: "NIKE-AIRMAX270-WHT-42"
pricePaise: 1299900
comparePricePaise: 1499900
inventory: 75
tags:
  - nike
  - shoes
  - running
specifications:
  sole: "Rubber"
  upper: "Engineered mesh"
  closure: "Lace-up"
  origin: "Vietnam"
variantAttributes:
  color: "White/Black"
  size: "UK 8"
barcode: "0881562041833"
weight: 0.7
dimensions:
  length: 32.0
  width: 12.0
  height: 12.0
  unit: cm`
      }),
      "Alternative: send YAML as a JSON field 'yamlPayload'. Useful when the HTTP client cannot send raw YAML Content-Type.",
      tests(
        `pm.test("Status 201 or 202", () => pm.expect([201,202]).to.include(pm.response.code));`,
        successTest()
      )
    ),
    // Override header so Content-Type stays application/json
  },

  req("Get All Products (Public)", "GET",
    `${BASE}/api/product`, ["api", "product"],
    null,
    "Public: paginated product listing with optional filters: categoryId, brand, tag, search, minPrice, maxPrice, sort (newest|priceAsc|priceDesc), page, limit.",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("products array present", () => pm.expect(pm.response.json().products).to.be.an("array"));`,
      `pm.test("pagination fields", () => { var d = pm.response.json(); pm.expect(d.total).to.be.a("number"); pm.expect(d.pages).to.be.a("number"); });`
    )
  ),

  req("Get Products – Search", "GET",
    `${BASE}/api/product?search=iphone&sort=priceAsc&page=1&limit=10`,
    ["api", "product"],
    null,
    "Public: full-text search across title, description, and keywords.",
    tests(statusTest(200), successTest())
  ),

  req("Get Products – Filtered by Price Range", "GET",
    `${BASE}/api/product?minPrice=100000&maxPrice=1000000&sort=priceAsc`,
    ["api", "product"],
    null,
    "Public: filter products by price range (in paise). 100000 paise = ₹1000.",
    tests(statusTest(200), successTest())
  ),

  req("Get Product By Slug", "GET",
    `${BASE}/api/product/slug/{{productSlug}}`, ["api", "product", "slug", "{{productSlug}}"],
    null,
    "Public: detailed product view by URL slug. Returns variants, listings, inventory, and pricing.",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("product has variants array", () => pm.expect(pm.response.json().product.variants).to.be.an("array"));`,
      `pm.test("product has pricePaise", () => pm.expect(pm.response.json().product.pricePaise).to.be.a("number"));`
    )
  ),

  req("Update Product (JSON)", "PUT",
    `${BASE}/api/product/{{productId}}`, ["api", "product", "{{productId}}"],
    jsonBody({
      title: "boAt Airdopes Alpha (Refreshed)",
      pricePaise: 479900,
      inventory: 180,
      tags: ["boat", "earbuds", "tws", "bluetooth", "refresh"],
      specifications: {
        battery: "75mAh (earbuds) + 600mAh (case)",
        connectivity: "Bluetooth 5.3",
        driver: "10mm Dynamic Driver",
        waterRating: "IPX5"
      },
      attributeValues: {
        color: "Midnight Black",
        material: "Premium ABS Plastic"
      },
      seo: {
        metaTitle: "boAt Airdopes Alpha Refreshed – Best TWS Under ₹5000",
        metaDescription: "Updated boAt Airdopes Alpha with improved IPX5 rating.",
        canonicalUrl: "https://hmarketplace.in/products/boat-airdopes-alpha"
      },
      richDescription: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Updated product description via rich text editor." }] }]
      }
    }),
    "Seller: partially update a product. All new enterprise fields (specifications, attributeValues, richDescription, seo) are patched individually.",
    tests(statusTest(200), successTest(), `pm.test("product in response", () => pm.expect(pm.response.json().product).to.be.an("object"));`)
  ),

  req("Update Product (YAML Payload)", "PUT",
    `${BASE}/api/product/{{productId}}`, ["api", "product", "{{productId}}"],
    jsonBody({
      yamlPayload: `title: "boAt Airdopes Alpha v2"
pricePaise: 459900
inventory: 160
specifications:
  battery: "80mAh (earbuds) + 650mAh (case)"
  driver: "11mm Dynamic Driver"
seo:
  metaTitle: "boAt Airdopes Alpha v2 – Best TWS"
  metaDescription: "Updated listing with improved driver size."`
    }),
    "Seller: update product using a YAML payload sent as a JSON field.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Product", "DELETE",
    `${BASE}/api/product/{{productId}}`, ["api", "product", "{{productId}}"],
    null,
    "Seller or Admin: cascades deletion across variants, images, seller listings, inventories, and pricing history.",
    tests(statusTest(200), successTest(), `pm.test("deletion message", () => pm.expect(pm.response.json().message).to.include("deleted"));`)
  ),

], "Full product CRUD including JSON, HTML rich-text, and YAML input formats.");

// 4c: Product Images sub-folder
const productImagesSubFolder = folder("Product Images", [

  req("Upload Product Images", "POST",
    `${BASE}/api/product/{{productId}}/images`, ["api", "product", "{{productId}}", "images"],
    {
      mode: "formdata", formdata: [
        { key: "thumbnail", type: "file", src: "/path/to/thumbnail.jpg" },
        { key: "images", type: "file", src: "/path/to/detail-image1.jpg" },
        { key: "images", type: "file", src: "/path/to/detail-image2.jpg" },
        { key: "angles", value: "[\"side\", \"back\"]", type: "text" }
      ]
    },
    "Seller: upload a single primary thumbnail image (on field name 'thumbnail') and up to 10 supplementary details images (on field name 'images'). Uses multipart/form-data.",
    tests(
      statusTest(201),
      successTest(),
      `pm.test("images array returned", () => pm.expect(pm.response.json().images).to.be.an("array"));`,
      saveVar("imageId", "pm.response.json().images[0]._id")
    )
  ),

  req("Delete Product Image", "DELETE",
    `${BASE}/api/product/images/{{imageId}}`, ["api", "product", "images", "{{imageId}}"],
    null,
    "Seller: delete a specific product image by its ID. Also removes the file from Cloudinary.",
    tests(statusTest(200), successTest())
  ),

], "Product media upload and deletion.");

// 4d: Product Variants sub-folder
const productVariantsSubFolder = folder("Product Variants", [

  req("Create Product Variant", "POST",
    `${BASE}/api/product/{{productId}}/variants`, ["api", "product", "{{productId}}", "variants"],
    jsonBody({
      sku: "BOAT-ALPHA-WHT-001",
      variantAttributes: {
        color: "Arctic White",
        option1: "Arctic White"
      },
      barcode: "8906109342813",
      weight: 0.3,
      dimensions: {
        length: 6.5,
        width: 4.5,
        height: 3.0,
        unit: "cm"
      },
      pricePaise: 489900,
      comparePricePaise: 699900,
      inventory: 150
    }),
    "Seller: creates a variant of an existing catalog product. Dynamic variantAttributes support any custom key-value pairs (color, size, storage, material, style, etc.).",
    tests(
      statusTest(201),
      successTest(),
      saveVar("variantId", "pm.response.json().variant._id")
    )
  ),

  req("Get Specific Variant Details", "GET",
    `${BASE}/api/product/variants/{{variantId}}`, ["api", "product", "variants", "{{variantId}}"],
    null,
    "Fetch a single variant by its ID.",
    tests(statusTest(200), successTest())
  ),

  req("Get All Variants of a Product", "GET",
    `${BASE}/api/product/{{productId}}/variants`, ["api", "product", "{{productId}}", "variants"],
    null,
    "Fetch all variants registered under the given catalog product ID.",
    tests(statusTest(200), successTest())
  ),

  req("Update Product Variant", "PUT",
    `${BASE}/api/product/variants/{{variantId}}`, ["api", "product", "variants", "{{variantId}}"],
    jsonBody({
      variantAttributes: { color: "Arctic White", option1: "Arctic White", option2: "Limited Edition" },
      weight: 0.32,
      dimensions: { length: 6.6, width: 4.5, height: 3.0, unit: "cm" },
      pricePaise: 469900,
      inventory: 120
    }),
    "Seller: update variant attributes, physical dimensions, or pricing.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Product Variant", "DELETE",
    `${BASE}/api/product/variants/{{variantId}}`, ["api", "product", "variants", "{{variantId}}"],
    null,
    "Seller: remove a product variant and its associated seller listings.",
    tests(statusTest(200), successTest())
  ),

], "Product variant creation and management.");

// Compose full Products folder
const productsFolder = folder("Products", [
  categorySubFolder,
  productCrudSubFolder,
  productImagesSubFolder,
  productVariantsSubFolder
], "End-to-end product catalog management: categories, products (JSON/HTML/YAML), images, and variants.");

// ─── 5. Cart ─────────────────────────────────────────────────────────────────

const cartFolder = folder("Cart", [

  req("Get My Cart", "GET",
    `${BASE}/api/cart`, ["api", "cart"],
    null,
    "Fetch the authenticated customer's persistent cart.",
    tests(statusTest(200), successTest(), `pm.test("cart object", () => pm.expect(pm.response.json().cart).to.be.an("object"));`)
  ),

  req("Add Item to Cart", "POST",
    `${BASE}/api/cart/add`, ["api", "cart", "add"],
    jsonBody({
      productId: "{{productId}}",
      variantId: "{{variantId}}",
      quantity: 1
    }),
    "Customer: add an item to the persistent cart (enforces stock and resolves pricing dynamically).",
    tests(statusTest(200), successTest())
  ),

  req("Sync Cart", "POST",
    `${BASE}/api/cart/sync`, ["api", "cart", "sync"],
    jsonBody({
      items: [
        { variantId: "{{variantId}}", listingId: "{{listingId}}", quantity: 2 }
      ]
    }),
    "Merge/sync local (guest) cart with the server-side persistent cart.",
    tests(statusTest(200), successTest())
  ),

  req("Apply Coupon to Cart", "POST",
    `${BASE}/api/cart/coupon`, ["api", "cart", "coupon"],
    jsonBody({ couponCode: "SAVE10" }),
    "Apply a discount coupon to the current cart session.",
    tests(
      `pm.test("Status 200 or 400", () => pm.expect([200, 400]).to.include(pm.response.code));`,
      `pm.test("success or error message", () => pm.expect(pm.response.json().message).to.be.a("string"));`
    )
  ),

  req("Remove Coupon from Cart", "DELETE",
    `${BASE}/api/cart/coupon`, ["api", "cart", "coupon"],
    null,
    "Detach any applied coupon from the current cart.",
    tests(statusTest(200), successTest())
  ),

  req("Clear Cart", "DELETE",
    `${BASE}/api/cart`, ["api", "cart"],
    null,
    "Wipes all items from the authenticated customer's cart.",
    tests(statusTest(200), successTest())
  ),

], "Customer cart management: view, sync, apply coupon, and clear.");

// ─── 6. Coupons ───────────────────────────────────────────────────────────────

const couponFolder = folder("Coupons", [

  req("Create Coupon (Seller)", "POST",
    `${BASE}/api/coupons`, ["api", "coupons"],
    jsonBody({
      code: "BOAT20",
      discountType: "percent",
      discountValue: 20,
      maxDiscount: 500,
      minOrderValue: 0,
      expiresAt: "2025-12-31T23:59:59Z",
      usageLimit: 1000,
      isActive: true
    }),
    "Seller: create a new discount coupon campaign.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("couponId", "pm.response.json().coupon._id")
    )
  ),

  req("Get My Coupons (Seller)", "GET",
    `${BASE}/api/coupons/my`, ["api", "coupons", "my"],
    null,
    "Seller: retrieve all coupons created by the authenticated seller.",
    tests(statusTest(200), successTest(), `pm.test("coupons array", () => pm.expect(pm.response.json().coupons).to.be.an("array"));`)
  ),

  req("Validate Coupon (Customer)", "POST",
    `${BASE}/api/coupons/validate`, ["api", "coupons", "validate"],
    jsonBody({ couponCode: "BOAT20", orderValue: 100000 }),
    "Customer: validate a coupon code against a given cart total.",
    tests(
      `pm.test("Status 200 or 400", () => pm.expect([200, 400]).to.include(pm.response.code));`,
      `pm.test("message returned", () => pm.expect(pm.response.json().message).to.be.a("string"));`
    )
  ),

  req("Delete Coupon (Seller)", "DELETE",
    `${BASE}/api/coupons/{{couponId}}`, ["api", "coupons", "{{couponId}}"],
    null,
    "Seller: removes a coupon campaign.",
    tests(statusTest(200), successTest())
  ),

], "Coupon lifecycle: create, list, validate, and delete.");

// ─── 7. Orders ────────────────────────────────────────────────────────────────

const orderFolder = folder("Orders", [

  req("Place Order", "POST",
    `${BASE}/api/orders`, ["api", "orders"],
    jsonBody({
      addressId: "{{addressId}}",
      paymentMode: "cod",
      items: [
        { variantId: "{{variantId}}", listingId: "{{listingId}}", quantity: 1 }
      ],
      couponCode: null
    }),
    "Customer: place a new order from cart items or direct item list.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("orderId", "pm.response.json().order._id")
    )
  ),

  req("Get My Orders (Customer)", "GET",
    `${BASE}/api/orders`, ["api", "orders"],
    null,
    "Customer: paginated list of all orders placed by the authenticated user.",
    tests(statusTest(200), successTest(), `pm.test("orders array", () => pm.expect(pm.response.json().orders).to.be.an("array"));`)
  ),

  req("Get My Orders (Seller)", "GET",
    `${BASE}/api/orders/seller`, ["api", "orders", "seller"],
    null,
    "Seller: all orders containing variants listed by the authenticated seller.",
    tests(statusTest(200), successTest())
  ),

  req("Get Order By ID", "GET",
    `${BASE}/api/orders/{{orderId}}`, ["api", "orders", "{{orderId}}"],
    null,
    "Fetch full order details by ID (accessible to buyer, seller, and admin).",
    tests(statusTest(200), successTest(), `pm.test("orderId matches", () => pm.expect(pm.response.json().order._id).to.equal(pm.collectionVariables.get("orderId")));`)
  ),

  req("Cancel Order", "POST",
    `${BASE}/api/orders/{{orderId}}/cancel`, ["api", "orders", "{{orderId}}", "cancel"],
    jsonBody({ reason: "Changed my mind." }),
    "Customer: cancel a pending or processing order.",
    tests(statusTest(200), successTest())
  ),

  req("Update Order Status (Seller/Admin)", "PATCH",
    `${BASE}/api/orders/{{orderId}}/status`, ["api", "orders", "{{orderId}}", "status"],
    jsonBody({ status: "shipped" }),
    "Seller/Admin: transition an order's fulfillment status.",
    tests(statusTest(200), successTest())
  ),

], "Order lifecycle: placement, status tracking, cancellation, and fulfillment.");

// ─── 8. Reviews & Q&A ─────────────────────────────────────────────────────────

const reviewsFolder = folder("Reviews & Q&A", [

  req("Create Review", "POST",
    `${BASE}/api/product/{{productId}}/reviews`, ["api", "product", "{{productId}}", "reviews"],
    jsonBody({ rating: 5, title: "Excellent earbuds!", comment: "Loved the bass and battery life.", verifiedPurchase: true }),
    "Customer: submit a verified product review.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("reviewId", "pm.response.json().review._id")
    )
  ),

  req("Get Product Reviews", "GET",
    `${BASE}/api/product/{{productId}}/reviews`, ["api", "product", "{{productId}}", "reviews"],
    null,
    "Public: paginated list of approved reviews for a product.",
    tests(statusTest(200), successTest(), `pm.test("reviews array", () => pm.expect(pm.response.json().reviews).to.be.an("array"));`)
  ),

  req("Vote Review Helpful", "POST",
    `${BASE}/api/reviews/{{reviewId}}/helpful`, ["api", "reviews", "{{reviewId}}", "helpful"],
    null,
    "Customer: increment review helpfulness score.",
    tests(statusTest(200), successTest())
  ),

  req("Update Review Status (Admin)", "PUT",
    `${BASE}/api/reviews/{{reviewId}}/status`, ["api", "reviews", "{{reviewId}}", "status"],
    jsonBody({ status: "approved" }),
    "Admin: moderate review status approved|hidden|pending.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Review", "DELETE",
    `${BASE}/api/reviews/{{reviewId}}`, ["api", "reviews", "{{reviewId}}"],
    null,
    "Review Owner/Admin: remove a product review.",
    tests(statusTest(200), successTest())
  ),

  req("Create Question", "POST",
    `${BASE}/api/product/{{productId}}/questions`, ["api", "product", "{{productId}}", "questions"],
    jsonBody({ question: "Is this compatible with iPhone 15?" }),
    "Customer: submit a product question visible to the seller and community.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("questionId", "pm.response.json().question._id")
    )
  ),

  req("Get Product Questions", "GET",
    `${BASE}/api/product/{{productId}}/questions`, ["api", "product", "{{productId}}", "questions"],
    null,
    "Public: paginated Q&A thread for a product.",
    tests(statusTest(200), successTest(), `pm.test("questions array", () => pm.expect(pm.response.json().questions).to.be.an("array"));`)
  ),

  req("Create Answer", "POST",
    `${BASE}/api/question/{{questionId}}/answers`, ["api", "question", "{{questionId}}", "answers"],
    jsonBody({ answer: "Yes, it is fully compatible with iPhone 15 via Bluetooth 5.3." }),
    "Seller or verified buyer: post an answer to a product question.",
    tests(statusTest(201), successTest())
  ),

  req("Get Question Answers", "GET",
    `${BASE}/api/question/{{questionId}}/answers`, ["api", "question", "{{questionId}}", "answers"],
    null,
    "Public: list all answers for a given question.",
    tests(statusTest(200), successTest(), `pm.test("answers array", () => pm.expect(pm.response.json().answers).to.be.an("array"));`)
  ),

], "Product review and community Q&A system.");

// ─── 9. Shipping & Stores ─────────────────────────────────────────────────────

const shippingFolder = folder("Shipping & Stores", [

  req("Create Shipping Profile (Seller)", "POST",
    `${BASE}/api/shipping`, ["api", "shipping"],
    jsonBody({
      name: "Standard India Delivery",
      processingDays: 2,
      codAvailable: true,
      baseShippingPaise: 4900,
      freeShippingAbove: 50000
    }),
    "Seller: create a shipping profile defining delivery terms and COD availability.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("shippingProfileId", "pm.response.json().shippingProfile._id")
    )
  ),

  req("Get Shipping Profiles (Seller)", "GET",
    `${BASE}/api/shipping`, ["api", "shipping"],
    null,
    "Seller: list all their shipping profiles.",
    tests(statusTest(200), successTest(), `pm.test("profiles array", () => pm.expect(pm.response.json().shippingProfiles).to.be.an("array"));`)
  ),

  req("Update Shipping Profile", "PUT",
    `${BASE}/api/shipping/{{shippingProfileId}}`, ["api", "shipping", "{{shippingProfileId}}"],
    jsonBody({ baseChargePaise: 3900 }),
    "Seller: update delivery profile rates.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Shipping Profile", "DELETE",
    `${BASE}/api/shipping/{{shippingProfileId}}`, ["api", "shipping", "{{shippingProfileId}}"],
    null,
    "Seller/Admin: delete shipping profile configuration.",
    tests(statusTest(200), successTest())
  ),

  req("Get Stores Nearby (Geospatial)", "GET",
    `${BASE}/api/stores/nearby?lng=80.2707&lat=13.0827&radiusKm=15`, ["api", "stores", "nearby"],
    null,
    "Public: geospatial Point near circular search to find active warehouses.",
    tests(statusTest(200), successTest())
  ),

  req("Create Seller Store/Warehouse (Seller)", "POST",
    `${BASE}/api/stores`, ["api", "stores"],
    jsonBody({
      name: "Mumbai Central Warehouse",
      address: {
        line1: "Plot 12, Andheri East",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400069",
        country: "India"
      },
      coordinates: [80.2707, 13.0827]
    }),
    "Seller: register warehouse location with GeoJSON point coordinates.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("storeId", "pm.response.json().store._id")
    )
  ),

  req("Get Seller Stores (Seller)", "GET",
    `${BASE}/api/stores`, ["api", "stores"],
    null,
    "Seller: list all active seller store centers.",
    tests(statusTest(200), successTest(), `pm.test("stores array", () => pm.expect(pm.response.json().stores).to.be.an("array"));`)
  ),

  req("Update Store", "PUT",
    `${BASE}/api/stores/{{storeId}}`, ["api", "stores", "{{storeId}}"],
    jsonBody({ name: "Mumbai Central Warehouse Pro" }),
    "Seller: update depot metadata details.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Store", "DELETE",
    `${BASE}/api/stores/{{storeId}}`, ["api", "stores", "{{storeId}}"],
    null,
    "Seller/Admin: remove physical warehouse location.",
    tests(statusTest(200), successTest())
  ),

], "Seller shipping profiles and store/warehouse management.");

// ─── 10. Webhooks ─────────────────────────────────────────────────────────────

const webhookFolder = folder("Webhooks", [

  req("Create Webhook Subscription", "POST",
    `${BASE}/api/webhooks`, ["api", "webhooks"],
    jsonBody({
      url: "https://your-server.example.com/webhooks/hmarketplace",
      events: ["product.created", "order.placed", "order.status_changed"],
      secret: "your-webhook-secret"
    }),
    "Seller/Admin: subscribe to platform events. The server signs payloads with HMAC-SHA256.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("webhookId", "pm.response.json().subscription._id")
    )
  ),

  req("Get My Webhook Subscriptions", "GET",
    `${BASE}/api/webhooks`, ["api", "webhooks"],
    null,
    "Seller/Admin: list all active webhook subscriptions.",
    tests(statusTest(200), successTest(), `pm.test("subscriptions array", () => pm.expect(pm.response.json().subscriptions).to.be.an("array"));`)
  ),

  req("Update Webhook Subscription", "PUT",
    `${BASE}/api/webhooks/{{webhookId}}`, ["api", "webhooks", "{{webhookId}}"],
    jsonBody({ isActive: false }),
    "Seller/Admin: toggle or modify subscription parameters.",
    tests(statusTest(200), successTest())
  ),

  req("Delete Webhook Subscription", "DELETE",
    `${BASE}/api/webhooks/{{webhookId}}`, ["api", "webhooks", "{{webhookId}}"],
    null,
    "Seller/Admin: cancel and remove a webhook subscription.",
    tests(statusTest(200), successTest())
  ),

], "Outgoing webhook subscription management for real-time event notifications.");

// ─── 11. Admin Subsystem ──────────────────────────────────────────────────────

const adminFolder = folder("Admin Subsystem", [

  req("Get Expenses & Revenue Summary", "GET",
    `${BASE}/api/admin/expenses/summary`, ["api", "admin", "expenses", "summary"],
    null,
    "Admin: fetch dynamic financial summaries of profit margins, coupon subsidies, and expenses.",
    tests(statusTest(200), successTest())
  ),

  req("Create Platform Expense", "POST",
    `${BASE}/api/admin/expenses`, ["api", "admin", "expenses"],
    jsonBody({
      amountPaise: 500000,
      category: "marketing",
      description: "Google ads campaign for Summer sale 2026."
    }),
    "Admin: record operational expense details using Paise integers.",
    tests(
      statusTest(201),
      successTest(),
      saveVar("expenseId", "pm.response.json().expense._id")
    )
  ),

  req("Get All Platform Expenses", "GET",
    `${BASE}/api/admin/expenses`, ["api", "admin", "expenses"],
    null,
    "Admin: browse paginated platform expense entries.",
    tests(statusTest(200), successTest())
  ),

  req("Get Admin Audit Logs", "GET",
    `${BASE}/api/admin/audit-logs`, ["api", "admin", "audit-logs"],
    null,
    "Admin: browse security/system administrative audit histories.",
    tests(statusTest(200), successTest())
  ),

  req("Get Products Awaiting Moderation", "GET",
    `${BASE}/api/admin/moderation/products`, ["api", "admin", "moderation", "products"],
    null,
    "Admin: review products pending approval.",
    tests(statusTest(200), successTest())
  ),

  req("Bulk Moderate Products", "POST",
    `${BASE}/api/admin/moderation/products/bulk`, ["api", "admin", "moderation", "products", "bulk"],
    jsonBody({
      productIds: ["{{productId}}"],
      action: "approved",
      reason: "Compliant with catalog standards."
    }),
    "Admin: batch approve or deny product catalog listings.",
    tests(statusTest(200), successTest())
  ),

  req("Get All Orders (Admin)", "GET",
    `${BASE}/api/orders/all`, ["api", "orders", "all"],
    null,
    "Admin: retrieve a list of all platform orders with optional filter query parameters.",
    tests(statusTest(200), successTest())
  ),

  req("Get All Brands (Admin)", "GET",
    `${BASE}/api/admin/brands`, ["api", "admin", "brands"],
    null,
    "Admin: list all platform brands with pagination and optional filters.",
    tests(
      statusTest(200),
      successTest(),
      `var d = pm.response.json();
      if (d.brands && d.brands.length > 0) {
        pm.collectionVariables.set("brandId", d.brands[0]._id);
      }`
    )
  ),

  req("Update Brand Status (Admin)", "PATCH",
    `${BASE}/api/admin/brands/{{brandId}}/status`, ["api", "admin", "brands", "{{brandId}}", "status"],
    jsonBody({ isActive: true, isVerified: true }),
    "Admin: update a brand's verified and active status properties.",
    tests(statusTest(200), successTest())
  )

], "Admin-only system moderation, operation expenses and audit logging.");

// ─── 12. Translation ──────────────────────────────────────────────────────────

const translationFolder = folder("Translation Service", [

  req("Translate Text", "POST",
    `${BASE}/api/translate`, ["api", "translate"],
    jsonBody({ text: "Hello, welcome to our marketplace!", targetLanguage: "es" }),
    "Translate a single text string into a target language.",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("has translatedText", () => pm.expect(pm.response.json().translatedText).to.be.a("string"));`
    )
  ),

  req("Translate Batch Array", "POST",
    `${BASE}/api/translate`, ["api", "translate"],
    jsonBody({ text: ["electronics", "clothing", "cart"], targetLanguage: "hi" }),
    "Translate an array of text strings into a target language in a single batch.",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("has translatedText array", () => pm.expect(pm.response.json().translatedText).to.be.an("array"));`
    )
  ),

  req("Get Localized Products (Spanish)", "GET",
    `${BASE}/api/product?lang=es&limit=5`, ["api", "product"],
    null,
    "Fetch product listings dynamically translated to Spanish (caching results in Redis).",
    tests(
      statusTest(200),
      successTest(),
      `pm.test("products list returned", () => pm.expect(pm.response.json().products).to.be.an("array"));`
    )
  ),

  req("Get Localized Product Details (Hindi)", "GET",
    `${BASE}/api/product/slug/{{productSlug}}?lang=hi`, ["api", "product", "slug", "{{productSlug}}"],
    null,
    "Fetch product detail page dynamically translated to Hindi (caching results in Redis).",
    tests(
      statusTest(200),
      successTest()
    )
  ),

], "Endpoints to translate custom text payloads and browse localized catalog listings.");

// ─── Collection Variables ──────────────────────────────────────────────────────

const variables = [
  { key: "baseUrl", value: "http://localhost:3000", type: "string" },
  { key: "userId", value: "", type: "string" },
  { key: "sellerUserId", value: "", type: "string" },
  { key: "sellerId", value: "", type: "string" },
  { key: "customerName", value: "Stress Customer 0001", type: "string" },
  { key: "customerEmail", value: "customer.stress.0001@hmarketplace.in", type: "string" },
  { key: "customerPhone", value: "+919876540001", type: "string" },
  { key: "customerPassword", value: "SecurePass0001!", type: "string" },
  { key: "businessName", value: "Stress Testing Store", type: "string" },
  { key: "businessEmail", value: "master.seller@hmarketplace.in", type: "string" },
  { key: "businessPhone", value: "+918888888888", type: "string" },
  { key: "addressLine1", value: "Plot 1, Stress Road Sector 1", type: "string" },
  { key: "gstNumber", value: "27AAAAA0000A1Z5", type: "string" },
  { key: "sellerEmail", value: "master.seller@hmarketplace.in", type: "string" },
  { key: "sellerPassword", value: "Password123!", type: "string" },
  { key: "adminEmail", value: "master.admin@hmarketplace.in", type: "string" },
  { key: "adminPassword", value: "Password123!", type: "string" },
  { key: "categoryId", value: "", type: "string" },
  { key: "brandId", value: "", type: "string" },
  { key: "productId", value: "", type: "string" },
  { key: "productSlug", value: "", type: "string" },
  { key: "variantId", value: "", type: "string" },
  { key: "listingId", value: "", type: "string" },
  { key: "imageId", value: "", type: "string" },
  { key: "addressId", value: "", type: "string" },
  { key: "couponId", value: "", type: "string" },
  { key: "orderId", value: "", type: "string" },
  { key: "reviewId", value: "", type: "string" },
  { key: "questionId", value: "", type: "string" },
  { key: "answerId", value: "", type: "string" },
  { key: "expenseId", value: "", type: "string" },
  { key: "shippingProfileId", value: "", type: "string" },
  { key: "storeId", value: "", type: "string" },
  { key: "webhookId", value: "", type: "string" },
  { key: "sessionCookie", value: "", type: "string" },
  { key: "authToken", value: "", type: "string" },
];

// ─── Assemble Collection ───────────────────────────────────────────────────────

const collection = {
  info: {
    _postman_id: "39de01ba-a886-454c-9bed-bba4cba5ef7a",
    name: "HMarketplace E-commerce API Suite v2",
    description: [
      "Complete Postman collection for the HMarketplace backend.",
      "",
      "Coverage: Health, Auth, Users, Sellers, Addresses, Categories,",
      "Products (JSON + HTML Rich-Text + YAML), Product Images, Product Variants,",
      "Cart, Coupons, Orders, Reviews, Q&A, Shipping Profiles, Stores, and Webhooks.",
      "",
      "All write requests include automated test assertions.",
      "Response variable extraction populates collection variables automatically.",
      "",
      "Product endpoints now support three content modes:",
      "  1. Standard JSON with nested description object and dynamic specifications.",
      "  2. HTML rich-text (TipTap/ProseMirror) in description field.",
      "  3. Raw YAML via Content-Type: text/yaml or via the yamlPayload JSON field."
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  item: [
    healthCheck,
    developerDocs,
    sentryFolder,
    authFolder,
    sellerFolder,
    addressFolder,
    productsFolder,
    cartFolder,
    couponFolder,
    orderFolder,
    reviewsFolder,
    shippingFolder,
    webhookFolder,
    adminFolder,
    translationFolder,
  ],
  variable: variables
};

// ─── Write File ───────────────────────────────────────────────────────────────

const outPath = path.join(__dirname, "hmarketplace_collection.json");
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), "utf8");
console.log("✔  Collection written to:", outPath);
console.log("   Folders:", collection.item.length);
console.log("   Variables:", variables.length);
