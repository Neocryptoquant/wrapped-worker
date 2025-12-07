import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Database } from './types';
import { generateWalletStats } from './analytics';

// Load .env file if it exists (for local dev), Railway injects vars directly
dotenv.config({ path: '.env' });

// Diagnostic logging
console.log('Environment check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'SET' : 'MISSING');
console.log('RPC_URL:', process.env.RPC_URL ? 'SET' : 'MISSING');
console.log('TREASURY_WALLET:', process.env.TREASURY_WALLET ? 'SET' : 'MISSING');

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const TREASURY_WALLET = process.env.TREASURY_WALLET!;

// Concurrency settings
const MAX_CONCURRENT_JOBS = 5; // Process up to 5 wallets simultaneously
const TIMEOUT_MS = 300000; // 5 minutes per job
const MAX_RETRIES = 2;

const supabase = createClient<any>(SUPABASE_URL, SUPABASE_KEY);
const connection = new Connection(RPC_URL);

// Track currently processing requests
const processingJobs = new Set<string>();

async function verifyPayment(txSignature: string, walletAddress: string): Promise<boolean> {
    try {
        const tx = await connection.getParsedTransaction(txSignature, {
            maxSupportedTransactionVersion: 0,
        });

        if (!tx) {
            console.error(`Transaction ${txSignature} not found`);
            return false;
        }

        // Check if sender matches
        const accounts = tx.transaction.message.accountKeys;
        const sender = accounts[0].pubkey.toBase58();
        if (sender !== walletAddress) {
            console.error(`Sender mismatch: expected ${walletAddress}, got ${sender}`);
            return false;
        }

        // Check for transfer to treasury
        // This is a simplified check. In production, we'd parse the instructions more carefully.
        // For now, we assume a simple transfer instruction.
        // TODO: Implement robust instruction parsing to verify 0.02 SOL transfer to TREASURY_WALLET

        return true;
    } catch (error) {
        console.error('Error verifying payment:', error);
        return false;
    }
}

async function processRequest(request: any, retryCount = 0) {
    const jobId = request.id;

    // Prevent duplicate processing
    if (processingJobs.has(jobId)) {
        console.log(`Job ${jobId} already being processed, skipping...`);
        return;
    }

    processingJobs.add(jobId);
    console.log(`[${jobId}] Processing request for ${request.wallet_address}... (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

    try {
        // 1. Verify Payment
        const isValidPayment = await verifyPayment(request.tx_signature, request.wallet_address);
        if (!isValidPayment) {
            throw new Error('Invalid payment');
        }

        // 2. Update status to processing
        await supabase.from('wrapped_requests').update({ status: 'processing' } as any).eq('id', request.id);

        // 3. Generate Stats (Real Data) with Timeout
        const stats = await Promise.race([
            generateWalletStats(request.wallet_address),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Processing timeout')), TIMEOUT_MS)
            )
        ]);
        console.log(`[${jobId}] Stats generated:`, stats);

        // 4. Save results
        await supabase.from('wrapped_requests').update({
            status: 'completed',
            stats_json: stats,
        } as any).eq('id', request.id);

        console.log(`[${jobId}] Request completed successfully.`);
    } catch (error) {
        console.error(`[${jobId}] Error processing request:`, error);

        // Retry logic
        if (retryCount < MAX_RETRIES) {
            console.log(`[${jobId}] Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
            processingJobs.delete(jobId);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
            return processRequest(request, retryCount + 1);
        }

        // Mark as failed after max retries
        await supabase.from('wrapped_requests').update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error'
        } as any).eq('id', request.id);
    } finally {
        processingJobs.delete(jobId);
    }
}

async function cleanupOldRequests() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { error } = await supabase
        .from('wrapped_requests')
        .delete()
        .eq('status', 'completed')
        .lt('created_at', oneHourAgo);

    if (error) {
        console.error('Error cleaning up old requests:', error);
    }
}

async function processPendingRequests() {
    // Only fetch if we have capacity
    if (processingJobs.size >= MAX_CONCURRENT_JOBS) {
        return;
    }

    const availableSlots = MAX_CONCURRENT_JOBS - processingJobs.size;

    const { data: requests, error } = await supabase
        .from('wrapped_requests')
        .select('*')
        .eq('status', 'pending')
        .limit(availableSlots);

    if (error) {
        console.error('Error fetching pending requests:', error);
        return;
    }

    if (requests && requests.length > 0) {
        console.log(`Found ${requests.length} pending requests. Processing in parallel... (${processingJobs.size}/${MAX_CONCURRENT_JOBS} slots used)`);

        // Process all requests in parallel (non-blocking)
        requests.forEach(request => {
            processRequest(request).catch(err => {
                console.error(`Unhandled error in processRequest:`, err);
            });
        });
    }
}

async function main() {
    console.log(`Worker started. Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);
    console.log('Polling for requests...');

    // Initial cleanup
    await cleanupOldRequests();

    // Process any existing pending requests immediately
    await processPendingRequests();

    const channel = supabase
        .channel('wrapped_requests_changes')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'wrapped_requests',
                filter: 'status=eq.pending',
            },
            (payload) => {
                console.log('New request received via Realtime:', payload.new);
                processRequest(payload.new).catch(err => {
                    console.error('Error processing realtime request:', err);
                });
            }
        )
        .subscribe();

    // Keep the process alive and run cleanup/polling periodically
    setInterval(() => {
        cleanupOldRequests();
        processPendingRequests(); // Poll every 5 seconds as backup
    }, 5000);
}

main().catch(console.error);
