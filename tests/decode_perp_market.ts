import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const PERP_MARKET = new PublicKey('FFU5bwpju8Hrb2bgrrWPK4LgGG1rD1ReK9ieVHavcW6n');

async function main() {
  const account = await connection.getAccountInfo(PERP_MARKET);
  if (!account) {
    console.log('Market not found');
    return;
  }
  
  const data = account.data;
  let offset = 8; // Skip discriminator
  
  // underlying_mint (32)
  const underlyingMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('underlying_mint:', underlyingMint.toBase58());
  
  // quote_mint (32)
  const quoteMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('quote_mint:', quoteMint.toBase58());
  
  // max_leverage (1)
  const maxLeverage = data[offset];
  offset += 1;
  console.log('max_leverage:', maxLeverage);
  
  // maintenance_margin_bps (2)
  const maintenanceMarginBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('maintenance_margin_bps:', maintenanceMarginBps);
  
  // initial_margin_bps (2)
  const initialMarginBps = data.readUInt16LE(offset);
  offset += 2;
  console.log('initial_margin_bps:', initialMarginBps);
  
  // taker_fee_bps (2)
  offset += 2;
  // maker_fee_bps (2)
  offset += 2;
  // liquidation_fee_bps (2)
  offset += 2;
  // min_position_size (8)
  offset += 8;
  // tick_size (8)
  offset += 8;
  // max_open_interest (8)
  offset += 8;
  // total_long_oi (8)
  offset += 8;
  // total_short_oi (8)
  offset += 8;
  
  // position_count (8)
  const positionCount = data.readBigUInt64LE(offset);
  offset += 8;
  console.log('position_count:', positionCount.toString());
  
  // index (8)
  offset += 8;
  // last_funding_time (8)
  offset += 8;
  // cumulative_funding_long (16)
  offset += 16;
  // cumulative_funding_short (16)
  offset += 16;
  
  // oracle_price_feed (32)
  const oracle = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('oracle_price_feed:', oracle.toBase58());
  
  // collateral_vault (32)
  const collateralVault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('collateral_vault:', collateralVault.toBase58());
  
  // insurance_fund (32)
  const insuranceFund = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('insurance_fund:', insuranceFund.toBase58());
  
  // insurance_fund_target (8)
  offset += 8;
  
  // fee_recipient (32)
  const feeRecipient = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('fee_recipient:', feeRecipient.toBase58());
  
  // c_quote_mint (32)
  const cQuoteMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('c_quote_mint:', cQuoteMint.toBase58());
  
  // arcium_cluster (32)
  const arciumCluster = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('arcium_cluster:', arciumCluster.toBase58());
  
  // active (1)
  const active = data[offset] === 1;
  offset += 1;
  console.log('active:', active);
  
  // bump (1)
  const bump = data[offset];
  console.log('bump:', bump);
  
  // Verify Pyth oracle
  console.log('\n--- Verification ---');
  console.log('Expected Pyth SOL/USD:', 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');
  console.log('Stored oracle:', oracle.toBase58());
  console.log('Oracle matches:', oracle.toBase58() === 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');
}

main().catch(console.error);
