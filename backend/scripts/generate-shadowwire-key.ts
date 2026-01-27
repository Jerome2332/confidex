/**
 * Generate a ShadowWire API key for the crank wallet
 *
 * ShadowWire uses the ShadowPay API infrastructure.
 * API keys are optional but provide higher rate limits (10 RPS vs default).
 *
 * Usage:
 *   npx tsx scripts/generate-shadowwire-key.ts
 *
 * The script will:
 * 1. Load the crank wallet from CRANK_WALLET_PATH or CRANK_WALLET_SECRET_KEY
 * 2. Request a new API key from ShadowPay
 * 3. Print the key for you to add to .env
 */

import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: path.join(import.meta.dirname, '..', '.env') });

const SHADOWPAY_API_BASE = 'https://shadow.radr.fun/shadowpay';

interface KeyResponse {
  api_key: string;
  wallet_address: string;
  created_at?: string;
}

interface ErrorResponse {
  error: string;
  message?: string;
}

function loadCrankWallet(): Keypair {
  // First try environment variable (takes priority)
  const secretKeyEnv = process.env.CRANK_WALLET_SECRET_KEY;
  if (secretKeyEnv) {
    try {
      const secretKey = JSON.parse(secretKeyEnv);
      console.log('Loaded crank wallet from CRANK_WALLET_SECRET_KEY');
      return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch (e) {
      console.error('Failed to parse CRANK_WALLET_SECRET_KEY:', e);
    }
  }

  // Fall back to file path
  const walletPath = process.env.CRANK_WALLET_PATH || './keys/crank-wallet.json';
  const fullPath = path.resolve(import.meta.dirname, '..', walletPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Crank wallet not found at ${fullPath}`);
  }

  const secretKey = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  console.log('Loaded crank wallet from', fullPath);
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function generateApiKey(walletAddress: string): Promise<KeyResponse> {
  const url = `${SHADOWPAY_API_BASE}/v1/keys/new`;

  console.log(`\nRequesting API key for wallet: ${walletAddress}`);
  console.log(`POST ${url}\n`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wallet_address: walletAddress,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as ErrorResponse;
    throw new Error(`API request failed: ${error.error || error.message || JSON.stringify(data)}`);
  }

  return data as KeyResponse;
}

async function checkExistingKey(walletAddress: string): Promise<KeyResponse | null> {
  const url = `${SHADOWPAY_API_BASE}/v1/keys/by-wallet/${walletAddress}`;

  console.log(`Checking for existing key...`);
  console.log(`GET ${url}\n`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.json();
      console.warn(`Warning: Could not check existing key: ${error.error || response.statusText}`);
      return null;
    }

    return await response.json();
  } catch (e) {
    console.warn(`Warning: Could not check existing key: ${e}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('ShadowWire API Key Generator');
  console.log('='.repeat(60));

  // Load the crank wallet
  const wallet = loadCrankWallet();
  const walletAddress = wallet.publicKey.toBase58();

  console.log(`\nCrank wallet address: ${walletAddress}`);

  // Check for existing key
  const existingKey = await checkExistingKey(walletAddress);

  if (existingKey?.api_key) {
    console.log('\n' + '='.repeat(60));
    console.log('EXISTING API KEY FOUND');
    console.log('='.repeat(60));
    console.log(`\nAPI Key: ${existingKey.api_key}`);
    console.log(`\nTo use this key, add to your .env file:`);
    console.log(`\n  SHADOWWIRE_API_KEY=${existingKey.api_key}`);
    return;
  }

  // Generate new key
  console.log('\nNo existing key found. Generating new API key...\n');

  try {
    const result = await generateApiKey(walletAddress);

    console.log('='.repeat(60));
    console.log('SUCCESS - API KEY GENERATED');
    console.log('='.repeat(60));
    console.log(`\nAPI Key: ${result.api_key}`);
    console.log(`Wallet: ${result.wallet_address}`);

    if (result.created_at) {
      console.log(`Created: ${result.created_at}`);
    }

    console.log('\n' + '-'.repeat(60));
    console.log('Add this to your backend/.env file:');
    console.log('-'.repeat(60));
    console.log(`\nSHADOWWIRE_API_KEY=${result.api_key}`);
    console.log('\n' + '='.repeat(60));
  } catch (error) {
    console.error('\nFailed to generate API key:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
