# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy source code
COPY src ./src

# Build the TypeScript project
RUN npm run build

# Stage 2: Production runner stage
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built code from the build stage
COPY --from=builder /usr/src/app/dist ./dist

# Create uploads folder and set ownership for the node user
RUN mkdir -p uploads && chown -R node:node /usr/src/app

# Run as non-root user for security
USER node

# Expose port (default 8080)
EXPOSE 8080

CMD ["npm", "start"]