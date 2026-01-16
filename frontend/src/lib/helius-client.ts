// Helius API Client - Direct HTTP implementation
// Using REST API directly for maximum compatibility

// Helius API Key from environment
const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.NEXT_PUBLIC_RPC_ENDPOINT || `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Types for parsed transactions
export interface ParsedTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  description: string;
  nativeTransfers?: NativeTransfer[];
  tokenTransfers?: TokenTransfer[];
  accountData?: AccountData[];
  instructions?: InstructionData[];
}

export interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  mint: string;
  tokenStandard: string;
}

export interface AccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: TokenBalanceChange[];
}

export interface TokenBalanceChange {
  userAccount: string;
  tokenAccount: string;
  mint: string;
  rawTokenAmount: {
    tokenAmount: string;
    decimals: number;
  };
}

export interface InstructionData {
  programId: string;
  accounts: string[];
  data: string;
  innerInstructions?: InstructionData[];
}

// Fetch enhanced transactions for an address using Helius Enhanced Transactions API
export async function getTransactionsByAddress(
  address: string,
  options: {
    limit?: number;
    before?: string;
    type?: string;
  } = {}
): Promise<ParsedTransaction[]> {
  if (!HELIUS_API_KEY) {
    console.warn('[HeliusClient] No API key found');
    return [];
  }

  try {
    const baseUrl = `https://api.helius.xyz/v0/addresses/${address}/transactions`;
    const params = new URLSearchParams();
    params.append('api-key', HELIUS_API_KEY);

    if (options.limit) params.append('limit', options.limit.toString());
    if (options.before) params.append('before', options.before);
    if (options.type) params.append('type', options.type);

    const url = `${baseUrl}?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[HeliusClient] API error:', response.status, errorText);
      throw new Error(`Failed to fetch transactions: ${response.status}`);
    }

    const transactions = await response.json();
    return transactions as ParsedTransaction[];
  } catch (error) {
    console.error('[HeliusClient] Error fetching transactions:', error);
    throw error;
  }
}

// Fetch transactions for a specific program
export async function getProgramTransactions(
  programId: string,
  options: {
    limit?: number;
    before?: string;
  } = {}
): Promise<ParsedTransaction[]> {
  // The Helius API for program transactions is the same as address transactions
  // It will return all transactions involving that program
  return getTransactionsByAddress(programId, options);
}

// Parse raw transaction signatures into enhanced transactions
export async function parseTransactions(
  signatures: string[]
): Promise<ParsedTransaction[]> {
  if (!HELIUS_API_KEY || signatures.length === 0) {
    return [];
  }

  try {
    const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transactions: signatures,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to parse transactions: ${response.status}`);
    }

    const transactions = await response.json();
    return transactions as ParsedTransaction[];
  } catch (error) {
    console.error('[HeliusClient] Error parsing transactions:', error);
    throw error;
  }
}

// Get transaction signatures for an address using standard RPC
export async function getSignaturesForAddress(
  address: string,
  options: {
    limit?: number;
    before?: string;
    until?: string;
  } = {}
): Promise<{ signature: string; slot: number; blockTime: number | null; err: unknown }[]> {
  try {
    const response = await fetch(HELIUS_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [
          address,
          {
            limit: options.limit || 20,
            before: options.before,
            until: options.until,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'RPC error');
    }

    return (data.result || []).map((sig: { signature: string; slot: number; blockTime: number | null; err: unknown }) => ({
      signature: sig.signature,
      slot: sig.slot,
      blockTime: sig.blockTime,
      err: sig.err,
    }));
  } catch (error) {
    console.error('[HeliusClient] Error getting signatures:', error);
    throw error;
  }
}

// Helper to get the Helius RPC URL
export function getHeliusRpcUrl(): string {
  return HELIUS_RPC_URL;
}

// Helper to check if Helius is configured
export function isHeliusConfigured(): boolean {
  return !!HELIUS_API_KEY;
}
