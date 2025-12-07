# Single-stage build - expects pre-compiled binary
FROM node:20-bullseye-slim

# Install system runtime dependencies
# - python3, build-essential: required for better-sqlite3 native build
# - libudev-dev, libssl-dev: required for running the vialytics-core binary
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

# Copy the PRE-COMPILED Rust binary
# This binary should be built locally before deployment
COPY vialytics-core/target/release/vialytics-core /vialytics-core/target/release/vialytics-core

# Set Environment to Production
ENV NODE_ENV=production

# Start the worker
CMD ["npm", "start"]
