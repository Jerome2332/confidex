# Confidex Backend Dockerfile
# Multi-stage build for optimized production image

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies (Python for native modules like better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies (ignore workspace to avoid monorepo detection)
RUN pnpm install --frozen-lockfile --ignore-workspace

# Copy source code
COPY . .

# Build TypeScript (run tsc directly to avoid workspace detection)
RUN npx tsc

# Prune dev dependencies
RUN pnpm prune --prod --ignore-workspace

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S confidex && \
    adduser -S confidex -u 1001 -G confidex

# Copy built artifacts from builder
COPY --from=builder --chown=confidex:confidex /app/dist ./dist
COPY --from=builder --chown=confidex:confidex /app/node_modules ./node_modules
COPY --from=builder --chown=confidex:confidex /app/package.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data && chown confidex:confidex /app/data

# Switch to non-root user
USER confidex

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health/live || exit 1

# Use dumb-init as entrypoint for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
