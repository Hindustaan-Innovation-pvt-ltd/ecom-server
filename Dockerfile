# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for TypeScript compilation)
# Uses BuildKit cache mounts to accelerate consecutive package installations
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source code and custom type definitions
COPY src ./src
COPY types ./types

# Build the TypeScript project
RUN npm run build

# Stage 2: Production runner stage
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Default production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies & clean cache in one step to minimize layer size
# Uses BuildKit cache mounts for rapid installations
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && npm cache clean --force

# Copy built code from the build stage
COPY --from=builder /usr/src/app/dist ./dist

# Create uploads folder and set ownership for the node user
RUN mkdir -p uploads && chown -R node:node /usr/src/app

# Run as non-root user for security
USER node

# Expose default HTTP Port
EXPOSE 3000

CMD ["npm", "start"]