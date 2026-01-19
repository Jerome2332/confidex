/**
 * Devnet Script: Create V3 P2P Market
 * 
 * Creates a peer-to-peer prediction market on Solana devnet.
 * You pick a side (YES/NO) and others can take the opposite side.
 * All devnet markets auto-resolve to YES at end time for testing.
 * 
 * Usage:
 *   tsx scripts/devnet/createP2PMarket.ts
 * 
 * Environment Variables:
 *   DEVNET_PRIVATE_KEY - Your wallet private key (base58 or JSON array)
 *   DEVNET_COLLATERAL_MINT - (Optional) Token mint for collateral
 *   DEVNET_SIDE - (Optional) 'yes' or 'no' (default: yes)
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

const PRIVATE_KEY = process.env.DEVNET_PRIVATE_KEY || process.env.TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌ Private key not found (DEVNET_PRIVATE_KEY or TEST_PRIVATE_KEY)');
  process.exit(1);
}

// Default devnet USDC
const DEFAULT_DEVNET_USDC = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const COLLATERAL_MINT = new PublicKey(
  process.env.DEVNET_COLLATERAL_MINT || DEFAULT_DEVNET_USDC
);

// ========== P2P MARKET PARAMETERS ===================

const QUESTION = process.env.DEVNET_QUESTION || 
  'P2P Test: Will this resolve YES? (All devnet markets resolve YES!)';

const SIDE: 'yes' | 'no' = 
  (process.env.DEVNET_SIDE || 'yes').toLowerCase() === 'no' ? 'no' : 'yes';

// Amount in raw units (6 decimals for most tokens)
const INITIAL_AMOUNT = BigInt(process.env.DEVNET_AMOUNT || '1000000'); // 1 token

// Creator side cap (max you can bet on your side)
const CREATOR_SIDE_CAP = INITIAL_AMOUNT * 5n;

const DAYS_UNTIL_END = Number(process.env.DEVNET_DAYS_UNTIL_END || '7');
const END_TIME = BigInt(Math.floor(Date.now() / 1000) + DAYS_UNTIL_END * 24 * 60 * 60);

// =====================================================

async function main() {
  console.log('\n🧪 PNP SDK - Devnet P2P Market Creation\n');
  console.log('═'.repeat(50));

  const secretKey = PNPClient.parseSecretKey(PRIVATE_KEY);
  const client = new PNPClient(RPC_URL, secretKey);

  if (!client.client.isDevnet) {
    throw new Error('Expected devnet but detected mainnet.');
  }

  console.log('✓ Connected to DEVNET');
  console.log(`  Program ID: ${client.client.programId.toBase58()}`);

  if (!client.anchorMarketV3) {
    throw new Error('AnchorMarketV3Module not available.');
  }

  const walletPubkey = client.signer!.publicKey;
  const tokenAta = getAssociatedTokenAddressSync(COLLATERAL_MINT, walletPubkey);

  console.log('\n📋 P2P Market Configuration:');
  console.log(`  Wallet: ${walletPubkey.toBase58()}`);
  console.log(`  Question: ${QUESTION}`);
  console.log(`  Your Side: ${SIDE.toUpperCase()}`);
  console.log(`  Initial Amount: ${INITIAL_AMOUNT.toString()} (raw units)`);
  console.log(`  Creator Side Cap: ${CREATOR_SIDE_CAP.toString()} (raw units)`);
  console.log(`  Collateral Mint: ${COLLATERAL_MINT.toBase58()}`);
  console.log(`  End Time: ${new Date(Number(END_TIME) * 1000).toISOString()}`);

  // Check balance
  console.log('\n💰 Checking token balance...');
  try {
    const balance = await client.client.connection.getTokenAccountBalance(tokenAta);
    const balanceAmount = BigInt(balance.value.amount);
    console.log(`  Balance: ${balance.value.uiAmountString} (${balanceAmount} raw)`);
    
    if (balanceAmount < INITIAL_AMOUNT) {
      console.error(`\n❌ Insufficient balance!`);
      process.exit(1);
    }
    console.log('  ✓ Sufficient balance');
  } catch {
    console.error(`\n❌ Token account not found`);
    process.exit(1);
  }

  // Create P2P market
  console.log('\n🚀 Creating P2P market...');
  const result = await client.anchorMarketV3.createMarketV3({
    question: QUESTION,
    initialAmount: INITIAL_AMOUNT,
    side: SIDE,
    creatorSideCap: CREATOR_SIDE_CAP,
    endTime: END_TIME,
    collateralTokenMint: COLLATERAL_MINT,
  });

  console.log('⏳ Confirming transaction...');
  await client.client.connection.confirmTransaction(result.signature, 'confirmed');

  // Output
  const output = {
    success: true,
    network: 'devnet',
    marketType: 'V3 P2P',
    market: result.market.toBase58(),
    yesTokenMint: result.yesTokenMint.toBase58(),
    noTokenMint: result.noTokenMint.toBase58(),
    signature: result.signature,
    yourSide: SIDE.toUpperCase(),
    question: QUESTION,
    explorerUrl: `https://explorer.solana.com/address/${result.market.toBase58()}?cluster=devnet`,
  };

  console.log('\n' + '═'.repeat(50));
  console.log('✅ P2P MARKET CREATED!');
  console.log('═'.repeat(50));
  console.log(JSON.stringify(output, null, 2));

  console.log('\n📝 Next Steps:');
  console.log(`  1. Others can trade the opposite side on your market`);
  console.log(`  2. Market will auto-resolve to YES at end time`);
  console.log(`  3. Redeem: DEVNET_MARKET=${result.market.toBase58()} tsx scripts/devnet/redeemPosition.ts`);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});