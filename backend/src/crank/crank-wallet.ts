/**
 * Crank Wallet Management
 *
 * Handles loading and monitoring the crank wallet keypair.
 * The crank wallet pays for match transaction fees.
 *
 * Supports loading from:
 * 1. CRANK_WALLET_SECRET_KEY env var (JSON array of bytes) - recommended for production
 * 2. File path (for local development)
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

export class CrankWallet {
  private keypair: Keypair | null = null;
  private connection: Connection;
  private minBalance: number;
  private walletPath: string;

  constructor(connection: Connection, walletPath: string, minBalance: number = 0.1) {
    this.connection = connection;
    this.walletPath = walletPath;
    this.minBalance = minBalance;
  }

  /**
   * Load the crank wallet keypair from environment variable or file.
   * Priority:
   * 1. CRANK_WALLET_SECRET_KEY env var (JSON array or base58 string)
   * 2. File at walletPath
   */
  async load(): Promise<void> {
    const secretKeyEnv = process.env.CRANK_WALLET_SECRET_KEY;

    if (secretKeyEnv) {
      try {
        this.keypair = this.parseSecretKey(secretKeyEnv);
        console.log(`[CrankWallet] Loaded wallet from env: ${this.keypair.publicKey.toString()}`);
        return;
      } catch (error) {
        throw new Error(`Failed to parse CRANK_WALLET_SECRET_KEY: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Fall back to file-based loading
    const resolvedPath = path.resolve(this.walletPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Crank wallet not found. Either set CRANK_WALLET_SECRET_KEY env var ` +
        `or provide wallet file at: ${resolvedPath}`
      );
    }

    try {
      const keypairData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      console.log(`[CrankWallet] Loaded wallet from file: ${this.keypair.publicKey.toString()}`);
    } catch (error) {
      throw new Error(`Failed to load crank wallet from file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse a secret key from string (JSON array or base58)
   */
  private parseSecretKey(secretKey: string): Keypair {
    const trimmed = secretKey.trim();

    // Try JSON array format first: [1,2,3,...] (64 bytes)
    if (trimmed.startsWith('[')) {
      const bytes = JSON.parse(trimmed);
      if (!Array.isArray(bytes) || bytes.length !== 64) {
        throw new Error('JSON secret key must be an array of 64 bytes');
      }
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    }

    // Try base58 format
    try {
      const decoded = bs58.decode(trimmed);
      if (decoded.length !== 64) {
        throw new Error(`Base58 secret key decoded to ${decoded.length} bytes, expected 64`);
      }
      return Keypair.fromSecretKey(decoded);
    } catch (e) {
      throw new Error(`Invalid secret key format. Expected JSON array [1,2,3,...] or base58 string. Error: ${e}`);
    }
  }

  /**
   * Get the keypair (throws if not loaded)
   */
  getKeypair(): Keypair {
    if (!this.keypair) {
      throw new Error('Crank wallet not loaded. Call load() first.');
    }
    return this.keypair;
  }

  /**
   * Get the public key (throws if not loaded)
   */
  getPublicKey() {
    return this.getKeypair().publicKey;
  }

  /**
   * Get the current SOL balance
   */
  async getBalance(): Promise<number> {
    if (!this.keypair) {
      throw new Error('Crank wallet not loaded');
    }

    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Check if balance is sufficient
   */
  async checkBalance(): Promise<{ sufficient: boolean; balance: number; minRequired: number }> {
    const balance = await this.getBalance();
    return {
      sufficient: balance >= this.minBalance,
      balance,
      minRequired: this.minBalance,
    };
  }

  /**
   * Log balance status and return whether it's low
   */
  async logBalanceStatus(): Promise<boolean> {
    const { sufficient, balance, minRequired } = await this.checkBalance();

    if (!sufficient) {
      console.warn(`[CrankWallet] LOW BALANCE: ${balance.toFixed(4)} SOL (min: ${minRequired} SOL)`);
      console.warn(`[CrankWallet] Fund wallet: ${this.keypair?.publicKey.toString()}`);
      return true;
    }

    console.log(`[CrankWallet] Balance: ${balance.toFixed(4)} SOL`);
    return false;
  }
}

/**
 * Generate a new crank wallet keypair and save to file
 */
export async function generateCrankWallet(outputPath: string): Promise<Keypair> {
  const resolvedPath = path.resolve(outputPath);
  const dir = path.dirname(resolvedPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Check if file already exists
  if (fs.existsSync(resolvedPath)) {
    throw new Error(`Wallet already exists at: ${resolvedPath}`);
  }

  // Generate new keypair
  const keypair = Keypair.generate();

  // Save to file
  fs.writeFileSync(resolvedPath, JSON.stringify(Array.from(keypair.secretKey)));

  console.log(`[CrankWallet] Generated new wallet: ${keypair.publicKey.toString()}`);
  console.log(`[CrankWallet] Saved to: ${resolvedPath}`);

  return keypair;
}
