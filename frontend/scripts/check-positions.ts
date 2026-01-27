import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

async function main() {
  // Find all V7 position accounts (692 bytes)
  const v7Accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [
      { dataSize: 692 },
    ],
  });

  console.log(`Found ${v7Accounts.length} V7 position accounts (692 bytes):`);

  for (const { pubkey, account } of v7Accounts) {
    const data = account.data;
    const trader = new PublicKey(data.slice(8, 40));
    const side = data[104];
    const leverage = data[105];
    const thresholdVerified = data[530] !== 0;
    const status = data[547];

    console.log(`\nPosition: ${pubkey.toString()}`);
    console.log(`  Trader: ${trader.toString()}`);
    console.log(`  Side: ${side === 0 ? 'Long' : 'Short'}, Leverage: ${leverage}x`);
    console.log(`  Status: ${status} (0=Open, 1=Closed)`);
    console.log(`  Threshold Verified: ${thresholdVerified}`);
  }

  // Find all V8 position accounts (724 bytes)
  const v8Accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [
      { dataSize: 724 },
    ],
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Found ${v8Accounts.length} V8 position accounts (724 bytes):`);

  for (const { pubkey, account } of v8Accounts) {
    const data = account.data;
    const trader = new PublicKey(data.slice(8, 40));
    const side = data[104];
    const leverage = data[105];
    // V8 has ephemeral_pubkey at offset 692 (end of struct)
    const ephemeralPubkey = data.slice(692, 724);
    // threshold_verified and status offsets are the SAME as V7
    // (ephemeral_pubkey is added at the end, not inserted in the middle)
    const thresholdVerified = data[530] !== 0;
    const status = data[547];

    console.log(`\nPosition: ${pubkey.toString()}`);
    console.log(`  Trader: ${trader.toString()}`);
    console.log(`  Side: ${side === 0 ? 'Long' : 'Short'}, Leverage: ${leverage}x`);
    console.log(`  Status: ${status} (0=Open, 1=Closed)`);
    console.log(`  Threshold Verified: ${thresholdVerified}`);
    console.log(`  Ephemeral Pubkey: ${Buffer.from(ephemeralPubkey).toString('hex')}`);
  }
}

main().catch(console.error);
