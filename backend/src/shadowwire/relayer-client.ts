/**
 * ShadowWire Relayer Client
 *
 * Backend service for executing ShadowWire private transfers during settlement.
 * This client interacts with the ShadowWire API (part of ShadowPay) to perform
 * Bulletproof-based privacy transfers, hiding amounts from on-chain observers.
 *
 * ShadowWire uses the ShadowPay API infrastructure:
 * - Base URL: https://shadow.radr.fun/shadowpay/api
 * - Authentication: Optional API key OR wallet signatures
 * - Transfer flow: Upload proof -> Internal/External transfer
 *
 * For backend settlement, the crank executes transfers on behalf of users
 * who have deposited to the ShadowWire pool.
 */

import { PublicKey, Keypair } from '@solana/web3.js';

// Supported tokens on ShadowWire (from SDK constants)
export const SHADOWWIRE_TOKENS = [
  'SOL', 'RADR', 'USDC', 'ORE', 'BONK', 'JIM', 'GODL', 'HUSTLE',
  'ZEC', 'CRT', 'BLACKCOIN', 'GIL', 'ANON', 'WLFI', 'USD1', 'AOL', 'IQLABS'
] as const;

export type ShadowWireToken = typeof SHADOWWIRE_TOKENS[number];

// ShadowWire fee: 1% (100 basis points)
export const SHADOWWIRE_FEE_BPS = 100;

// Token decimals (from SDK)
const TOKEN_DECIMALS: Record<ShadowWireToken, number> = {
  SOL: 9,
  RADR: 9,
  USDC: 6,
  ORE: 11,
  BONK: 5,
  JIM: 9,
  GODL: 11,
  HUSTLE: 9,
  ZEC: 8,
  CRT: 9,
  BLACKCOIN: 6,
  GIL: 6,
  ANON: 9,
  WLFI: 6,
  USD1: 6,
  AOL: 6,
  IQLABS: 9,
};

// Token mint addresses (from SDK)
const TOKEN_MINTS: Record<ShadowWireToken, string> = {
  SOL: 'Native',
  RADR: 'CzFvsLdUazabdiu9TYXujj4EY495fG7VgJJ3vQs6bonk',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  ORE: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JIM: 'H9muD33usLGYv1tHvxCVpFwwVSn27x67tBQYH1ANbonk',
  GODL: 'GodL6KZ9uuUoQwELggtVzQkKmU1LfqmDokPibPeDKkhF',
  HUSTLE: 'HUSTLFV3U5Km8u66rMQExh4nLy7unfKHedEXVK1WgSAG',
  ZEC: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
  CRT: 'CRTx1JouZhzSU6XytsE42UQraoGqiHgxabocVfARTy2s',
  BLACKCOIN: 'J3rYdme789g1zAysfbH9oP4zjagvfVM2PX7KJgFDpump',
  GIL: 'CyUgNnKPQLqFcheyGV8wmypnJqojA7NzsdJjTS4nUT2j',
  ANON: 'D25bi7oHQjqkVrzbfuM6k2gzVNHTSpBLhtakDCzCCDUB',
  WLFI: 'WLFinEv6ypjkczcS83FZqFpgFZYwQXutRbxGe7oC16g',
  USD1: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
  AOL: '2oQNkePakuPbHzrVVkQ875WHeewLHCd2cAwfwiLQbonk',
  IQLABS: '3uXACfojUrya7VH51jVC1DCHq3uzK4A7g469Q954LABS',
};

// Mint to token reverse mapping
const MINT_TO_TOKEN: Record<string, ShadowWireToken> = {};
// Build reverse mapping
for (const [token, mint] of Object.entries(TOKEN_MINTS)) {
  if (mint !== 'Native') {
    MINT_TO_TOKEN[mint] = token as ShadowWireToken;
  }
}
// Add SOL aliases
MINT_TO_TOKEN['So11111111111111111111111111111111111111112'] = 'SOL';
// Add devnet USDC
MINT_TO_TOKEN['Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'] = 'USDC';

/**
 * Configuration for the ShadowWire relayer client
 */
export interface ShadowWireConfig {
  /** Optional ShadowWire API key (for rate limit increases) */
  apiKey?: string;
  /** ShadowWire API base URL */
  apiUrl: string;
  /** Maximum retry attempts for failed transfers */
  maxRetries: number;
  /** Base delay between retries in milliseconds */
  retryDelayMs: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Crank keypair for signing (if needed) */
  crankKeypair?: Keypair;
}

/**
 * Parameters for executing a ShadowWire transfer
 */
export interface TransferParams {
  /** Sender's wallet address (base58) */
  sender: string;
  /** Recipient's wallet address (base58) */
  recipient: string;
  /** Amount in smallest units (lamports for SOL, micro-units for USDC) */
  amount: bigint;
  /** Token to transfer */
  token: ShadowWireToken;
  /** Transfer type: internal (hidden amount) or external (visible amount) */
  type: 'internal' | 'external';
}

/**
 * Result of a ShadowWire transfer
 */
export interface TransferResult {
  /** Whether the transfer succeeded */
  success: boolean;
  /** ShadowWire transfer ID (tx signature or proof PDA) */
  transferId: string;
  /** Transaction signature on Solana */
  txSignature?: string;
  /** Whether the amount was hidden */
  amountHidden: boolean;
  /** Proof PDA address */
  proofPda?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * ShadowWire pool balance
 */
export interface PoolBalance {
  /** Wallet address */
  wallet: string;
  /** Available balance (can be transferred) */
  available: number;
  /** Total deposited */
  deposited: number;
  /** Amount withdrawn to escrow */
  withdrawnToEscrow: number;
  /** Pool address */
  poolAddress: string;
  /** Whether balance has been migrated */
  migrated: boolean;
}

/**
 * ShadowWire API error response
 */
interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Upload proof response
 */
interface UploadProofResponse {
  success: boolean;
  proof_pda: string;
  nonce: number;
}

/**
 * Internal transfer response
 */
interface InternalTransferResponse {
  success: boolean;
  tx_signature: string;
  proof_pda: string;
}

/**
 * External transfer response
 */
interface ExternalTransferResponse {
  success: boolean;
  tx_signature: string;
  amount_sent: number;
  proof_pda: string;
}

/**
 * ShadowWire Relayer Client
 *
 * Provides methods for executing private transfers via the ShadowWire API.
 * This is used by the backend settlement executor to move funds between
 * users without revealing amounts on-chain.
 */
export class ShadowWireRelayerClient {
  private config: ShadowWireConfig;

  constructor(config: ShadowWireConfig) {
    this.config = config;
  }

  /**
   * Execute a private transfer via ShadowWire
   *
   * For settlement, we use 'internal' transfers which hide the amount
   * using Bulletproof range proofs.
   *
   * Flow:
   * 1. Upload proof to get nonce
   * 2. Execute internal transfer with nonce
   *
   * @param params - Transfer parameters
   * @returns Transfer result with ID for on-chain recording
   */
  async executeTransfer(params: TransferParams): Promise<TransferResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const result = await this.doTransfer(params);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.log(`Transfer attempt ${attempt + 1} failed: ${lastError.message}`);

        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await this.delay(delay);
        }
      }
    }

    return {
      success: false,
      transferId: '',
      amountHidden: params.type === 'internal',
      error: lastError?.message || 'Unknown error after retries',
    };
  }

  /**
   * Get pool balance for a wallet
   *
   * @param owner - Wallet address
   * @param token - Token to check (optional, defaults to SOL)
   * @returns Pool balance or null if not found
   */
  async getPoolBalance(
    owner: string | PublicKey,
    token?: ShadowWireToken
  ): Promise<PoolBalance | null> {
    const ownerStr = typeof owner === 'string' ? owner : owner.toBase58();

    try {
      let url = `/pool/balance/${ownerStr}`;
      if (token && token !== 'SOL') {
        const tokenMint = TOKEN_MINTS[token];
        if (tokenMint !== 'Native') {
          url += `?token_mint=${tokenMint}`;
        }
      }

      const response = await this.apiRequest<{
        wallet: string;
        available: number;
        deposited: number;
        withdrawn_to_escrow: number;
        migrated: boolean;
        pool_address: string;
      }>('GET', url);

      return {
        wallet: response.wallet,
        available: response.available,
        deposited: response.deposited,
        withdrawnToEscrow: response.withdrawn_to_escrow,
        poolAddress: response.pool_address,
        migrated: response.migrated,
      };
    } catch (error) {
      this.log(`Failed to get balance: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Check if a wallet has sufficient balance for a transfer
   *
   * @param owner - Wallet address
   * @param token - Token to check
   * @param amount - Required amount in smallest units
   * @returns true if balance is sufficient
   */
  async hasEnoughBalance(
    owner: string | PublicKey,
    token: ShadowWireToken,
    amount: bigint
  ): Promise<boolean> {
    const balance = await this.getPoolBalance(owner, token);
    if (!balance) return false;
    return BigInt(Math.floor(balance.available)) >= amount;
  }

  /**
   * Calculate net amount after ShadowWire fee
   */
  calculateNetAmount(grossAmount: bigint): bigint {
    const fee = (grossAmount * BigInt(SHADOWWIRE_FEE_BPS)) / BigInt(10000);
    return grossAmount - fee;
  }

  /**
   * Calculate gross amount needed to receive a specific net amount
   */
  calculateGrossAmount(netAmount: bigint): bigint {
    return (netAmount * BigInt(10000)) / BigInt(10000 - SHADOWWIRE_FEE_BPS);
  }

  /**
   * Convert a mint address to ShadowWire token symbol
   */
  static tokenFromMint(mint: string | PublicKey): ShadowWireToken | null {
    const mintStr = typeof mint === 'string' ? mint : mint.toBase58();
    return MINT_TO_TOKEN[mintStr] || null;
  }

  /**
   * Check if a mint is supported by ShadowWire
   */
  static isMintSupported(mint: string | PublicKey): boolean {
    return ShadowWireRelayerClient.tokenFromMint(mint) !== null;
  }

  /**
   * Convert amount to smallest units for a token
   */
  static toSmallestUnit(amount: number, token: ShadowWireToken): number {
    const decimals = TOKEN_DECIMALS[token];
    return Math.floor(amount * Math.pow(10, decimals));
  }

  /**
   * Convert amount from smallest units for a token
   */
  static fromSmallestUnit(amount: number | bigint, token: ShadowWireToken): number {
    const decimals = TOKEN_DECIMALS[token];
    return Number(amount) / Math.pow(10, decimals);
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async doTransfer(params: TransferParams): Promise<TransferResult> {
    const amountNum = Number(params.amount);
    const relayerFee = Math.floor(amountNum * 0.01);

    this.log(`Executing ${params.type} transfer:`);
    this.log(`  Sender: ${params.sender}`);
    this.log(`  Recipient: ${params.recipient}`);
    this.log(`  Token: ${params.token}`);
    this.log(`  Amount: ${params.amount.toString()}`);
    this.log(`  Fee: ${relayerFee}`);

    // Get token mint
    const tokenMint = TOKEN_MINTS[params.token];
    const token = tokenMint === 'Native' ? 'SOL' : tokenMint;

    // Generate a random nonce
    const nonce = Math.floor(Math.random() * 1000000000);

    // Step 1: Upload proof
    this.log('Step 1: Uploading proof...');
    const proofResult = await this.apiRequest<UploadProofResponse>(
      'POST',
      '/zk/upload-proof',
      {
        sender_wallet: params.sender,
        token: token,
        amount: amountNum,
        nonce: nonce,
      }
    );

    if (!proofResult.success) {
      throw new Error('Failed to upload proof');
    }

    this.log(`  Proof PDA: ${proofResult.proof_pda}`);
    this.log(`  Nonce: ${proofResult.nonce}`);

    // Step 2: Execute transfer
    if (params.type === 'internal') {
      this.log('Step 2: Executing internal transfer...');
      const transferResult = await this.apiRequest<InternalTransferResponse>(
        'POST',
        '/zk/internal-transfer',
        {
          sender_wallet: params.sender,
          recipient_wallet: params.recipient,
          token: token,
          nonce: proofResult.nonce,
          relayer_fee: relayerFee,
        }
      );

      this.log(`Transfer complete: ${transferResult.tx_signature}`);

      return {
        success: transferResult.success,
        transferId: transferResult.proof_pda || transferResult.tx_signature,
        txSignature: transferResult.tx_signature,
        amountHidden: true,
        proofPda: transferResult.proof_pda,
      };
    } else {
      // External transfer (visible amount)
      this.log('Step 2: Executing external transfer...');
      const transferResult = await this.apiRequest<ExternalTransferResponse>(
        'POST',
        '/zk/external-transfer',
        {
          sender_wallet: params.sender,
          recipient_wallet: params.recipient,
          token: token,
          nonce: proofResult.nonce,
          relayer_fee: relayerFee,
        }
      );

      this.log(`Transfer complete: ${transferResult.tx_signature}`);

      return {
        success: transferResult.success,
        transferId: transferResult.proof_pda || transferResult.tx_signature,
        txSignature: transferResult.tx_signature,
        amountHidden: false,
        proofPda: transferResult.proof_pda,
      };
    }
  }

  private async apiRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add API key if provided (for rate limit increases)
      if (this.config.apiKey) {
        headers['X-API-Key'] = this.config.apiKey;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = await response.json() as ApiErrorResponse;
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMessage);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[ShadowWire] ${message}`);
    }
  }
}

/**
 * Create a ShadowWire relayer client from environment variables
 */
export function createRelayerClientFromEnv(crankKeypair?: Keypair): ShadowWireRelayerClient {
  const config: ShadowWireConfig = {
    // API key is optional for ShadowWire
    apiKey: process.env.SHADOWWIRE_API_KEY || undefined,
    // Use the correct ShadowWire/ShadowPay API URL
    apiUrl: process.env.SHADOWWIRE_API_URL || 'https://shadow.radr.fun/shadowpay/api',
    maxRetries: parseInt(process.env.SHADOWWIRE_MAX_RETRIES || '3', 10),
    retryDelayMs: parseInt(process.env.SHADOWWIRE_RETRY_DELAY_MS || '1000', 10),
    timeoutMs: parseInt(process.env.SHADOWWIRE_TIMEOUT_MS || '30000', 10),
    debug: process.env.SHADOWWIRE_DEBUG === 'true',
    crankKeypair,
  };

  return new ShadowWireRelayerClient(config);
}

/**
 * Default export for convenience
 */
export default ShadowWireRelayerClient;
