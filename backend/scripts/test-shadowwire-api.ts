/**
 * Test ShadowWire API connectivity and endpoints
 *
 * Tests the following endpoints:
 * 1. Pool balance check (GET /pool/balance/{wallet})
 * 2. API key verification
 *
 * Usage:
 *   npx tsx scripts/test-shadowwire-api.ts
 */

import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: path.join(import.meta.dirname, '..', '.env') });

const SHADOWWIRE_API_BASE =
  process.env.SHADOWWIRE_API_URL || 'https://shadow.radr.fun/shadowpay/api';
const API_KEY = process.env.SHADOWWIRE_API_KEY;

interface PoolBalance {
  wallet: string;
  token?: string;
  balance: string;
  available: string;
  pending: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  data?: unknown;
}

function loadCrankWallet(): Keypair {
  const secretKeyEnv = process.env.CRANK_WALLET_SECRET_KEY;
  if (secretKeyEnv) {
    const secretKey = JSON.parse(secretKeyEnv);
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  const walletPath = process.env.CRANK_WALLET_PATH || './keys/crank-wallet.json';
  const fullPath = path.resolve(import.meta.dirname, '..', walletPath);
  const secretKey = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function makeRequest<T>(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const url = `${SHADOWWIRE_API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      data: data as T,
      error: !response.ok ? (data?.error || data?.message || response.statusText) : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String(e),
    };
  }
}

async function testApiKeyVerification(): Promise<TestResult> {
  // The ShadowPay API doesn't have a dedicated key verification endpoint,
  // but we can check if the key is used by making an authenticated request
  const name = 'API Key Configuration';

  if (!API_KEY) {
    return {
      name,
      passed: false,
      message: 'SHADOWWIRE_API_KEY not set in .env',
    };
  }

  return {
    name,
    passed: true,
    message: `API key configured: ${API_KEY.substring(0, 8)}...`,
  };
}

async function testPoolBalance(walletAddress: string): Promise<TestResult> {
  const name = 'Pool Balance (SOL)';

  const result = await makeRequest<PoolBalance>(
    'GET',
    `/pool/balance/${walletAddress}`
  );

  if (!result.ok) {
    // 404 is expected if user hasn't deposited yet
    if (result.status === 404) {
      return {
        name,
        passed: true,
        message: 'No balance found (wallet not yet deposited to ShadowWire pool)',
        data: { wallet: walletAddress, balance: '0' },
      };
    }

    return {
      name,
      passed: false,
      message: `Failed: ${result.error}`,
    };
  }

  return {
    name,
    passed: true,
    message: `Balance: ${result.data?.available || '0'} lamports available`,
    data: result.data,
  };
}

async function testPoolBalanceWithToken(
  walletAddress: string,
  token: string
): Promise<TestResult> {
  const name = `Pool Balance (${token})`;

  const result = await makeRequest<PoolBalance>(
    'GET',
    `/pool/balance/${walletAddress}?token=${token}`
  );

  if (!result.ok) {
    if (result.status === 404) {
      return {
        name,
        passed: true,
        message: `No ${token} balance found (not yet deposited)`,
        data: { wallet: walletAddress, token, balance: '0' },
      };
    }

    return {
      name,
      passed: false,
      message: `Failed: ${result.error}`,
    };
  }

  return {
    name,
    passed: true,
    message: `Balance: ${result.data?.available || '0'} smallest units available`,
    data: result.data,
  };
}

async function testApiConnectivity(): Promise<TestResult> {
  const name = 'API Connectivity';

  // Try to reach the API with a simple request
  // We'll use a balance check which should return 404 for unknown wallets
  const testWallet = 'So11111111111111111111111111111111111111112'; // System program

  const result = await makeRequest<unknown>('GET', `/pool/balance/${testWallet}`);

  if (result.status === 0) {
    return {
      name,
      passed: false,
      message: `Cannot reach API: ${result.error}`,
    };
  }

  // Any response (even 404) means the API is reachable
  return {
    name,
    passed: true,
    message: `API reachable at ${SHADOWWIRE_API_BASE} (status: ${result.status})`,
  };
}

function printResult(result: TestResult) {
  const icon = result.passed ? '✓' : '✗';
  const color = result.passed ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`${color}${icon}${reset} ${result.name}`);
  console.log(`  ${result.message}`);

  if (result.data && process.env.SHADOWWIRE_DEBUG === 'true') {
    console.log(`  Data: ${JSON.stringify(result.data, null, 2)}`);
  }

  console.log();
}

async function main() {
  console.log('='.repeat(60));
  console.log('ShadowWire API Test Suite');
  console.log('='.repeat(60));
  console.log(`\nAPI Base: ${SHADOWWIRE_API_BASE}`);
  console.log(`API Key: ${API_KEY ? `${API_KEY.substring(0, 8)}...` : 'NOT SET'}`);
  console.log();

  const wallet = loadCrankWallet();
  const walletAddress = wallet.publicKey.toBase58();
  console.log(`Test Wallet: ${walletAddress}\n`);

  console.log('-'.repeat(60));
  console.log('Running Tests...');
  console.log('-'.repeat(60) + '\n');

  const results: TestResult[] = [];

  // Test 1: API Connectivity
  results.push(await testApiConnectivity());
  printResult(results[results.length - 1]);

  // Test 2: API Key Configuration
  results.push(await testApiKeyVerification());
  printResult(results[results.length - 1]);

  // Test 3: Pool Balance (SOL)
  results.push(await testPoolBalance(walletAddress));
  printResult(results[results.length - 1]);

  // Test 4: Pool Balance (USDC)
  results.push(await testPoolBalanceWithToken(walletAddress, 'USDC'));
  printResult(results[results.length - 1]);

  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\nPassed: ${passed}/${total}`);

  if (passed === total) {
    console.log('\n\x1b[32mAll tests passed! ShadowWire API is ready.\x1b[0m\n');
  } else {
    console.log('\n\x1b[31mSome tests failed. Check the output above.\x1b[0m\n');
    process.exit(1);
  }

  // Additional info for setup
  console.log('-'.repeat(60));
  console.log('Next Steps');
  console.log('-'.repeat(60));
  console.log(`
To complete ShadowWire setup for the crank wallet:

1. The crank wallet (${walletAddress}) needs SOL/USDC
   deposited to its ShadowWire pool before it can execute settlements.

2. Deposits can be made via:
   - ShadowWire SDK: client.deposit({ wallet, amount, token })
   - Or via the frontend onboarding flow

3. For testing, you may want to deposit a small amount first:
   - 0.1 SOL for gas
   - 10 USDC for test settlements
`);
}

main().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
