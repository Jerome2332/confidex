# Multi-stage build for Confidex Prover Service
# Installs nargo (Noir compiler) + sunspot (Groth16 prover)

# ============================================
# Stage 1: Build nargo and sunspot
# ============================================
FROM ubuntu:22.04 AS builder

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    curl git build-essential pkg-config libssl-dev \
    golang-go ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install nargo via noirup (locked to 1.0.0-beta.13 for Sunspot compatibility)
RUN curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
ENV PATH="/root/.nargo/bin:${PATH}"
RUN noirup -v 1.0.0-beta.13

# Build sunspot from source
WORKDIR /tmp/sunspot
RUN git clone --depth 1 https://github.com/Sunspot-Labs/sunspot.git . \
    && cd go && go build -o /usr/local/bin/sunspot

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-slim

WORKDIR /app

# Install runtime deps
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy binaries from builder
COPY --from=builder /root/.nargo/bin/nargo /usr/local/bin/nargo
COPY --from=builder /usr/local/bin/sunspot /usr/local/bin/sunspot

# Copy circuit artifacts (read-only, needed for proof generation)
COPY circuits/eligibility/target/ /app/circuits/eligibility/target/
COPY circuits/eligibility/Nargo.toml /app/circuits/eligibility/

# Install pnpm
RUN npm install -g pnpm

# Copy prover service code
COPY prover-service/package.json prover-service/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prover-service/src ./src
COPY prover-service/tsconfig.json ./
RUN pnpm build

# Create temp directory for proof generation
RUN mkdir -p /tmp/confidex-proofs

# Environment
ENV NODE_ENV=production
ENV PORT=3002
ENV CIRCUIT_DIR=/app/circuits/eligibility
ENV SUNSPOT_BINARY_PATH=/usr/local/bin/sunspot
ENV PROVER_TEMP_DIR=/tmp/confidex-proofs

EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

CMD ["node", "dist/index.js"]
