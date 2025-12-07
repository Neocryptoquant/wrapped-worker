export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            wrapped_requests: {
                Row: {
                    id: string
                    created_at: string
                    wallet_address: string
                    tx_signature: string
                    status: 'pending' | 'processing' | 'completed' | 'failed'
                    stats_json: Json | null
                }
                Insert: {
                    id?: string
                    created_at?: string
                    wallet_address: string
                    tx_signature: string
                    status?: 'pending' | 'processing' | 'completed' | 'failed'
                    stats_json?: Json | null
                }
                Update: {
                    id?: string
                    created_at?: string
                    wallet_address?: string
                    tx_signature?: string
                    status?: 'pending' | 'processing' | 'completed' | 'failed'
                    stats_json?: Json | null
                }
            }
        }
    }
}
