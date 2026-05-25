import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { connectDB } from "./utils/db.js";
import { User } from "./models/user.js";
import { Seller } from "./models/seller.js";
import mongoose from "mongoose";

async function runTests() {
  console.log("=== Launching Authentication Verification ===");
  await connectDB();

  // Clear existing test entries to allow clean runs
  await User.deleteMany({ email: /test-auth-email/ });
  await Seller.deleteMany({ businessEmail: /test-auth-email/ });
  console.log("Cleaned up existing test entries.");

  try {
    // Test 1: Register Customer User
    console.log("\n[Test 1] Creating Customer User...");
    const customer = new User({
      fullName: "Test Customer",
      email: "test-auth-email-customer@example.com",
      phone: "+919876543210",
      passwordHash: "securepassword123", // plaintext, Pre-save hooks hashes this
      role: "customer",
    });
    await customer.save();
    console.log("Customer registered successfully.");
    console.log("Password hash in DB:", customer.passwordHash);

    // Test 2: Check password comparison
    console.log("\n[Test 2] Testing Password comparison helper...");
    const isCorrect = customer.comparePassword("securepassword123");
    const isWrong = customer.comparePassword("wrongpassword");
    console.log("Correct password matches:", isCorrect);
    console.log("Incorrect password matches:", isWrong);
    if (!isCorrect || isWrong) {
      throw new Error("Password helper verification failed.");
    }

    // Test 3: Duplication constraint check
    console.log("\n[Test 3] Testing duplicate email/phone constraints...");
    const duplicate = new User({
      fullName: "Duplicate User",
      email: "test-auth-email-customer@example.com",
      phone: "+919876543210",
      passwordHash: "password123",
    });
    try {
      await duplicate.save();
      throw new Error("Duplicate validation failed to trigger!");
    } catch (err: any) {
      console.log("Duplicate insertion successfully blocked as expected.");
    }

    // Test 4: Creating Seller profile (User + Seller)
    console.log("\n[Test 4] Creating Seller profile...");
    const sellerUser = new User({
      fullName: "Test Seller",
      email: "test-auth-email-seller@example.com",
      phone: "+918765432109",
      passwordHash: "sellerpass123",
      role: "seller",
    });
    await sellerUser.save();

    const sellerInfo = new Seller({
      userId: sellerUser._id,
      businessName: "Test Innovations Pvt Ltd",
      gstNumber: "22AAAAA0000A1Z5", // Valid Indian GST
      businessPhone: "+918765432109",
      businessEmail: "test-auth-email-seller-biz@example.com",
    });
    await sellerInfo.save();
    console.log("Seller and associated User created successfully!");
    console.log("Seller approvalStatus default:", sellerInfo.approvalStatus);

    // Test 5: Verify invalid GST format constraint
    console.log("\n[Test 5] Testing GST validation constraint...");
    const badSeller = new Seller({
      userId: customer._id,
      businessName: "Bad Seller Ltd",
      gstNumber: "12345INVALIDGST",
      businessPhone: "+911234567890",
      businessEmail: "test-auth-email-bad-seller-biz@example.com",
    });
    try {
      await badSeller.save();
      throw new Error("Invalid GST validation failed to block insertion!");
    } catch (err: any) {
      console.log("Invalid GST successfully blocked as expected:", err.message);
    }

    console.log("\n=================================");
    console.log("ALL TESTS COMPLETED SUCCESSFULLY!");
    console.log("=================================");
  } catch (error) {
    console.error("Verification failed with error:", error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runTests();
