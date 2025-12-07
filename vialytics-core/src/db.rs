use std::str::FromStr;

use solana_transaction_status::{
    EncodedConfirmedTransactionWithStatusMeta, option_serializer::OptionSerializer,
};
use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};

/// 0xAbim: This db module provides functions to connect to a SQLite database, run migrations,
/// save transaction data, and process confirmed transactions to extract and store token movements.
/// It uses the sqlx crate for database interactions and the solana_transaction_status crate to handle
/// Solana transaction data.   

pub async fn connect(db_url: &str) -> Pool<Sqlite> {
    let options = sqlx::sqlite::SqliteConnectOptions::from_str(db_url)
        .expect("Invalid database URL")
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .expect("Failed to connect to the database")
}

pub async fn run_migrations(pool: &Pool<Sqlite>) {
    let migrator = include_str!("../../migrations.sql");
    for statement in migrator.split(";") {
        if !statement.trim().is_empty() {
            sqlx::query(statement)
                .execute(pool)
                .await
                .expect("Failed to run migration");
        }
    }
}

pub async fn save_transaction(
    pool: &Pool<Sqlite>,
    signature: &str,
    slot: u64,
    block_time: Option<i64>,
    fee: u64,
    status: bool,
    meta_json: serde_json::Value,
) {
    let result = sqlx::query(
        r#"
        INSERT INTO transactions (signature, slot, block_time, fee, status, meta_json)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(signature) DO NOTHING
        "#,
    )
    .bind(signature)
    .bind(slot as i64)
    .bind(block_time)
    .bind(fee as i64)
    .bind(status)
    .bind(meta_json.to_string())
    .execute(pool)
    .await;

    if let Err(e) = result {
        eprintln!("Failed to save transaction {}: {}", signature, e);
    }
}

pub async fn save_token_movement(
    pool: &Pool<Sqlite>,
    signature: &str,
    mint: &str,
    amount: i64,
    decimals: i32,
    source: Option<&str>,
    destination: Option<&str>,
    block_time: Option<i64>,
) {
    let result = sqlx::query(
        r#"
        INSERT INTO token_movements (signature, mint, amount, decimals, source, destination, block_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(signature)
    .bind(mint)
    .bind(amount)
    .bind(decimals)
    .bind(source)
    .bind(destination)
    .bind(block_time)
    .execute(pool)
    .await;

    if let Err(e) = result {
        eprintln!("Failed to save token movement for {}: {}", signature, e);
    }
}

pub async fn process_confirmed_transaction(
    pool: &Pool<Sqlite>,
    signature: &str,
    tx: &EncodedConfirmedTransactionWithStatusMeta,
) {
    let slot = tx.slot;
    let block_time = tx.block_time;
    let (fee, status, meta_json) = if let Some(meta) = &tx.transaction.meta {
        (
            meta.fee as u64,
            meta.status.is_ok(),
            serde_json::to_value(meta).unwrap_or(serde_json::Value::Null),
        )
    } else {
        (0, false, serde_json::Value::Null)
    };

    save_transaction(pool, signature, slot, block_time, fee, status, meta_json).await;

    //0xAbim: this fn processes token movements from the transaction meta and saves them to the database
    if let Some(meta) = &tx.transaction.meta {
        if let (OptionSerializer::Some(pre), OptionSerializer::Some(post)) =
            (&meta.pre_token_balances, &meta.post_token_balances)
        {
            for post_balance in post {
                let account_index = post_balance.account_index;
                let mint = &post_balance.mint;
                let decimals = post_balance.ui_token_amount.decimals;
                let post_amount = post_balance
                    .ui_token_amount
                    .amount
                    .parse::<i64>()
                    .unwrap_or(0);

                let pre_amount = pre
                    .iter()
                    .find(|p| p.account_index == account_index && p.mint == *mint)
                    .map(|p| p.ui_token_amount.amount.parse::<i64>().unwrap_or(0))
                    .unwrap_or(0);

                let difference = post_amount - pre_amount;
                if difference != 0 {
                    save_token_movement(
                        pool,
                        signature,
                        mint,
                        difference,
                        decimals as i32,
                        match &post_balance.owner {
                            solana_transaction_status::option_serializer::OptionSerializer::Some(owner) => Some(owner.as_str()),
                            _ => None,
                        },
                        None,
                        block_time,
                    ).await;

                    println!(
                        "Token Movement Detected: {} {:?} {} (Mint: {}",
                        if difference > 0 { "Received" } else { "Sent" },
                        difference.abs(),
                        mint,
                        mint
                    );
                }
            }
        }
    }

    println!(
        "Processed transaction: {} | Slot: {} | Status: {} | Fee: {}",
        signature,
        slot,
        if status { "Success" } else { "Failure" },
        fee
    );
}
