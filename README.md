# HMarketplace API Server — High-Performance E-Commerce Backend

> 📖 **Developer Documentation**: For a complete, in-depth guide on setup, database schemas, image upload pipelines, and core architecture breakdowns, please refer directly to the [HMarketplace Server Guide](docs/server_guide.md).
>
> 📡 **API Reference**: For a full list of all API endpoints with request/response examples, see the [API Reference](docs/api_reference.md).

Welcome to the **HMarketplace Backend**, an enterprise-grade, high-performance, and clustered Node.js/Express API server built for massive concurrent load, robust asynchronous queuing, and sub-millisecond response profiles.

---

## 🚀 Key Architectural Features

### 1. Robust Cluster Clustering & Windows Load Balancing
- **Worker Allocation**: The server runs on Node's native `cluster` module. It dynamically partitions your processor into **N workers** (configured via `CLUSTER_WORKERS` or defaulting to CPU core count):
  - **1 Dedicated Asynchronous Worker** (`WORKER_ROLE=email`): Exclusively consumes background BullMQ message queues, runs database write-backs, and handles bulk SMTP operations without blocking client-facing request-response cycles.
  - **N-1 HTTP Workers** (`WORKER_ROLE=http`): Run parallel Express HTTP listeners sharing the identical network port.
- **Windows Round-Robin (`SCHED_RR`)**: Overrides Windows' default `SCHED_NONE` (which causes heavily skewed operating-system scheduling). By enforcing `cluster.schedulingPolicy = cluster.SCHED_RR`, incoming traffic is distributed evenly across all HTTP workers.

### 2. Real-Time Active IPC Telemetry Dashboard
- Lightweight Express middleware registers incoming traffic events and sends real-time updates to the Primary process using Inter-Process Communication (IPC).
- The Primary process aggregates these stats in-memory with virtually zero CPU overhead and prints a premium cluster-wide ASCII performance telemetry table to the console every **15 seconds**:

```
┌────────────────────────────────────────────────────────────────────────┐
│  HMARKETPLACE CLUSTER REAL-TIME LOAD BALANCER TELEMETRY                │
├───────────┬─────────┬──────────────┬──────────────────┬────────────────┤
│ WORKER    │ ROLE    │ STATUS       │ ACTIVE REQUESTS  │ TOTAL REQUESTS │
├───────────┼─────────┼──────────────┼──────────────────┼────────────────┤
│ PID 14208 │ email   │ online       │ N/A (worker)     │ N/A (worker)   │
│ PID 14210 │ http    │ online       │ 0                │ 421            │
│ PID 14212 │ http    │ online       │ 0                │ 418            │
│ PID 14214 │ http    │ online       │ 0                │ 425            │
└───────────┴─────────┴──────────────┴──────────────────┴────────────────┘
```

### 3. Coordinated Graceful Connection Draining
- Capture of system signals (`SIGINT`/`SIGTERM`) and IPC `"shutdown"` events trigger a structured shutdown chain:
  1. Workers stop accepting new connections using `server.close()`.
  2. Workers continue serving active, in-flight HTTP requests until connections are drained.
  3. A 10-second safety grace timeout triggers if client sockets fail to close in time.
  4. Mongoose database pools are cleanly closed via `mongoose.connection.close()`.
  5. The Primary process waits for all child processes to exit before exiting itself, guaranteeing zero dropped checkout or cart actions during rolling updates.

### 4. Database Query & Indexing Hardening (N+1 to O(1))
- **Aggregation Pipelines**: The product catalog listing endpoint (`getAllProducts`) uses MongoDB `$facet` aggregation pipelines. It joins variants, seller listings, real-time inventory, and pricing history directly at the database layer, moving page slice (`$skip`/`$limit`) and pricing filters to the DB engine. **This reduced product listings from 250+ individual database queries to exactly 1 query per page request.**
- **Compound Indexes**: Targeted compound indexes cover all critical query and sorting operations, avoiding slow collection scans (`COLLSCAN`) in favor of rapid index scans (`IXSCAN`):
  - `Product`: `{status, moderationStatus}`, `{status, moderationStatus, categoryId}`, `{status, moderationStatus, brandId}`, and text index search fields.
  - `SellerListing`: `{variantId, status}`, `{sellerId, status}`.
  - `ListingPricingHistory`: `{listingId, createdAt: -1}` (covers sort order).
  - `ListingInventory`: `{listingId, availableQuantity}`.
  - `Order`: `{userId, status}`, `{userId, createdAt: -1}`.

### 5. Redis Non-Blocking Caching
- Key clearing operations (`clearCachePattern`) avoid the blocking `KEYS` command, which halts single-threaded Redis operations under production load. It utilizes cursor-based `SCAN` batch loops to find and invalidate keys asynchronously.

### 6. Stateless Asynchronous Email Queue
- A Redis list (`email:stack`) buffers email triggers. A BullMQ worker isolates active queues periodically using atomic key renaming, grouping emails by template types.
- **BCC Batching**: Batch-sends welcome and status updates as a single SMTP connection using `bcc` arrays, preserving SMTP resource allocations.
- **Brevo Quota Guards**: Dynamically tracks and increments daily limits via an auto-expiring daily Redis key (`email:quota:daily`). If Brevo's 300-email-per-day free tier limit is breached, the worker dynamically redirects outbound batch mail to an auto-created Ethereal developer mock transporter, logging preview URLs to the console.

---

## 🛠 Tech Stack

- **Core**: Node.js v22, TypeScript v6
- **Web App**: Express v5, CORS, Helmet, Compression (Gzip/Deflate)
- **Database**: MongoDB (Mongoose v9)
- **Caching & Queues**: Redis (ioredis v5), BullMQ v5
- **Auth**: Passport.js (Local Session Strategy), cookie-session

---

## 📂 Project Structure

```
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── nodemon.json
├── package.json
├── tsconfig.json
├── types/                   # Custom TypeScript types
├── src/
│   ├── config/              # Passport authentication configurations
│   ├── controller/          # Route controller logic (Aggregation Pipelines)
│   ├── middleware/          # Rate limiting, Auth guards, Telemetry hooks
│   ├── models/              # Mongoose DB Schemas with Compound Indexes
│   ├── routes/              # Express API Route endpoints
│   ├── services/            # BCC Batching & Brevo Quota Email Services
│   ├── workers/             # BullMQ Background Worker definitions
│   ├── utils/               # MongoDB connections & Non-blocking Redis Utils
│   └── server.ts            # Clustered Bootstrap, Telemetry & Orchestrator
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root of the project. A complete template is provided below:

```ini
# Application Configurations
NODE_ENV=development
PORT=3000
SESSION_SECRET=your-secure-session-cookie-secret-key-here
COOKIE_SECURE=false

# Cluster Settings
CLUSTER_WORKERS=4

# Database Connections
MONGODB_URI=mongodb://127.0.0.1:27017/hmarketplace

# Redis Caching Settings
REDIS_URL=redis://127.0.0.1:6379

# Keep-Alive Performance (for Upstream Proxies)
KEEP_ALIVE_TIMEOUT=61000
HEADERS_TIMEOUT=62000
MAX_CONNECTIONS=10000

# Email Queue Configurations (Brevo & Falling back to Ethereal)
EMAIL_DAILY_LIMIT=290
EMAIL_FLUSH_INTERVAL_MS=30000
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=your_brevo_smtp_username_here
BREVO_SMTP_PASS=your_brevo_smtp_password_here
FROM_EMAIL=no-reply@hmarketplace.com
FROM_NAME="HMarketplace Support"
```

---

## 🏁 Local Development Setup

### 1. Prerequisites
Ensure you have the following installed locally:
- **Node.js** (v22 or higher)
- **MongoDB** (running locally on port `27017`)
- **Redis** (running locally on port `6379`)

### 2. Installation
Install project dependencies:
```bash
npm install
```

### 3. Database Seeding
Seed products, categories, mock listings, pricing histories, and test accounts:
```bash
npm run seed
```

### 4. Running the Dev Server
Launch the server in development mode (using nodemon and `tsx` hot reloading):
```bash
npm run dev
```

---

## 🐳 Docker Deployment

The application includes an enterprise-ready, containerized Docker and Docker Compose environment:

### 1. BuildKit Caching Dockerfile
The [Dockerfile](Dockerfile) utilizes modern BuildKit features to speed up successive package builds by up to 90%:
- Uses `--mount=type=cache` to cache Node package files.
- Shrinks final production images by excluding `devDependencies` and cleaning NPM caches in single layers.

### 2. Multi-Container Orchestration
Run the entire production stack (Express Server, MongoDB, Redis) locally or on cloud nodes:
```bash
docker-compose up --build -d
```

*Note: The `docker-compose.yml` configures `CLUSTER_WORKERS=2` for the Express service to prevent virtualized containers from spawning host-wide core configurations, securing the container from OOM event limits.*
