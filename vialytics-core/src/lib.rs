//! # Vialytics Core Library
//!
//! This library provides the core components for the Vialytics indexing engine.
//! It is designed to be modular, separating database interactions, transaction handling,
//! and parsing logic.
//!
//! ## Modules
//!
//! - [`db`]: Database connection, schema management, and query execution.
//! - [`handler`]: The core logic for processing streamed transactions.
//! - [`history`]: Utilities for backfilling historical data from RPC.
//! - [`parser`]: Logic for parsing raw gRPC messages into usable structures.

pub mod db;
pub mod handler;
pub mod history;
pub mod parser;

pub use db::*;
pub use handler::*;

use serde::Deserialize;
use yellowstone_vixen::config::VixenConfig;
use yellowstone_vixen_yellowstone_grpc_source::YellowstoneGrpcConfig;

#[derive(Deserialize)]
pub struct VialyticsConfig {
    pub rpc_url: String,
    pub db_url: String,
}

#[derive(Deserialize)]
pub struct AppConfig {
    #[serde(flatten)]
    pub vixen: VixenConfig<YellowstoneGrpcConfig>,
    pub vialytics: VialyticsConfig,
}
