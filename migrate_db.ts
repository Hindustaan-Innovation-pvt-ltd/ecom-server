import mongoose from "mongoose";

const SOURCE_URI = "mongodb://127.0.0.1:27017/hmarketplace?retryWrites=false";
const TARGET_URI = "mongodb://127.0.0.1:27018/hmarketplace?retryWrites=false";

async function migrate() {
  console.log("Connecting to Source MongoDB (Local Host: 27017)...");
  const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
  console.log("Connected to Source MongoDB.");

  console.log("Connecting to Target MongoDB (Docker Container: 27018)...");
  const targetConn = await mongoose.createConnection(TARGET_URI).asPromise();
  console.log("Connected to Target MongoDB.");

  const db = sourceConn.db;
  if (!db) {
    throw new Error("Source database instance is undefined");
  }
  
  const collections = await db.listCollections().toArray();
  console.log(`Found ${collections.length} collections in source database.`);

  for (const collInfo of collections) {
    const collName = collInfo.name;
    
    // Skip internal system collections
    if (collName.startsWith("system.")) continue;

    console.log(`\nMigrating collection: "${collName}"...`);
    
    const sourceColl = sourceConn.collection(collName);
    const docs = await sourceColl.find({}).toArray();
    console.log(`- Read ${docs.length} documents from source.`);

    if (docs.length === 0) {
      console.log("- Collection is empty. Skipping insertion.");
      continue;
    }

    const targetColl = targetConn.collection(collName);
    
    // Clear target collection first to avoid duplicate key or primary key errors
    await targetColl.deleteMany({});
    console.log("- Cleared existing documents in target collection.");

    // Insert all documents directly
    const result = await targetColl.insertMany(docs);
    console.log(`- Successfully migrated ${result.insertedCount} documents into target!`);
  }

  console.log("\n================================================================================");
  console.log("SUCCESS: Database migration from Local to Docker MongoDB completed perfectly!");
  console.log("================================================================================");

  await sourceConn.close();
  await targetConn.close();
}

migrate().catch(async (err) => {
  console.error("\nMIGRATION ERROR:", err);
  process.exit(1);
});
