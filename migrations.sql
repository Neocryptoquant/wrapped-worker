CREATE TABLE IF NOT EXISTS transactions (
    signature TEXT PRIMARY KEY,
    slot INTEGER NOT NULL,
    block_time INTEGER,
    fee INTEGER,
    status BOOLEAN, -- true = success, false = error
    meta_json TEXT -- Full metadata as JSON string
);

CREATE TABLE IF NOT EXISTS token_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signature TEXT NOT NULL REFERENCES transactions(signature),
    mint TEXT NOT NULL,
    amount INTEGER NOT NULL, -- Raw amount change
    decimals INTEGER,
    source TEXT,
    destination TEXT,
    block_time INTEGER
);

CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);
CREATE INDEX IF NOT EXISTS idx_token_movements_mint ON token_movements(mint);
