/**
 * Decode perp market account data
 */

import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const UNDERLYING_MINT = new PublicKey('So11111111111111111111111111111111111111112');

function derivePerpMarketPda(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('perp_market'), underlyingMint.toBuffer()],
    DEX_PROGRAM_ID
  );
}

async function main() {
  const [perpMarketPda] = derivePerpMarketPda(UNDERLYING_MINT);
  console.log('Perp market PDA:', perpMarketPda.toString());

  const marketInfo = await connection.getAccountInfo(perpMarketPda);
  if (!marketInfo) {
    throw new Error('Perp market not found');
  }

  console.log('Market data length:', marketInfo.data.length);

  const data = marketInfo.data;
  let offset = 8; // skip discriminator

  // underlying_mint: Pubkey (32)
  const underlyingMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('underlying_mint:', underlyingMint.toString());

  // quote_mint: Pubkey (32)
  const quoteMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('quote_mint:', quoteMint.toString());

  // max_leverage: u8 (1)
  const maxLeverage = data[offset];
  offset += 1;
  console.log('max_leverage:', maxLeverage);

  // maintenance_margin_bps: u16 (2)
  const maintenanceMarginBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('maintenance_margin_bps:', maintenanceMarginBps);

  // initial_margin_bps: u16 (2)
  const initialMarginBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('initial_margin_bps:', initialMarginBps);

  // taker_fee_bps: u16 (2)
  const takerFeeBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('taker_fee_bps:', takerFeeBps);

  // maker_fee_bps: u16 (2)
  const makerFeeBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('maker_fee_bps:', makerFeeBps);

  // liquidation_fee_bps: u16 (2)
  const liquidationFeeBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('liquidation_fee_bps:', liquidationFeeBps);

  // min_position_size: u64 (8)
  const minPositionSize = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('min_position_size:', minPositionSize.toString());

  // tick_size: u64 (8)
  const tickSize = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('tick_size:', tickSize.toString());

  // max_open_interest: u64 (8)
  const maxOpenInterest = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('max_open_interest:', maxOpenInterest.toString());

  // total_long_open_interest: u64 (8)
  const totalLongOi = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('total_long_open_interest:', totalLongOi.toString());

  // total_short_open_interest: u64 (8)
  const totalShortOi = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('total_short_open_interest:', totalShortOi.toString());

  // position_count: u64 (8)
  const positionCount = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('position_count:', positionCount.toString());

  // index: u64 (8)
  const index = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('index:', index.toString());

  // last_funding_time: i64 (8)
  const lastFundingTime = data.readBigInt64LE(offset);
  offset += 8;
  console.log('last_funding_time:', lastFundingTime.toString());

  // cumulative_funding_long: i128 (16)
  // Read as two i64s (node doesn't have BigInt128)
  const cumFundLongLow = data.readBigUInt64LE(offset);
  const cumFundLongHigh = data.readBigInt64LE(offset + 8);
  offset += 16;
  console.log('cumulative_funding_long (low, high):', cumFundLongLow.toString(), cumFundLongHigh.toString());

  // cumulative_funding_short: i128 (16)
  const cumFundShortLow = data.readBigUInt64LE(offset);
  const cumFundShortHigh = data.readBigInt64LE(offset + 8);
  offset += 16;
  console.log('cumulative_funding_short (low, high):', cumFundShortLow.toString(), cumFundShortHigh.toString());

  // oracle_price_feed: Pubkey (32)
  const oraclePriceFeed = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('oracle_price_feed:', oraclePriceFeed.toString());

  console.log('\nCurrent offset:', offset);
  console.log('Expected collateral_vault offset: 203');

  // collateral_vault: Pubkey (32)
  const collateralVault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('collateral_vault:', collateralVault.toString());

  // Check if it exists
  const vaultInfo = await connection.getAccountInfo(collateralVault);
  console.log('collateral_vault exists:', vaultInfo !== null);
  if (vaultInfo) {
    console.log('collateral_vault owner:', new PublicKey(vaultInfo.owner).toString());
    console.log('collateral_vault data length:', vaultInfo.data.length);
  }

  // insurance_fund: Pubkey (32)
  const insuranceFund = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('insurance_fund:', insuranceFund.toString());

  // insurance_fund_target: u64 (8)
  const insuranceFundTarget = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('insurance_fund_target:', insuranceFundTarget.toString());

  // fee_recipient: Pubkey (32)
  const feeRecipient = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('fee_recipient:', feeRecipient.toString());

  // c_quote_mint: Pubkey (32)
  const cQuoteMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('c_quote_mint:', cQuoteMint.toString());

  // arcium_cluster: Pubkey (32)
  const arciumCluster = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('arcium_cluster:', arciumCluster.toString());

  // active: bool (1)
  const active = data[offset] !== 0;
  offset += 1;
  console.log('active:', active);

  // bump: u8 (1)
  const bump = data[offset];
  offset += 1;
  console.log('bump:', bump);

  console.log('\nFinal offset:', offset);
  console.log('Account size:', marketInfo.data.length);
}

main().catch(console.error);
