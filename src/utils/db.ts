import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/hmarketplace";

export async function connectDB(): Promise<typeof mongoose> {
  try {
    mongoose.connection.on("connected", () => {
      console.log("Mongoose connected to MongoDB database");
    });

    mongoose.connection.on("error", (err) => {
      console.error(`Mongoose connection error: ${err}`);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("Mongoose disconnected from MongoDB");
    });

    // Gracefully handle application termination
    process.on("SIGINT", async () => {
      await mongoose.connection.close();
      console.log("Mongoose connection closed due to app termination (SIGINT)");
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await mongoose.connection.close();
      console.log("Mongoose connection closed due to app termination (SIGTERM)");
      process.exit(0);
    });

    const conn = await mongoose.connect(MONGODB_URI, {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || "10", 10),
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || "1", 10),
    });
    return conn;
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}
