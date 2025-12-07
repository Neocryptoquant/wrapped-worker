use crate::db::process_confirmed_transaction;
use solana_client::rpc_client::RpcClient;
use solana_sdk::signature::Signature;
use solana_transaction_status::UiTransactionEncoding;
use sqlx::{Pool, Sqlite};
use std::{fmt::Debug, str::FromStr, sync::Arc};
use yellowstone_vixen::{
    self as vixen,
    vixen_core::{TransactionUpdate, bs58},
};

// #[derive(Debug)]
pub struct TransactionHandler {
    pub db_pool: Pool<Sqlite>,
    pub rpc_client: Arc<RpcClient>,
}

impl Debug for TransactionHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TransactionHandler")
            .field("db_pool", &self.db_pool)
            .finish()
    }
}

impl vixen::Handler<TransactionUpdate> for TransactionHandler {
    async fn handle(&self, value: &TransactionUpdate) -> vixen::HandlerResult<()> {
        let slot = value.slot;

        if let Some(tx_info) = &value.transaction {
            let signature_bytes = &tx_info.signature;
            let signature = bs58::encode(signature_bytes).into_string();

            let rpc = self.rpc_client.clone();
            let db_pool_clone = self.db_pool.clone();
            let signature_clone = signature.clone();
            //0xAbim: Instruction to fetch and process the confirmed transaction
            tokio::spawn(async move {
                match rpc.get_transaction_with_config(
                    &Signature::from_str(&signature_clone).unwrap(),
                    solana_client::rpc_config::RpcTransactionConfig {
                        encoding: Some(UiTransactionEncoding::Json),
                        commitment: Some(
                            solana_sdk::commitment_config::CommitmentConfig::confirmed(),
                        ),
                        max_supported_transaction_version: Some(0),
                    },
                ) {
                    Ok(tx) => {
                        process_confirmed_transaction(&db_pool_clone, &signature_clone, &tx).await;
                    }
                    Err(e) => {
                        eprintln!("Error fetching transaction {}: {}", signature_clone, e);
                    }
                }
            });

            tracing::info!(slot = slot, signature = %signature, "Processing transaction");
        }
        Ok(())
    }
}
