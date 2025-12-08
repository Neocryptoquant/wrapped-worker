import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import toml from 'toml';
import Database from 'better-sqlite3';
import { getSolPrice } from './services/PriceService';

const VIALYTICS_CORE_PATH = path.resolve(__dirname, '../../vialytics-core');
const BINARY_PATH = path.join(VIALYTICS_CORE_PATH, 'target/release/vialytics-core');
const WORKER_ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(WORKER_ROOT, 'dbs');

// Jan 1, 2025 00:00:00 UTC
const START_TIME_2025 = 1735689600;

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

export interface WrappedStats {
    totalTransactions: number;
    totalGasSpent: number;
    mostActiveDay: string;
    topToken: string;
    firstActiveDate: string;
    daysOnChain: number;
    totalVolumeUSD: number;
    maxHoldingDays: number;
    highestTransaction: number;
    persona: string;
    personaWord: string;
    summary: string;
}

export async function generateWalletStats(walletAddress: string): Promise<WrappedStats> {
    const dbPath = path.join(DB_DIR, `wallet_${walletAddress}.db`);
    const configPath = path.join(DB_DIR, `config_${walletAddress}.toml`);

    // 1. Create Config
    const configContent = `
[source]
endpoint = "${process.env.RPC_URL}"
x-token = "mock-token"
timeout = 10

[vialytics]
rpc_url = "${process.env.RPC_URL}"
db_url = "sqlite:${dbPath}"

[pipeline]
`;
    fs.writeFileSync(configPath, configContent);

    // 2. Run Vialytics Core
    console.log(`Starting indexer for ${walletAddress}...`);
    await new Promise<void>((resolve, reject) => {
        const child = spawn(BINARY_PATH, ['--config', configPath, '--wallet-address', walletAddress], {
            env: { ...process.env, RUST_LOG: 'info' }
        });

        let buffer = '';
        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            buffer += chunk;
            console.log(`[Indexer]: ${chunk.trim()}`);

            // Check buffer for completion message (matches Rust output)
            if (buffer.includes('Finished fetching history')) {
                console.log('History fetch complete. Stopping indexer.');
                child.kill();
                resolve();
            }

            // Keep buffer size manageable
            if (buffer.length > 10000) {
                buffer = buffer.slice(-5000);
            }
        });

        child.stderr.on('data', (data) => {
            console.error(`[Indexer Error]: ${data.toString().trim()}`);
        });

        child.on('close', (code) => {
            if (code === 0 || code === null) { // null if killed
                resolve();
            } else {
                reject(new Error(`Indexer exited with code ${code}`));
            }
        });

        // Timeout after 15 minutes
        setTimeout(() => {
            child.kill();
            reject(new Error('Indexer timed out'));
        }, 900000);
    });

    // 3. Analyze Data
    console.log(`Analyzing data from ${dbPath}...`);
    const db = new Database(dbPath);

    try {
        // Total Transactions (2025 only)
        const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE block_time >= ?').get(START_TIME_2025) as { count: number };

        // Total Gas (in SOL) (2025 only)
        const gas = db.prepare('SELECT SUM(fee) as total FROM transactions WHERE block_time >= ?').get(START_TIME_2025) as { total: number };
        const totalGas = (gas.total || 0) / 1_000_000_000;

        // Most Active Day (2025 only)
        const activeDay = db.prepare(`
      SELECT date(datetime(block_time, 'unixepoch')) as day, count(*) as count 
      FROM transactions 
      WHERE block_time >= ? AND block_time IS NOT NULL 
      GROUP BY day 
      ORDER BY count DESC 
      LIMIT 1
    `).get(START_TIME_2025) as { day: string } | undefined;

        // Top Token (Most interactions) (2025 only)
        const topToken = db.prepare(`
      SELECT mint, count(*) as count 
      FROM token_movements 
      WHERE block_time >= ?
      GROUP BY mint 
      ORDER BY count DESC 
      LIMIT 1
    `).get(START_TIME_2025) as { mint: string } | undefined;

        // Total Volume (Multi-Token Hybrid Approach)
        // Fetch SOL price once
        const solPrice = await getSolPrice();
        console.log(`Current SOL price: $${solPrice}`);

        // Query all token movements grouped by mint
        const tokenMovements = db.prepare(`
            SELECT 
                mint, 
                SUM(ABS(amount)) as total_amount,
                MAX(decimals) as decimals
            FROM token_movements 
            WHERE block_time >= ?
            GROUP BY mint
        `).all(START_TIME_2025) as { mint: string, total_amount: number, decimals: number }[];

        console.log(`Found ${tokenMovements.length} unique tokens traded in 2025`);

        let totalVolumeUSD = 0;
        const { getTokenPrice } = await import('./services/PriceService');

        for (const token of tokenMovements) {
            const price = getTokenPrice(token.mint, solPrice);

            if (price > 0) {
                const tokenAmount = token.total_amount / Math.pow(10, token.decimals || 9);
                const volumeUSD = tokenAmount * price;
                totalVolumeUSD += volumeUSD;

                // Log significant token volumes for debugging
                if (volumeUSD > 100) {
                    console.log(`  ${token.mint.slice(0, 8)}...: $${volumeUSD.toFixed(2)} (${tokenAmount.toFixed(2)} tokens @ $${price})`);
                }
            }
        }

        console.log(`Total Volume (USD): $${totalVolumeUSD.toFixed(2)}`);

        // Max Holding Time (Diamond Hands) (2025 only)
        // Find the token with the earliest 'Received' date that is still held (or was held the longest)
        // Simplified: Max(LastInteraction - FirstInteraction) for any token
        const holdingQuery = db.prepare(`
      SELECT mint, MIN(block_time) as start_time, MAX(block_time) as end_time
      FROM token_movements
      WHERE block_time >= ?
      GROUP BY mint
    `).all(START_TIME_2025) as { mint: string, start_time: number, end_time: number }[];

        let maxHoldingDays = 0;
        const now = Math.floor(Date.now() / 1000);

        for (const row of holdingQuery) {
            // If end_time is close to now, assume they still hold it? 
            // Actually, let's just take the span of interaction.
            // If they bought and never sold, end_time is the buy time, which is wrong.
            // We need to check balance. But we don't have easy balance state here.
            // Approximation: If they have only 1 interaction, assume they still hold it -> duration = now - start.
            // If > 1 interaction, duration = end - start.

            let duration = 0;
            if (row.start_time === row.end_time) {
                duration = now - row.start_time;
            } else {
                duration = row.end_time - row.start_time;
            }

            const days = Math.floor(duration / (60 * 60 * 24));
            if (days > maxHoldingDays) maxHoldingDays = days;
        }

        // First Active Date (2025 only)
        const firstTx = db.prepare('SELECT min(block_time) as time FROM transactions WHERE block_time >= ?').get(START_TIME_2025) as { time: number };
        const firstDate = firstTx.time ? new Date(firstTx.time * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        const daysOnChain = firstTx.time
            ? Math.floor((Date.now() - (firstTx.time * 1000)) / (1000 * 60 * 60 * 24))
            : 0;

        // Highest Single Transaction (2025 only) - using SOL movements
        const solMint = 'So11111111111111111111111111111111111111112';
        const highestTxQuery = db.prepare(`
            SELECT MAX(ABS(amount)) as max_amount
            FROM token_movements
            WHERE mint = ? AND block_time >= ?
        `).get(solMint, START_TIME_2025) as { max_amount: number };
        const highestTransaction = (highestTxQuery.max_amount || 0) / 1_000_000_000;

        // ========================================
        // SOLANA-NATIVE PERSONA DETECTION SYSTEM
        // ========================================

        // Helper function to randomly select from array
        const randomChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

        // Persona word variations (Solana-specific)
        const personaWords = {
            gigaChad: ['SolanaGigaChad', 'GigaChad', 'SolChad', 'Based', 'Chad', 'JupiterChad'],
            whale: ['Whale', 'Gorillionaire', 'Larpwhale', 'GigaBrain'],
            diamondHands: ['Diamondhands', 'HODLer', 'Diamondape', 'Permabull', 'Based'],
            degen: ['SolDegen', 'Degen', 'Apemaxxer', 'PumpFunDegen', 'Fomooor', 'Moonboy'],
            jeet: ['Jeet', 'Paperhands', 'Dumpjeet', 'Exitliquidity', 'Bottomseller', 'SolJeet'],
            ape: ['Ape', 'Apemaxxer', 'Athchaser', 'Fomooor', 'Topbuyer'],
            sniper: ['SolSniper', 'Snipper', 'Frontrunner', 'PhotonChad', 'BananaGunBanger'],
            farmer: ['Airdropfarmer', 'Farmer', 'KOLfarmer', 'Sybilooor', 'Airdrophunter'],
            hodler: ['HODLer', 'Permabull', 'Bagholder', 'Copeholder', 'Diamondhands'],
            shrimp: ['Shrimp', 'Pleb', 'Dustholder', 'Brokeboi', 'Poor'],
            normie: ['Normie', 'Anon', 'Precoiner', 'Nocoiner'],
            jito: ['JitoBundler', 'Jitoooor', 'JitoTipper', 'MEVbot'],
            meme: ['BonkOoor', 'WIFooor', 'Memelord', 'Memetard', 'PumpFunDegen'],
            nft: ['Jpegmaxxer', 'PFPchad', 'MadLadsHolder', 'Floorooor'],
            defi: ['MarginfiMfer', 'KaminoKunt', 'DriftDegen', 'Stakeooor'],
        };

        let persona = "The Normie";
        let personaWord = randomChoice(personaWords.normie);
        let summary = "You're just here for the vibes. Not too risky, not too safe. Probably still figuring out what a DEX is.";

        // Detection logic (ordered by priority)

        // 1. GIGACHAD - Elite performer (high volume + long holds + many txs)
        if (totalVolumeUSD > 500000 && maxHoldingDays > 200 && txCount.count > 500) {
            persona = "The Solana GigaChad";
            personaWord = randomChoice(personaWords.gigaChad);
            summary = "You're not just playing the game, you're rewriting the rules. Massive volume, diamond conviction, and the transaction history to prove it. The rest of us are just NPCs in your simulation.";
        }
        // 2. WHALE - High volume trader
        else if (totalVolumeUSD > 100000) {
            persona = "The Whale";
            personaWord = randomChoice(personaWords.whale);
            summary = "Moving markets like you own the place. When you buy, others follow. When you sell, they panic. The rest of us? Just exit liquidity for your plays.";
        }
        // 3. DIAMOND HANDS - Long-term conviction holder
        else if (maxHoldingDays > 300) {
            persona = "Diamond Hands";
            personaWord = randomChoice(personaWords.diamondHands);
            summary = "Bought the top? Maybe. Selling? Never. You've got conviction that would make a monk jealous. Either riding to Valhalla or zero—no in-between. Respect.";
        }
        // 4. JEET - Paper hands (high activity + very short holds)
        else if (maxHoldingDays < 1 && txCount.count > 50) {
            persona = "The Jeet";
            personaWord = randomChoice(personaWords.jeet);
            summary = "Buy high, sell low, panic immediately. You see a 2% dip and your hands turn to tissue paper. The attention span of a goldfish, the conviction of a wet noodle.";
        }
        // 5. SNIPER - Quick trader with decent volume
        else if (totalVolumeUSD > 50000 && maxHoldingDays < 7 && txCount.count > 100) {
            persona = "The Sniper";
            personaWord = randomChoice(personaWords.sniper);
            summary = "In and out faster than a Jito bundle. You're hunting pumps, sniping launches, and probably have Photon on speed dial. Sleep is for the weak.";
        }
        // 6. APE - FOMO trader (high volume + short holds)
        else if (totalVolumeUSD > 20000 && maxHoldingDays < 3) {
            persona = "The Ape";
            personaWord = randomChoice(personaWords.ape);
            summary = "FOMO is your middle name. Green candles? You're buying. Red candles? Panic selling. You chase pumps like it's an Olympic sport. At least you're consistent.";
        }
        // 7. DEGEN - Very high transaction count
        else if (txCount.count > 1000) {
            persona = "The Degen";
            personaWord = randomChoice(personaWords.degen);
            summary = "Sleep is for the weak. You're clicking buttons at 3 AM, hunting the next 100x. Probably farming airdrops, definitely touching grass never. Godspeed, soldier.";
        }
        // 8. FARMER - Moderate activity, looking for airdrops
        else if (txCount.count > 200 && txCount.count < 1000 && totalVolumeUSD < 10000) {
            persona = "The Farmer";
            personaWord = randomChoice(personaWords.farmer);
            summary = "Every transaction is calculated. Every protocol interaction is strategic. You're not trading—you're farming future airdrops. The harvest better be worth it.";
        }
        // 9. HODLER - Medium holds, moderate activity
        else if (maxHoldingDays > 30 && maxHoldingDays < 300 && txCount.count > 20) {
            persona = "The HODLer";
            personaWord = randomChoice(personaWords.hodler);
            summary = "Not quite diamond hands, but you've got patience. You buy, you hold, you check the charts way too often. Solid conviction, questionable entry points.";
        }
        // 10. SHRIMP - Low volume, few transactions
        else if (totalVolumeUSD < 1000 && txCount.count < 20) {
            persona = "The Shrimp";
            personaWord = randomChoice(personaWords.shrimp);
            summary = "Cute portfolio. Are you even trying, or just here for the memes? Either way, we respect the hustle. Everyone starts somewhere... right?";
        }
        // 11. Check for specific Solana behaviors
        else if (topToken?.mint && topToken.mint.toLowerCase().includes('bonk')) {
            persona = "The Meme Lord";
            personaWord = randomChoice(personaWords.meme);
            summary = "You're here for the culture, not the fundamentals. BONK, WIF, whatever's trending—you're in. Probably have a dog-themed PFP too.";
        }

        return {
            totalTransactions: txCount.count,
            totalGasSpent: totalGas,
            mostActiveDay: activeDay?.day || 'N/A',
            topToken: topToken?.mint || 'SOL',
            firstActiveDate: firstDate,
            daysOnChain,
            totalVolumeUSD,
            maxHoldingDays,
            highestTransaction,
            persona,
            personaWord,
            summary
        };
    } finally {
        db.close();
        // Cleanup temp files
        try {
            fs.unlinkSync(configPath);
            // Optional: keep DB for caching? For now, delete to save space
            fs.unlinkSync(dbPath);
            // Also delete -shm and -wal if they exist
            if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
            if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
        } catch (e) {
            console.error('Error cleaning up temp files:', e);
        }
    }
}
