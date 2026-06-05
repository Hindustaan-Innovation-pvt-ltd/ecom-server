# Customer Authentication — API Documentation

> **Base URL:** `http://localhost:8080/api/v1`  
> **Content-Type for file uploads:** `multipart/form-data`  
> **Content-Type for JSON endpoints:** `application/json`

---

## How Authentication Works

The backend issues a **JWT Bearer Token** on every successful register or login response.  
Store this token and send it with every protected request via the `Authorization` header.

```
Authorization: Bearer <your_token_here>
```

The token is valid for **7 days**. There is no refresh token — the user must log in again after expiry.

---

## Endpoints

### 1. Register

```
POST /api/v1/auth/register
```

Creates a new customer account, saves it directly to the database, establishes a session, and returns a JWT — all in a single synchronous response.

**Request body** — `multipart/form-data`

| Field | Required | Type | Notes |
|-------|:--------:|------|-------|
| `fullName` | ✅ | string | Min 2 characters |
| `email` | ✅ | string | Must be a valid email. Stored lowercase. |
| `phone` | ✅ | string | Format: `+?[0-9 -]{7,15}` |
| `password` | ✅ | string | Encrypted automatically by the server |
| `avatar` | ❌ | file | Profile picture. Uploaded to Cloudinary. |

**Example — JavaScript**

```js
const form = new FormData();
form.append("fullName", "Jane Doe");
form.append("email", "jane@example.com");
form.append("phone", "+919876543210");
form.append("password", "SecurePass@123");
// form.append("avatar", fileInput.files[0]); // optional

const res = await fetch("http://localhost:8080/api/v1/auth/register", {
  method: "POST",
  body: form,
  credentials: "include",
});

const data = await res.json();
// Save token immediately
localStorage.setItem("token", data.token);
```

**Success — `201 Created`**

```json
{
  "success": true,
  "message": "User registered and logged in successfully.",
  "user": {
    "_id": "665b1234abc...",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+919876543210",
    "avatarUrl": "https://res.cloudinary.com/...",
    "role": "customer",
    "isActive": true,
    "createdAt": "2026-06-04T12:00:00.000Z",
    "updatedAt": "2026-06-04T12:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses**

| Status | Message |
|--------|---------|
| `400` | `Required fields: fullName, email, phone, and password.` |
| `400` | `An account with this email address or phone number already exists.` |
| `400` | `Sellers must register through the dedicated seller onboarding endpoint.` |
| `500` | `Avatar upload to Cloudinary failed.` |

---

### 2. Login

```
POST /api/v1/auth/login
```

Authenticates the user by email and password. Returns a fresh JWT on success.

**Request body** — `application/json`

| Field | Required | Accepted aliases |
|-------|:--------:|-----------------|
| `email` | ✅ | `emailOrPhone` (if it contains `@`) |
| `password` | ✅ | `pass`, `pwd` |

**Example — JavaScript**

```js
const res = await fetch("http://localhost:8080/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    email: "jane@example.com",
    password: "SecurePass@123",
  }),
});

const data = await res.json();
localStorage.setItem("token", data.token);
```

**Success — `200 OK`**

```json
{
  "success": true,
  "message": "Logged in successfully.",
  "user": {
    "_id": "665b1234abc...",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+919876543210",
    "avatarUrl": "https://res.cloudinary.com/...",
    "role": "customer",
    "isActive": true,
    "lastLoginAt": "2026-06-04T12:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses**

| Status | Message |
|--------|---------|
| `400` | `Missing credentials. Send email and password.` |
| `401` | `Invalid email or password.` |
| `401` | `This user account is suspended.` |

---

### 3. Logout

```
POST /api/v1/auth/logout
```

Destroys the server-side session cookie. No request body needed.  
Always clear the token on the client side as well.

**Example — JavaScript**

```js
await fetch("http://localhost:8080/api/v1/auth/logout", {
  method: "POST",
  credentials: "include",
});

localStorage.removeItem("token");
// redirect to /login
```

**Success — `200 OK`**

```json
{
  "success": true,
  "message": "Logged out successfully."
}
```

---

### 4. Get My Profile

```
GET /api/v1/auth/me
```

Returns the full profile of the currently authenticated customer.  
**Requires:** `Authorization: Bearer <token>`

**Example — JavaScript**

```js
const res = await fetch("http://localhost:8080/api/v1/auth/me", {
  headers: {
    "Authorization": `Bearer ${localStorage.getItem("token")}`,
  },
  credentials: "include",
});

const { user } = await res.json();
```

**Success — `200 OK`**

```json
{
  "success": true,
  "user": {
    "_id": "665b1234abc...",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+919876543210",
    "avatarUrl": "https://res.cloudinary.com/...",
    "role": "customer",
    "isActive": true,
    "lastLoginAt": "2026-06-04T12:30:00.000Z",
    "createdAt": "2026-06-04T12:00:00.000Z",
    "updatedAt": "2026-06-04T12:00:00.000Z"
  },
  "seller": null
}
```

---

### 5. Update My Profile

```
PUT /api/v1/auth/me
```

Updates the authenticated customer's profile fields.  
**Requires:** `Authorization: Bearer <token>`  
**Content-Type:** `multipart/form-data`

All fields are optional. Only the fields you send will be updated.

| Field | Type | Notes |
|-------|------|-------|
| `fullName` | string | Update display name |
| `email` | string | Checked for uniqueness against other accounts |
| `phone` | string | Checked for uniqueness against other accounts |
| `password` | string | New password — auto-encrypted |
| `avatar` | file | New profile picture — uploaded to Cloudinary |

**Example — JavaScript**

```js
const form = new FormData();
form.append("fullName", "Jane Smith");
form.append("email", "janesmith@example.com");
// form.append("password", "NewPass@456");
// form.append("avatar", fileInput.files[0]);

const res = await fetch("http://localhost:8080/api/v1/auth/me", {
  method: "PUT",
  headers: {
    "Authorization": `Bearer ${localStorage.getItem("token")}`,
    // Do NOT set Content-Type manually for multipart — let the browser set it
  },
  credentials: "include",
  body: form,
});
```

**Success — `200 OK`**

```json
{
  "success": true,
  "message": "Profile updated successfully.",
  "user": {
    "_id": "665b1234abc...",
    "fullName": "Jane Smith",
    "email": "janesmith@example.com",
    ...
  }
}
```

**Error Responses**

| Status | Message |
|--------|---------|
| `400` | `Email address is already in use by another account.` |
| `400` | `Phone number is already in use by another account.` |
| `500` | `Avatar upload to Cloudinary failed.` |

---

### 6. Delete My Account

```
DELETE /api/v1/auth/me
```

Permanently deletes the authenticated customer's account and destroys the session.  
**Requires:** `Authorization: Bearer <token>`

```js
await fetch("http://localhost:8080/api/v1/auth/me", {
  method: "DELETE",
  headers: {
    "Authorization": `Bearer ${localStorage.getItem("token")}`,
  },
  credentials: "include",
});

localStorage.removeItem("token");
```

**Success — `200 OK`**

```json
{
  "success": true,
  "message": "Your account has been deleted successfully."
}
```

---

## Sending the Token — Reusable Helper

```js
// utils/api.js

const BASE_URL = "http://localhost:8080/api/v1";

export async function authFetch(path, options = {}) {
  const token = localStorage.getItem("token");

  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Only set Content-Type to JSON if not sending FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // Auto-redirect on token expiry or invalid token
  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    return;
  }

  return res;
}
```

**Usage:**

```js
// Register (no token needed)
const res = await fetch(`${BASE_URL}/auth/register`, { method: "POST", body: form });

// Login (no token needed)
const res = await fetch(`${BASE_URL}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

// Protected requests
const res = await authFetch("/auth/me");
const res = await authFetch("/auth/me", { method: "PUT", body: formData });
const res = await authFetch("/auth/me", { method: "DELETE" });
```

---

## Error Response Shape

All errors follow the same structure:

```json
{
  "success": false,
  "message": "Human-readable description of the error."
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request — validation failed or duplicate data |
| `401` | Unauthenticated — missing, invalid, or expired token |
| `403` | Forbidden — account suspended |
| `404` | Resource not found |
| `429` | Too many requests — rate limit hit (production only) |
| `500` | Server error |

---

## Rate Limits (Production Only)

| Endpoint | Limit |
|----------|-------|
| `POST /auth/register` | 10 requests / minute per IP |
| `POST /auth/login` | 10 requests / minute per IP |
| All other endpoints | 500 requests / 15 minutes per IP |

When exceeded — `429 Too Many Requests`:

```json
{
  "success": false,
  "message": "Too many authentication or registration attempts. Please try again after 60 seconds."
}
```

---

## Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `POST` | `/auth/register` | ❌ | Create account + get token |
| `POST` | `/auth/login` | ❌ | Login + get token |
| `POST` | `/auth/logout` | ❌ | Destroy session |
| `GET` | `/auth/me` | ✅ | Get own profile |
| `PUT` | `/auth/me` | ✅ | Update own profile |
| `DELETE` | `/auth/me` | ✅ | Delete own account |
