import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

console.log('Testing connection to:', SUPABASE_URL);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testConnection() {
    console.log('Attempting to select from wrapped_requests...');

    const { data, error } = await supabase
        .from('wrapped_requests')
        .select('count')
        .limit(1);

    if (error) {
        console.error('❌ Connection Failed:', error);
        console.error('Details:', error.message, error.details, error.hint);
    } else {
        console.log('✅ Connection Successful!');
        console.log('Table found. Row count query result:', data);
    }
}

testConnection();
