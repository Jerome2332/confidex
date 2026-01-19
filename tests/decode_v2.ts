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
  
  // Calculate actual offsets based on 373-byte account
  // This might be missing insurance_fund_target (8 bytes)
  
  // Skip to oracle (after fixed-size numeric fields)
  // 8 + 32 + 32 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 16 + 16 = 179
  let offset = 179;
  
  const oracle = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('oracle_price_feed:', oracle.toBase58());
  
  const collateralVault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('collateral_vault:', collateralVault.toBase58());
  
  const insuranceFund = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('insurance_fund:', insuranceFund.toBase58());
  
  // insurance_fund_target might be missing in old version
  // Try without it first
  
  const feeRecipient = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('fee_recipient:', feeRecipient.toBase58());
  
  const cQuoteMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('c_quote_mint:', cQuoteMint.toBase58());
  
  const arciumCluster = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('arcium_cluster:', arciumCluster.toBase58());
  
  // The last 2 bytes should be active (1) and bump (1)
  console.log('\nRemaining bytes:', data.length - offset);
  if (offset < data.length) {
    console.log('active:', data[offset]);
    console.log('bump:', data[offset + 1]);
  }
  
  // Also check the ACTUAL last 2 bytes
  console.log('\nActual last 2 bytes (active, bump):');
  console.log('active:', data[data.length - 2]);
  console.log('bump:', data[data.length - 1]);
}

main().catch(console.error);
