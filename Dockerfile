# Stage 1: Base stage for shared dependencies and paths
FROM node:22-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

# Stage 2: Development stage (contains all dependencies, including devDependencies)
# Perfect for live code mounting, hot-reloading with nodemon, and tsx execution
FROM base AS development
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev"]

# Stage 3: Builder stage (compiles TypeScript source code to JS dist)
FROM development AS builder
RUN npm run build

# Stage 4: Production runner stage (minimized image with only production dependencies)
FROM node:22-alpine AS production
WORKDIR /usr/src/app

# Default production environment variables (can be overridden by docker-compose)
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./

# Install only production dependencies to keep the image slim
RUN npm ci --omit=dev && npm cache clean --force

# Copy built code from the build stage
COPY --from=builder /usr/src/app/dist ./dist

# Create uploads folder and set ownership for the node user
RUN mkdir -p uploads && chown -R node:node /usr/src/app

# Run as non-root user for security
USER node

EXPOSE 8080

CMD ["npm", "start"]