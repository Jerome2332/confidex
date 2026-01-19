/**
 * Devnet Script: Trade on a Market
 * 
 * Buy YES or NO tokens on an existing devnet market.
 * 
 * Usage:
 *   DEVNET_MARKET=<market_address> tsx scripts/devnet/trade.ts
 * 
 * Environment Variables:
 *   DEVNET_PRIVATE_KEY - Your wallet private key
 *   DEVNET_MARKET - Market address to trade on
 *   DEVNET_SIDE - 'yes' or 'no' (default: yes)
 *   DEVNET_AMOUNT - Amount in UI units (default: 1)
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
  console.log('  DEVNET_MARKET=<address> tsx scripts/devnet/trade.ts');
  process.exit(1);
}

const SIDE = (process.env.DEVNET_SIDE || 'yes').toLowerCase();
const AMOUNT = Number(process.env.DEVNET_AMOUNT || '1');

if (SIDE !== 'yes' && SIDE !== 'no') {
  console.error("❌ DEVNET_SIDE must be 'yes' or 'no'");
  process.exit(1);
}

// =====================================================

async function main() {
  console.log('\n🧪 PNP SDK - Devnet Trading\n');
  console.log('═'.repeat(50));

  const secretKey = PNPClient.parseSecretKey(PRIVATE_KEY);
  const client = new PNPClient(RPC_URL, secretKey);

  if (!client.client.isDevnet) {
    throw new Error('Expected devnet but detected mainnet.');
  }

  console.log('✓ Connected to DEVNET');

  const market = new PublicKey(MARKET_ADDRESS);

  console.log('\n📋 Trade Configuration:');
  console.log(`  Market: ${MARKET_ADDRESS}`);
  console.log(`  Side: ${SIDE.toUpperCase()}`);
  console.log(`  Amount: ${AMOUNT}`);
  console.log(`  Wallet: ${client.signer!.publicKey.toBase58()}`);

  // Get market info first
  console.log('\n📊 Fetching market info...');
  try {
    const marketInfo = await client.trading!.getMarketInfo(market);
    console.log(`  Question: ${marketInfo.question}`);
    console.log(`  Resolved: ${marketInfo.resolved}`);
    console.log(`  End Time: ${new Date(Number(marketInfo.endTime) * 1000).toISOString()}`);
    
    if (marketInfo.resolved) {
      console.error('\n❌ Market is already resolved. Cannot trade.');
      process.exit(1);
    }
  } catch (err: unknown) {
    console.log('  Could not fetch market info (may be V3 market)');
  }

  // Execute trade
  console.log('\n🚀 Executing trade...');
  try {
    const tradeResult = await client.trading!.buyTokensUsdc({
      market,
      buyYesToken: SIDE === 'yes',
      amountUsdc: AMOUNT,
    });

    console.log('⏳ Confirming transaction...');
    await client.client.connection.confirmTransaction(tradeResult.signature, 'confirmed');

    const output = {
      success: true,
      network: 'devnet',
      signature: tradeResult.signature,
      market: MARKET_ADDRESS,
      side: SIDE.toUpperCase(),
      amount: AMOUNT,
      tokensReceived: tradeResult.tokensReceived,
      explorerUrl: `https://explorer.solana.com/tx/${tradeResult.signature}?cluster=devnet`
    };

    console.log('\n' + '═'.repeat(50));
    console.log('✅ TRADE SUCCESSFUL!');
    console.log('═'.repeat(50));
    console.log(JSON.stringify(output, null, 2));

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    
    // Try V3 trading if V2 fails
    console.log('\n🔄 Trying V3 market trading...');
    try {
      const tradeResult = await client.buyV3TokensUsdc({
        market,
        buyYesToken: SIDE === 'yes',
        amountUsdc: AMOUNT,
      });

      await client.client.connection.confirmTransaction(tradeResult.signature, 'confirmed');

      console.log('\n' + '═'.repeat(50));
      console.log('✅ V3 TRADE SUCCESSFUL!');
      console.log('═'.repeat(50));
      console.log(JSON.stringify({
        success: true,
        network: 'devnet',
        marketType: 'V3',
        signature: tradeResult.signature,
        market: MARKET_ADDRESS,
        side: SIDE.toUpperCase(),
        amount: AMOUNT,
        explorerUrl: `https://explorer.solana.com/tx/${tradeResult.signature}?cluster=devnet`
      }, null, 2));
      return;

    } catch (v3Err: unknown) {
      console.error('\n❌ Both V2 and V3 trading failed');
      console.error('V2 Error:', msg);
      console.error('V3 Error:', v3Err instanceof Error ? v3Err.message : String(v3Err));
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});