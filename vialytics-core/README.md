# Vialytics Core

**Vialytics Core** is the high-performance data ingestion and indexing engine for the Vialytics platform. It connects to the Solana blockchain via the Yellowstone gRPC Geyser interface to stream real-time transaction data and historical records into a local SQLite database for analytics.

## Architecture

The core is built on a pipeline architecture using `yellowstone-vixen`:

1.  **Source**: Connects to a Yellowstone gRPC endpoint (e.g., Helius, Triton) to receive a stream of blocks and transactions.
2.  **Filter**: Applies a pre-filter (server-side) to only receive transactions relevant to specific accounts (e.g., the user's wallet).
3.  **Parser**: `RawTransactionParser` extracts the relevant transaction data from the raw gRPC message.
4.  **Handler**: `TransactionHandler` processes the parsed data. It:
    - Fetches the full confirmed transaction details from RPC (if needed).
    - Stores the transaction metadata and status in the SQLite database.
5.  **Storage**: SQLite is used for lightweight, portable, and SQL-queryable storage of transaction history.

## Key Components

- **`src/main.rs`**: Entry point. Configures the Vixen pipeline, connects to DB, fetches initial history, and starts the real-time stream.
- **`src/handler.rs`**: The business logic for processing incoming transactions. It bridges the gap between the stream and the database.
- **`src/db.rs`**: Database abstraction layer using `sqlx`. Handles schema migrations and data insertion.
- **`src/history.rs`**: Backfill mechanism. Fetches historical transactions via standard RPC to ensure the database is complete, not just starting from "now".

## Setup & Usage

1.  **Configuration**:
    - Copy `Vixen.toml.example` to `Vixen.toml`.
    - Edit `Vixen.toml` to add your gRPC endpoint, authentication token, RPC URL (with API key), and database URL.
    
    ```toml
    [source]
    endpoint = "https://grpc.solanavibestation.com"
    x_token = "your_token"
    timeout = 10

    [vialytics]
    rpc_url = "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
    db_url = "sqlite:wallet.db"
    ```

2.  **Run**:
    ```bash
    cargo run -- --config Vixen.toml --wallet-address <PUBKEY>
    ```

## Why Rust Docs?

We use standard Rust documentation comments (`///` and `//!`) throughout the codebase. This allows us to generate professional-grade HTML documentation using `cargo doc --open`. It keeps the documentation close to the code, ensuring it stays up-to-date and is easily accessible to developers.
