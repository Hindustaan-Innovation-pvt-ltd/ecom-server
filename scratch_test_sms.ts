import { sendOTP } from "./src/services/firebase.js";

// Number to test
const rawPhone = "9294512259"
// Firebase requires E.164 format (with country code e.g. +91 for India)
const formattedPhone = rawPhone.startsWith("+") ? rawPhone : `+91${rawPhone}`;

async function testSMS() {
  console.log(`Starting SMS test for number: ${formattedPhone}`);
  try {
    const sessionInfo = await sendOTP(formattedPhone);
    console.log("\n------------------------------------------------");
    console.log("✅ SUCCESS: OTP SMS Triggered successfully!");
    console.log(`sessionInfo: ${sessionInfo}`);
    console.log("------------------------------------------------\n");
    console.log("Check the mobile device for the OTP message from Firebase.");
  } catch (error: any) {
    console.error("\n❌ FAILED to send OTP SMS:");
    console.error(error.message || error);
    console.error("\nDetailed troubleshooting tips:");
    console.error("1. Check if the FIREBASE_API_KEY in .env is correct and active.");
    console.error("2. Verify if Phone Authentication is enabled in your Firebase Console (Build > Authentication > Sign-in method).");
    console.error("3. Ensure that your Firebase project has SMS quota available (Spark plan has limit, or check Firebase billing/usage limits).");
    console.error("4. Check if the phone number requires a different country code prefix.");
  }
}

testSMS().catch(console.error);
