import fetch from 'node-fetch';

const BINANCE_PRICE_API = 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT';

interface PriceResponse {
    symbol: string;
    price: string;
}

// Hardcoded stablecoins (always $1)
const STABLECOINS = new Map<string, number>([
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1.0], // USDC
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 1.0], // USDT
]);

// Major Solana tokens with fallback prices (updated as of Dec 2024)
const MAJOR_TOKENS = new Map<string, number>([
    ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 0.000025], // BONK
    ['EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 2.5],     // WIF
    ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 0.85],    // JUP
    ['jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 2.8],     // JTO
]);

export async function getSolPrice(): Promise<number> {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        if (!response.ok) throw new Error('API failed');
        const data = await response.json() as any;
        return data.solana.usd || 134.27;
    } catch (e) {
        console.warn('Price fetch failed, using fallback 134.27');
        return 134.27;
    }
}

/**
 * Get price for a token mint address
 * @param mint Token mint address
 * @param solPrice Current SOL price (to avoid re-fetching)
 * @returns Price in USD, or 0 if unknown
 */
export function getTokenPrice(mint: string, solPrice: number): number {
    // SOL native mint
    if (mint === 'So11111111111111111111111111111111111111112') {
        return solPrice;
    }

    // Stablecoins
    if (STABLECOINS.has(mint)) {
        return STABLECOINS.get(mint)!;
    }

    // Major tokens
    if (MAJOR_TOKENS.has(mint)) {
        return MAJOR_TOKENS.get(mint)!;
    }

    // Unknown token - return 0 (won't contribute to volume)
    return 0;
}
