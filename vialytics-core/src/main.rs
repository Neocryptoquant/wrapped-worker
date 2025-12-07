#![allow(clippy::module_name_repetitions)]
#![allow(clippy::pedantic)]

use std::{path::PathBuf, str::FromStr, sync::Arc};

use clap::Parser;
use solana_client::rpc_client;
use tracing_subscriber::prelude::*;
use vialytics_core::{
    AppConfig, db, handler::TransactionHandler, history::fetch_history,
    parser::RawTransactionParser,
};
use yellowstone_vixen::{
    self as vixen,
    filter_pipeline::FilterPipeline,
    vixen_core::{Prefilter, Pubkey},
};
use yellowstone_vixen_yellowstone_grpc_source::YellowstoneGrpcSource;

#[derive(clap::Parser)]
#[command(name = "vialytics-core", version, author, about)]
pub struct Opts {
    #[arg(long, short)]
    config: PathBuf,

    #[arg(long)]
    wallet_address: String,
}

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let Opts {
        config,
        wallet_address,
    } = Opts::parse();

    let config_content = std::fs::read_to_string(config).expect("Error reading the config file");
    let config: AppConfig = toml::from_str(&config_content).expect("Error parsing config");

    let pool = db::connect(&config.vialytics.db_url).await;
    db::run_migrations(&pool).await;

    let wallet_pubkey =
        solana_sdk::pubkey::Pubkey::from_str(&wallet_address).expect("Invalid wallet address");

    fetch_history(&config.vialytics.rpc_url, &wallet_pubkey, &pool).await;
    println!("History fetch completed.");
    println!("Starting stream for wallet: {}...", wallet_address);
    let rpc_client = Arc::new(rpc_client::RpcClient::new(config.vialytics.rpc_url.clone()));

    let vixen_pubkey = Pubkey::from(wallet_pubkey.to_bytes());

    let db_pool = pool.clone();
    let runtime = vixen::Runtime::<YellowstoneGrpcSource>::builder()
        .transaction(FilterPipeline::new(
            RawTransactionParser,
            [TransactionHandler {
                db_pool,
                rpc_client,
            }],
            Prefilter::builder().transaction_accounts_include([vixen_pubkey]),
        ))
        .build(config.vixen);

    tokio::task::spawn_blocking(move || {
        runtime.run();
    })
    .await
    .expect("Streaming failed")
}
