# Build Stage for Rust Binary
FROM rust:1.83-bullseye as builder

# Install system dependencies for Solana SDK
RUN apt-get update && apt-get install -y \
    pkg-config \
    libudev-dev \
    libssl-dev \
    build-essential \
    cmake \
    clang

WORKDIR /app

# Copy the core engine source
# Note: User must ensure vialytics-core is present in the build context
COPY vialytics-core ./vialytics-core

# Build the release binary
WORKDIR /app/vialytics-core
RUN cargo build --release

# ----------------------------------------

# Final Runtime Stage
FROM node:18-bullseye-slim

# Install system runtime dependencies
RUN apt-get update && apt-get install -y \
    libudev-dev \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy worker source code
COPY wrapped-worker ./wrapped-worker

# Setup Worker
WORKDIR /app/wrapped-worker
RUN npm install
RUN npm run build

# Copy the compiled Rust binary from builder stage
# Placing it where analytics.ts expects it: ../../vialytics-core/target/release/vialytics-core
# Relative to /app/wrapped-worker/dist, ../../ is /app
# So we need to put it at /app/vialytics-core/target/release/vialytics-core
COPY --from=builder /app/vialytics-core/target/release/vialytics-core /app/vialytics-core/target/release/vialytics-core

# Set Environment to Production
ENV NODE_ENV=production

# Start the worker
CMD ["npm", "start"]
