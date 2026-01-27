// CommonJS script to check position data
const { Connection, PublicKey } = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function main() {
  console.log('Fetching position accounts from DEX program...');

  // Position accounts are 692 bytes
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 692 }],
  });

  console.log(`Found ${accounts.length} position accounts\n`);

  for (const { pubkey, account } of accounts.slice(0, 5)) {
    const data = Buffer.from(account.data);

    // Position layout offset to encrypted_size = 8+32+32+16+8+1+1+1 = 99
    const OFFSET_ENCRYPTED_SIZE = 99;
    const OFFSET_ENCRYPTED_ENTRY_PRICE = 163;
    const OFFSET_ENCRYPTED_COLLATERAL = 227;

    const encSize = data.slice(OFFSET_ENCRYPTED_SIZE, OFFSET_ENCRYPTED_SIZE + 64);
    const encPrice = data.slice(OFFSET_ENCRYPTED_ENTRY_PRICE, OFFSET_ENCRYPTED_ENTRY_PRICE + 64);
    const encCollat = data.slice(OFFSET_ENCRYPTED_COLLATERAL, OFFSET_ENCRYPTED_COLLATERAL + 64);

    // Extract nonce (bytes 0-16), ciphertext (bytes 16-48), truncated pubkey (bytes 48-64)
    const sizeNonce = encSize.slice(0, 16);
    const sizeCiphertext = encSize.slice(16, 48);
    const sizeTruncPubkey = encSize.slice(48, 64);

    // Check if ciphertext region is all zeros
    const sizeCiphertextZeros = sizeCiphertext.every(b => b === 0);
    const priceCiphertextZeros = encPrice.slice(16, 48).every(b => b === 0);

    // Check plaintext values in bytes 0-8
    const sizePlaintext = data.readBigUInt64LE(OFFSET_ENCRYPTED_SIZE);
    const pricePlaintext = data.readBigUInt64LE(OFFSET_ENCRYPTED_ENTRY_PRICE);
    const collatPlaintext = data.readBigUInt64LE(OFFSET_ENCRYPTED_COLLATERAL);

    console.log(`Position: ${pubkey.toBase58()}`);
    console.log(`  encrypted_size:`);
    console.log(`    bytes 0-8 (nonce part or plaintext): ${encSize.slice(0,8).toString('hex')}`);
    console.log(`    bytes 16-48 (ciphertext): ${sizeCiphertextZeros ? 'ALL ZEROS' : sizeCiphertext.toString('hex')}`);
    console.log(`    bytes 48-64 (truncated pubkey): ${sizeTruncPubkey.toString('hex')}`);
    console.log(`    as u64 plaintext: ${sizePlaintext.toString()}`);
    console.log(`  encrypted_entry_price:`);
    console.log(`    bytes 16-48 (ciphertext): ${priceCiphertextZeros ? 'ALL ZEROS' : encPrice.slice(16,48).toString('hex')}`);
    console.log(`    as u64 plaintext: ${pricePlaintext.toString()}`);
    console.log(`  encrypted_collateral as u64: ${collatPlaintext.toString()}`);
    console.log(`  Ciphertext zeros: size=${sizeCiphertextZeros}, price=${priceCiphertextZeros}`);
    console.log('');
  }
}

main().catch(console.error);
