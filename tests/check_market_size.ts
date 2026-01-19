import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const PERP_MARKET = new PublicKey('FFU5bwpju8Hrb2bgrrWPK4LgGG1rD1ReK9ieVHavcW6n');

async function main() {
  const account = await connection.getAccountInfo(PERP_MARKET);
  if (!account) {
    console.log('Market not found');
    return;
  }
  
  console.log('Actual account size:', account.data.length, 'bytes');
  
  // Expected from perp_market.rs SIZE const
  const expectedSize = 8 +   // discriminator
    32 +  // underlying_mint
    32 +  // quote_mint
    1 +   // max_leverage
    2 +   // maintenance_margin_bps
    2 +   // initial_margin_bps
    2 +   // taker_fee_bps
    2 +   // maker_fee_bps
    2 +   // liquidation_fee_bps
    8 +   // min_position_size
    8 +   // tick_size
    8 +   // max_open_interest
    8 +   // total_long_open_interest
    8 +   // total_short_open_interest
    8 +   // position_count
    8 +   // index
    8 +   // last_funding_time
    16 +  // cumulative_funding_long (i128)
    16 +  // cumulative_funding_short (i128)
    32 +  // oracle_price_feed
    32 +  // collateral_vault
    32 +  // insurance_fund
    8 +   // insurance_fund_target
    32 +  // fee_recipient
    32 +  // c_quote_mint
    32 +  // arcium_cluster
    1 +   // active
    1;    // bump
  
  console.log('Expected size:', expectedSize, 'bytes');
  console.log('Difference:', account.data.length - expectedSize, 'bytes');
  
  // Let's dump the last 50 bytes
  const data = account.data;
  console.log('\nLast 50 bytes (hex):');
  console.log(data.slice(-50).toString('hex'));
  
  // Find active bit position manually
  // Expected offset for active = 8 + 32 + 32 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 16 + 16 + 32 + 32 + 32 + 8 + 32 + 32 + 32 = 363
  const activeOffset = 363;
  console.log('\nActive flag at offset', activeOffset, ':', data[activeOffset]);
  console.log('Bump at offset', activeOffset + 1, ':', data[activeOffset + 1]);
}

main().catch(console.error);
