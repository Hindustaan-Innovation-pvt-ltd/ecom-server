import admin from "firebase-admin";
import { initializeApp as initializeClientApp } from "firebase/app";

// Firebase Client Web SDK Configuration
export const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDy9BDXF1Sfz7IG3WaLh0fzUfyInvLL_ZQ",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "hindustaan-mart.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "hindustaan-mart",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "hindustaan-mart.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "794354710622",
  appId: process.env.FIREBASE_APP_ID || "1:794354710622:web:b03e597d2476a1bca8dccf",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-XW1WG1DZC7"
};

// Initialize client-side Firebase app on the server
let clientApp: any = null;
try {
  clientApp = initializeClientApp(firebaseConfig);
} catch (error) {
  console.error("Failed to initialize Firebase Client SDK:", error);
}
export { clientApp };

// Note: Analytics is only supported in browser environments.
// Do not import or execute getAnalytics() on Node.js/Server environments.

const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

let isFirebaseAdminInitialized = false;

if (projectId && clientEmail && privateKey) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
    isFirebaseAdminInitialized = true;
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
  }
} else {
  console.warn(
    "Firebase Admin credentials not fully provided. ID Token verification will fall back to REST API verification."
  );
}


/**
 * Verifies a client-provided Firebase ID Token.
 * Falls back to calling the Firebase REST API if the Admin SDK is not initialized.
 */
export async function verifyIdToken(idToken: string): Promise<string> {
  if (isFirebaseAdminInitialized) {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const phoneNumber = decodedToken.phone_number;
    if (!phoneNumber) {
      throw new Error("No phone number found in the verified Firebase ID Token.");
    }
    return phoneNumber;
  }

  // Fallback: Verify token using Firebase Identity Toolkit REST API (needs FIREBASE_API_KEY)
  const apiKey = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      "Firebase Web API Key (FIREBASE_API_KEY) is missing. Cannot verify ID Token."
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as any;
    const message =
      errorData?.error?.message || "Failed to verify ID token via Firebase REST API.";
    throw new Error(message);
  }

  const data = (await response.json()) as any;
  const user = data?.users?.[0];
  const phoneNumber = user?.phoneNumber;

  if (!phoneNumber) {
    throw new Error("No phone number associated with the provided Firebase ID Token.");
  }

  return phoneNumber;
}

/**
 * Triggers Firebase to send an OTP verification SMS to a phone number.
 * Returns the sessionInfo string needed for verifying the OTP code.
 */
export async function sendOTP(phoneNumber: string): Promise<string> {
  const apiKey = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      "Firebase Web API Key (FIREBASE_API_KEY) is missing. Cannot trigger OTP SMS."
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber }),
    }
  );

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as any;
    const message =
      errorData?.error?.message || "Failed to send verification code via Firebase.";
    throw new Error(message);
  }

  const data = (await response.json()) as any;
  const sessionInfo = data?.sessionInfo;

  if (!sessionInfo) {
    throw new Error("Firebase responded successfully but did not return a sessionInfo string.");
  }

  return sessionInfo;
}

/**
 * Verifies the OTP code submitted by the user using the Firebase REST API.
 * Returns the verified phone number.
 */
export async function verifyOTP(sessionInfo: string, code: string): Promise<string> {
  const apiKey = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      "Firebase Web API Key (FIREBASE_API_KEY) is missing. Cannot verify OTP."
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionInfo, code }),
    }
  );

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as any;
    const message =
      errorData?.error?.message || "Failed to verify OTP code via Firebase.";
    throw new Error(message);
  }

  const data = (await response.json()) as any;
  const phoneNumber = data?.phoneNumber;

  if (!phoneNumber) {
    throw new Error("OTP verified successfully but no phone number was returned by Firebase.");
  }

  return phoneNumber;
}
