/**
 * Debug script: Fetch and display on-chain trading pair data
 * Run with: npx ts-node scripts/debug-pair.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';

const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

const PAIR_SEED = Buffer.from('pair');

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

function parseTradingPair(data: Buffer) {
  let offset = 8; // Skip discriminator

  const baseMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const quoteMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cBaseMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cQuoteMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cBaseVault = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cQuoteVault = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const minOrderSize = data.readBigUInt64LE(offset);
  offset += 8;

  const tickSize = data.readBigUInt64LE(offset);
  offset += 8;

  const active = data.readUInt8(offset) === 1;
  offset += 1;

  const openOrderCount = data.readBigUInt64LE(offset);
  offset += 8;

  const index = data.readBigUInt64LE(offset);
  offset += 8;

  const bump = data.readUInt8(offset);

  return {
    baseMint,
    quoteMint,
    cBaseMint,
    cQuoteMint,
    cBaseVault,
    cQuoteVault,
    minOrderSize,
    tickSize,
    active,
    openOrderCount,
    index,
    bump,
  };
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  console.log('=== Debug Trading Pair ===\n');

  console.log('Expected Mints (from constants):');
  console.log('  WSOL_MINT (baseMint):', WSOL_MINT.toString());
  console.log('  USDC_MINT (quoteMint):', USDC_MINT.toString());

  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);
  console.log('\nDerived Pair PDA:', pairPda.toString());

  const accountInfo = await connection.getAccountInfo(pairPda);
  if (!accountInfo) {
    console.log('\n❌ Trading pair NOT FOUND!');
    console.log('   The pair PDA does not exist on devnet.');
    console.log('   You may need to run initialization scripts.');
    return;
  }

  console.log('\n✅ Trading pair FOUND!');
  console.log('   Account size:', accountInfo.data.length, 'bytes');

  const pair = parseTradingPair(accountInfo.data);

  console.log('\nOn-Chain Data:');
  console.log('  baseMint:', pair.baseMint.toString());
  console.log('  quoteMint:', pair.quoteMint.toString());
  console.log('  cBaseMint:', pair.cBaseMint.toString());
  console.log('  cQuoteMint:', pair.cQuoteMint.toString());
  console.log('  cBaseVault:', pair.cBaseVault.toString());
  console.log('  cQuoteVault:', pair.cQuoteVault.toString());
  console.log('  minOrderSize:', pair.minOrderSize.toString());
  console.log('  tickSize:', pair.tickSize.toString());
  console.log('  active:', pair.active);
  console.log('  openOrderCount:', pair.openOrderCount.toString());
  console.log('  index:', pair.index.toString());
  console.log('  bump:', pair.bump);

  // Check if mints match
  console.log('\n=== Mint Comparison ===');
  const baseMatches = pair.baseMint.equals(WSOL_MINT);
  const quoteMatches = pair.quoteMint.equals(USDC_MINT);
  console.log('  baseMint matches WSOL_MINT:', baseMatches);
  console.log('  quoteMint matches USDC_MINT:', quoteMatches);

  if (!baseMatches || !quoteMatches) {
    console.log('\n⚠️  MISMATCH DETECTED!');
    console.log('   The on-chain mints do not match the frontend constants.');
    console.log('   This could cause the "Token mint is not part of this trading pair" error.');
  } else {
    console.log('\n✅ All mints match correctly!');
  }
}

main().catch(console.error);
