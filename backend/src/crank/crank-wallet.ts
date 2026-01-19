/**
 * Crank Wallet Management
 *
 * Handles loading and monitoring the crank wallet keypair.
 * The crank wallet pays for match transaction fees.
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
   * Load the crank wallet keypair from file
   */
  async load(): Promise<void> {
    const resolvedPath = path.resolve(this.walletPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Crank wallet not found at: ${resolvedPath}`);
    }

    try {
      const keypairData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      console.log(`[CrankWallet] Loaded wallet: ${this.keypair.publicKey.toString()}`);
    } catch (error) {
      throw new Error(`Failed to load crank wallet: ${error instanceof Error ? error.message : String(error)}`);
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
