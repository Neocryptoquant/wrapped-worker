use solana_client::rpc_client::RpcClient;
use sqlx::{Pool, Sqlite};
use std::str::FromStr;

use solana_sdk::{pubkey::Pubkey as SolanaPubkey, signature::Signature};

use crate::db::process_confirmed_transaction;

pub async fn fetch_history(rpc_url: &str, wallet_address: &SolanaPubkey, pool: &Pool<Sqlite>) {
    println!("Fetching history for wallet: {}...", wallet_address);

    let client = RpcClient::new(rpc_url.to_string());
    let pubkey = wallet_address;

    let mut before: Option<Signature> = None;
    loop {
        let signatures = match client.get_signatures_for_address_with_config(
            &pubkey,
            solana_client::rpc_client::GetConfirmedSignaturesForAddress2Config {
                before,
                limit: Some(100),
                ..Default::default()
            },
        ) {
            Ok(sig) => sig,
            Err(e) => {
                eprintln!("Error fetching signatures: {}", e);
                break;
            }
        };
        if signatures.is_empty() {
            break;
        }

        for sig_info in &signatures {
            let signature_str = &sig_info.signature;
            let signature = Signature::from_str(signature_str).unwrap();

            let exists = sqlx::query("SELECT 1 as exists FROM transactions WHERE signature = $1")
                .bind(signature_str)
                .fetch_optional(pool)
                .await
                .unwrap_or(None);

            if exists.is_some() {
                println!(
                    "Transaction {} already exists in the database, skipping.",
                    signature_str
                );
                before = Some(signature);
                continue;
            }

            match client.get_transaction_with_config(
                &signature,
                solana_client::rpc_config::RpcTransactionConfig {
                    encoding: Some(solana_transaction_status::UiTransactionEncoding::Json),
                    commitment: Some(solana_sdk::commitment_config::CommitmentConfig::confirmed()),
                    max_supported_transaction_version: Some(0),
                },
            ) {
                Ok(tx) => {
                    process_confirmed_transaction(pool, signature_str, &tx).await;
                }
                Err(e) => {
                    eprintln!("Error fetching transaction {}: {}", signature_str, e);
                }
            }

            before = Some(signature);
        }
        if signatures.len() < 100 {
            break;
        }
    }

    println!("Finished fetching history for wallet: {}", wallet_address);
}
