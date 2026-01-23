# Confidex Frontend Dockerfile
# Multi-stage build for Next.js production

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for environment variables
ARG NEXT_PUBLIC_PROGRAM_ID
ARG NEXT_PUBLIC_MXE_PROGRAM_ID
ARG NEXT_PUBLIC_MXE_X25519_PUBKEY
ARG NEXT_PUBLIC_NETWORK=devnet
ARG NEXT_PUBLIC_ARCIUM_ENABLED=true
ARG NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456

# Set environment variables for build
ENV NEXT_PUBLIC_PROGRAM_ID=$NEXT_PUBLIC_PROGRAM_ID
ENV NEXT_PUBLIC_MXE_PROGRAM_ID=$NEXT_PUBLIC_MXE_PROGRAM_ID
ENV NEXT_PUBLIC_MXE_X25519_PUBKEY=$NEXT_PUBLIC_MXE_X25519_PUBKEY
ENV NEXT_PUBLIC_NETWORK=$NEXT_PUBLIC_NETWORK
ENV NEXT_PUBLIC_ARCIUM_ENABLED=$NEXT_PUBLIC_ARCIUM_ENABLED
ENV NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=$NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js application
RUN pnpm build

# ============================================
# Stage 3: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S confidex && \
    adduser -S confidex -u 1001 -G confidex

# Copy necessary files from builder
COPY --from=builder --chown=confidex:confidex /app/public ./public
COPY --from=builder --chown=confidex:confidex /app/.next/standalone ./
COPY --from=builder --chown=confidex:confidex /app/.next/static ./.next/static

# Switch to non-root user
USER confidex

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Use dumb-init as entrypoint
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]
