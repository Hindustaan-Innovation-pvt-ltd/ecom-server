import serverless from "serverless-http";
import mongoose from "mongoose";
import { Server } from "../../src/server.js";
import { connectDB } from "../../src/utils/db.js";

// Initialize the Express app instance
const serverInstance = new Server();
const app = serverInstance.app;

// Wrap the Express app in a serverless-http handler
const serverlessHandler = serverless(app);

/**
 * Netlify Function handler.
 * Connects to MongoDB (reusing connection if active) and proxies the request to Express.
 */
export const handler = async (event: any, context: any) => {
  // Solve concurrency and keep-alive context settings for Lambda execution
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    // Re-use active database connection if available
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
  } catch (dbError) {
    console.error("Failed to establish MongoDB connection in serverless context:", dbError);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        message: "Database connection failed",
      }),
    };
  }

  // Handle the request through serverless-http proxy
  return await serverlessHandler(event, context);
};
