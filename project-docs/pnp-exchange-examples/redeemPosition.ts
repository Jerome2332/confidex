/**
 * Devnet Script: Redeem Winning Position
 * 
 * Redeem your winning tokens after a market resolves.
 * On devnet, all markets auto-resolve to YES at end time.
 * 
 * Usage:
 *   DEVNET_MARKET=<market_address> tsx scripts/devnet/redeemPosition.ts
 * 
 * Environment Variables:
 *   DEVNET_PRIVATE_KEY - Your wallet private key
 *   DEVNET_MARKET - Market address to redeem from
 */

import { createRequire } from 'module';
import { PublicKey } from '@solana/web3.js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(import.meta.dirname, '../../.env') });

const require = createRequire(import.meta.url);
const { PNPClient } = require('../../dist/index.cjs');

// =====================================================
// ========== CONFIGURATION ===========================
// =====================================================

const RPC_URL = 'https://api.devnet.solana.com';

const PRIVATE_KEY = process.env.DEVNET_PRIVATE_KEY || process.env.TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌ Private key not found (DEVNET_PRIVATE_KEY or TEST_PRIVATE_KEY)');
  process.exit(1);
}

const MARKET_ADDRESS = process.env.DEVNET_MARKET;
if (!MARKET_ADDRESS) {
  console.error('❌ DEVNET_MARKET environment variable is required');
  console.log('\nUsage:');
  console.log('  DEVNET_MARKET=<address> tsx scripts/devnet/redeemPosition.ts');
  process.exit(1);
}

// =====================================================

async function main() {
  console.log('\n🧪 PNP SDK - Devnet Position Redemption\n');
  console.log('═'.repeat(50));

  const secretKey = PNPClient.parseSecretKey(PRIVATE_KEY);
  const client = new PNPClient(RPC_URL, secretKey);

  if (!client.client.isDevnet) {
    throw new Error('Expected devnet but detected mainnet.');
  }

  console.log('✓ Connected to DEVNET');

  const market = new PublicKey(MARKET_ADDRESS);

  console.log('\n📋 Redemption:');
  console.log(`  Market: ${MARKET_ADDRESS}`);
  console.log(`  Wallet: ${client.signer!.publicKey.toBase58()}`);

  // Get settlement info (devnet returns mock)
  console.log('\n📊 Checking settlement status...');
  const settlementData = await client.fetchSettlementData(market);
  console.log(`  Answer: ${settlementData.answer}`);
  console.log(`  Reasoning: ${settlementData.reasoning}`);

  // Try V3 redemption first (P2P markets), then fall back to V2
  console.log('\n🚀 Attempting redemption...');
  
  try {
    // Try V3 redemption first
    const result = await client.redeemV3Position(market);
    
    console.log('⏳ Confirming transaction...');
    await client.client.connection.confirmTransaction(result.signature, 'confirmed');

    console.log('\n' + '═'.repeat(50));
    console.log('✅ V3 POSITION REDEEMED!');
    console.log('═'.repeat(50));
    console.log(JSON.stringify({
      success: true,
      network: 'devnet',
      marketType: 'V3',
      signature: result.signature,
      market: MARKET_ADDRESS,
      winningOutcome: settlementData.answer,
      explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`
    }, null, 2));
    return;

  } catch (v3Err: unknown) {
    console.log('  V3 redemption failed, trying V2...');
    
    try {
      // Try V2 redemption
      const result = await client.redeemPosition(market);

      console.log('⏳ Confirming transaction...');
      await client.client.connection.confirmTransaction(result.signature, 'confirmed');

      console.log('\n' + '═'.repeat(50));
      console.log('✅ V2 POSITION REDEEMED!');
      console.log('═'.repeat(50));
      console.log(JSON.stringify({
        success: true,
        network: 'devnet',
        marketType: 'V2',
        signature: result.signature,
        market: MARKET_ADDRESS,
        winningOutcome: settlementData.answer,
        explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`
      }, null, 2));
      return;

    } catch (v2Err: unknown) {
      console.error('\n❌ Redemption failed');
      console.error('V3 Error:', v3Err instanceof Error ? v3Err.message : String(v3Err));
      console.error('V2 Error:', v2Err instanceof Error ? v2Err.message : String(v2Err));
      
      console.log('\n💡 Possible reasons:');
      console.log('  - Market is not yet resolved (wait for end time)');
      console.log('  - You don\'t hold any winning tokens');
      console.log('  - Already redeemed your position');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});