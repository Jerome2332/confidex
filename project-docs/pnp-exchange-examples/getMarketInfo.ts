/**
 * Devnet Script: Get Market Information
 * 
 * Fetches comprehensive info about a market including settlement criteria.
 * 
 * Usage:
 *   DEVNET_MARKET=<market_address> tsx scripts/devnet/getMarketInfo.ts
 * 
 * Environment Variables:
 *   DEVNET_MARKET - Market address to query
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

// Private key optional for read-only operations
const PRIVATE_KEY = process.env.DEVNET_PRIVATE_KEY || process.env.TEST_PRIVATE_KEY;

const MARKET_ADDRESS = process.env.DEVNET_MARKET;
if (!MARKET_ADDRESS) {
  console.error('❌ DEVNET_MARKET environment variable is required');
  console.log('\nUsage:');
  console.log('  DEVNET_MARKET=<address> tsx scripts/devnet/getMarketInfo.ts');
  process.exit(1);
}

// =====================================================

async function main() {
  console.log('\n🧪 PNP SDK - Devnet Market Info\n');
  console.log('═'.repeat(50));

  // Can work with or without private key
  const client = PRIVATE_KEY 
    ? new PNPClient(RPC_URL, PNPClient.parseSecretKey(PRIVATE_KEY))
    : new PNPClient(RPC_URL);

  if (!client.client.isDevnet) {
    throw new Error('Expected devnet but detected mainnet.');
  }

  console.log('✓ Connected to DEVNET');
  console.log(`  Program ID: ${client.client.programId.toBase58()}`);

  const market = new PublicKey(MARKET_ADDRESS);

  console.log('\n📊 Fetching market data...');
  console.log(`  Market: ${MARKET_ADDRESS}`);

  // Try to fetch as V2 market first
  let marketData: any = null;
  let marketType = 'unknown';

  try {
    const v2Info = await client.fetchMarket(market);
    marketData = v2Info.account;
    marketType = 'V2 AMM';
    console.log('  Type: V2 AMM Market');
  } catch {
    // Try V3 market
    try {
      const v3Info = await client.getP2PMarketInfo(market);
      marketData = v3Info;
      marketType = 'V3 P2P';
      console.log('  Type: V3 P2P Market');
    } catch (e: unknown) {
      console.error('  Could not fetch market data:', e instanceof Error ? e.message : String(e));
    }
  }

  // Fetch settlement criteria (devnet mock)
  console.log('\n📋 Settlement Criteria:');
  const criteria = await client.fetchSettlementCriteria(market);
  console.log(`  Category: ${criteria.category}`);
  console.log(`  Resolvable: ${criteria.resolvable}`);
  console.log(`  Reasoning: ${criteria.reasoning}`);

  // Fetch settlement data
  console.log('\n🎯 Settlement Data:');
  const settlement = await client.fetchSettlementData(market);
  console.log(`  Answer: ${settlement.answer}`);
  console.log(`  Description: ${settlement.settlement_description || settlement.reasoning}`);

  // Compile output
  const output: Record<string, any> = {
    network: 'devnet',
    market: MARKET_ADDRESS,
    marketType,
    explorerUrl: `https://explorer.solana.com/address/${MARKET_ADDRESS}?cluster=devnet`,
    settlementCriteria: criteria,
    settlementData: settlement,
  };

  if (marketData) {
    if (marketType === 'V2 AMM') {
      output.marketInfo = {
        question: marketData.question,
        creator: marketData.creator?.toString?.() || marketData.creator,
        resolved: marketData.resolved,
        resolvable: marketData.resolvable,
        endTime: marketData.end_time ? new Date(Number(marketData.end_time) * 1000).toISOString() : null,
        yesTokenMint: marketData.yes_token_mint?.toString?.() || marketData.yes_token_mint,
        noTokenMint: marketData.no_token_mint?.toString?.() || marketData.no_token_mint,
        collateralMint: marketData.collateral_token?.toString?.() || marketData.collateral_token,
      };
    } else if (marketType === 'V3 P2P') {
      output.marketInfo = {
        question: marketData.question,
        yesMint: marketData.yesMint,
        noMint: marketData.noMint,
        yesReserve: marketData.yesReserve,
        noReserve: marketData.noReserve,
        collateralMint: marketData.collateralMint,
        endTime: marketData.endTime?.toISOString?.() || marketData.endTime,
      };
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log('📄 FULL MARKET INFO');
  console.log('═'.repeat(50));
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});