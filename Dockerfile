# Build Stage for Rust Binary
FROM rust:nightly-bullseye as builder

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
# Note: User must ensure vialytics-core is present in the build context (which is now the current dir)
COPY vialytics-core ./vialytics-core

# Build the release binary
WORKDIR /app/vialytics-core
RUN cargo build --release

# ----------------------------------------

# Final Runtime Stage
FROM node:20-bullseye-slim

# Install system runtime dependencies
# - python3, build-essential: required for better-sqlite3 native build
# - libudev-dev, libssl-dev: required for solana-client
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    libudev-dev \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy worker source code (everything in current dir)
COPY . .

# Setup Worker
RUN npm install
RUN npm run build

# Copy the compiled Rust binary from builder stage
# Placing it where analytics.ts expects it: ../../vialytics-core/target/release/vialytics-core
# Since app is at /app, and dist is at /app/dist
# analytics.js is at /app/dist/analytics.js
# path.resolve(__dirname, '../../vialytics-core') -> /app/dist/../../vialytics-core -> /vialytics-core ??
# Wait, /app/dist/.. is /app. /app/.. is /.
# NO.
# /app/dist/../../vialytics-core
# /app/dist -> .. -> /app -> .. -> / -> /vialytics-core.
# So it expects it at /vialytics-core.

# Let's double check path.resolve behavior.
# If __dirname is /app/dist
# path.resolve('/app/dist', '../../vialytics-core')
# = /vialytics-core.

# However, usually we want it relative to the PROJECT root.
# If the user ran it locally:
# wrapped-worker/dist/analytics.js
# wrapped-worker/../../vialytics-core -> This steps out of wrapped-worker!
# So locally it looks for ../vialytics-core (sibling of wrapped-worker).

# In the container, we want to mimic this structure OR adjust the path.
# Changing the code is risky if we want to keep it consistent.
# Let's adjust the placement in the container.

# Use a specific location in the container and maybe we should just create the expected path.
# If we put the binary at /vialytics-core/target/release/vialytics-core, it will work.

COPY --from=builder /app/vialytics-core/target/release/vialytics-core /vialytics-core/target/release/vialytics-core

# Set Environment to Production
ENV NODE_ENV=production

# Start the worker
CMD ["npm", "start"]
