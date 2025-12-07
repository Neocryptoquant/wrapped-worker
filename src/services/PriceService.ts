import fetch from 'node-fetch';

const BINANCE_PRICE_API = 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT';

interface PriceResponse {
    symbol: string;
    price: string;
}

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
