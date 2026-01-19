/**
 * Devnet Script: Create V2 AMM Market
 * 
 * Creates a prediction market on Solana devnet using any SPL token as collateral.
 * All devnet markets auto-resolve to YES at end time for testing.
 * 
 * Usage:
 *   tsx scripts/devnet/createMarket.ts
 * 
 * Environment Variables:
 *   DEVNET_PRIVATE_KEY - Your wallet private key (base58 or JSON array)
 *   DEVNET_COLLATERAL_MINT - (Optional) Token mint for collateral
 */

import { createRequire } from 'module';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(import.meta.dirname, '../../.env') });

const require = createRequire(import.meta.url);
const { PNPClient } = require('../../dist/index.cjs');

// =====================================================
// ========== DEVNET CONFIGURATION ====================
// =====================================================

const RPC_URL = 'https://api.devnet.solana.com';

// Get private key from env (check both DEVNET_PRIVATE_KEY and TEST_PRIVATE_KEY)
const PRIVATE_KEY = process.env.DEVNET_PRIVATE_KEY || process.env.TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌ Private key not found in environment');
  console.log('\nSet it in your .env file:');
  console.log('  DEVNET_PRIVATE_KEY=your_base58_private_key_here');
  console.log('  or');
  console.log('  TEST_PRIVATE_KEY=your_base58_private_key_here');
  process.exit(1);
}

// Default to devnet USDC if no collateral mint specified
// You can use any SPL token that exists on devnet
const DEFAULT_DEVNET_USDC = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'; // Circle's devnet USDC
const COLLATERAL_MINT = new PublicKey(
  process.env.DEVNET_COLLATERAL_MINT || DEFAULT_DEVNET_USDC
);

// ========== MARKET PARAMETERS =======================
// Customize these as needed

const QUESTION = process.env.DEVNET_QUESTION || 
  'Will this test market resolve to YES? (Spoiler: Yes, all devnet markets do!)';

const INITIAL_LIQUIDITY = BigInt(
  process.env.DEVNET_INITIAL_LIQUIDITY || '1000000' // 1 token with 6 decimals
);

const DAYS_UNTIL_END = Number(process.env.DEVNET_DAYS_UNTIL_END || '7');
const END_TIME = BigInt(Math.floor(Date.now() / 1000) + DAYS_UNTIL_END * 24 * 60 * 60);

// =====================================================

async function main() {
  console.log('\n🧪 PNP SDK - Devnet Market Creation\n');
  console.log('═'.repeat(50));

  const secretKey = PNPClient.parseSecretKey(PRIVATE_KEY);
  const client = new PNPClient(RPC_URL, secretKey);

  // Verify we're on devnet
  if (!client.client.isDevnet) {
    throw new Error('Expected devnet but detected mainnet. Check your RPC_URL.');
  }

  console.log('✓ Connected to DEVNET');
  console.log(`  Program ID: ${client.client.programId.toBase58()}`);

  if (!client.market) {
    throw new Error('Market module not available. Check your private key.');
  }

  const walletPubkey = client.signer!.publicKey;
  const tokenAta = getAssociatedTokenAddressSync(COLLATERAL_MINT, walletPubkey);

  console.log('\n📋 Market Configuration:');
  console.log(`  Wallet: ${walletPubkey.toBase58()}`);
  console.log(`  Question: ${QUESTION}`);
  console.log(`  Collateral Mint: ${COLLATERAL_MINT.toBase58()}`);
  console.log(`  Initial Liquidity: ${INITIAL_LIQUIDITY.toString()} (raw units)`);
  console.log(`  End Time: ${new Date(Number(END_TIME) * 1000).toISOString()}`);

  // Check balance
  console.log('\n💰 Checking token balance...');
  try {
    const balance = await client.client.connection.getTokenAccountBalance(tokenAta);
    const balanceAmount = BigInt(balance.value.amount);
    console.log(`  Balance: ${balance.value.uiAmountString} (${balanceAmount} raw)`);
    
    if (balanceAmount < INITIAL_LIQUIDITY) {
      console.error(`\n❌ Insufficient balance!`);
      console.log(`  Have: ${balance.value.uiAmountString}`);
      console.log(`  Need: ${Number(INITIAL_LIQUIDITY) / 1_000_000}`);
      console.log(`\n💡 Get devnet tokens from a faucet or airdrop.`);
      process.exit(1);
    }
    console.log('  ✓ Sufficient balance');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Token account not found: ${msg}`);
    console.log(`\n💡 Make sure you have ${COLLATERAL_MINT.toBase58()} tokens in your wallet.`);
    process.exit(1);
  }

  // Create market
  console.log('\n🚀 Creating market...');
  const createRes = await client.market.createMarket({
    question: QUESTION,
    initialLiquidity: INITIAL_LIQUIDITY,
    endTime: END_TIME,
    baseMint: COLLATERAL_MINT,
  });

  console.log('⏳ Confirming transaction...');
  await client.client.connection.confirmTransaction(createRes.signature, 'confirmed');

  // Get settlement criteria (will return devnet mock response)
  const criteria = await client.fetchSettlementCriteria(createRes.market);

  // Output result
  const result = {
    success: true,
    network: 'devnet',
    market: createRes.market.toBase58(),
    signature: createRes.signature,
    question: QUESTION,
    collateralMint: COLLATERAL_MINT.toBase58(),
    initialLiquidity: INITIAL_LIQUIDITY.toString(),
    endTime: new Date(Number(END_TIME) * 1000).toISOString(),
    settlementInfo: criteria.reasoning,
    explorerUrl: `https://explorer.solana.com/address/${createRes.market.toBase58()}?cluster=devnet`,
    txUrl: `https://explorer.solana.com/tx/${createRes.signature}?cluster=devnet`
  };

  console.log('\n' + '═'.repeat(50));
  console.log('✅ MARKET CREATED SUCCESSFULLY!');
  console.log('═'.repeat(50));
  console.log(JSON.stringify(result, null, 2));

  console.log('\n📝 Next Steps:');
  console.log(`  1. Trade on the market: DEVNET_MARKET=${createRes.market.toBase58()} tsx scripts/devnet/trade.ts`);
  console.log(`  2. Wait for end time or use force-resolve for testing`);
  console.log(`  3. Redeem your position: tsx scripts/devnet/redeemPosition.ts`);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message || err);
  if (err.logs) {
    console.error('Program logs:', err.logs);
  }
  process.exit(1);
});