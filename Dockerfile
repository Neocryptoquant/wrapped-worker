# Build Stage - Use Debian Bullseye to match Railway's runtime
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
COPY vialytics-core ./vialytics-core

# Build the release binary
WORKDIR /app/vialytics-core
RUN cargo build --release

# ----------------------------------------

# Final Runtime Stage
FROM node:20-bullseye-slim

# Install system runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    libudev-dev \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy worker source code
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

# Copy the compiled Rust binary from builder stage
COPY --from=builder /app/vialytics-core/target/release/vialytics-core /vialytics-core/target/release/vialytics-core

# Set Environment to Production
ENV NODE_ENV=production

# Start the worker
CMD ["npm", "start"]
