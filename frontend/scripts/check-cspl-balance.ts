import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as os from 'os';

// Program ID
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// Mints
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Seed for user balance PDA
const USER_BALANCE_SEED = Buffer.from('user_balance');

function deriveUserBalancePda(user: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_BALANCE_SEED, user.toBuffer(), mint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

// Read first 8 bytes as u64 LE
function readU64LE(data: Buffer, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

async function main() {
  // Get wallet from keypair file
  const keypairPath = os.homedir() + '/.config/solana/id.json';
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Derive PDAs
  const [solBalancePda] = deriveUserBalancePda(wallet.publicKey, SOL_MINT);
  const [usdcBalancePda] = deriveUserBalancePda(wallet.publicKey, USDC_MINT);
  
  console.log('\nSOL Balance PDA:', solBalancePda.toBase58());
  console.log('USDC Balance PDA:', usdcBalancePda.toBase58());
  
  // Fetch accounts
  const solAccount = await connection.getAccountInfo(solBalancePda);
  const usdcAccount = await connection.getAccountInfo(usdcBalancePda);
  
  console.log('\n=== SOL C-SPL Account ===');
  if (solAccount) {
    console.log('Account exists, data length:', solAccount.data.length);
    console.log('Owner:', solAccount.owner.toBase58());
    
    const data = solAccount.data;
    
    // Skip discriminator (8) + user (32) + mint (32) = 72 bytes to get to encrypted_balance
    const encryptedBalance = data.slice(72, 136);
    console.log('\nEncrypted balance (64 bytes, hex):', Buffer.from(encryptedBalance).toString('hex'));
    
    // Read first 8 bytes as u64 (V1 plaintext format)
    const balanceAsU64 = readU64LE(Buffer.from(encryptedBalance), 0);
    console.log('First 8 bytes as u64:', balanceAsU64.toString());
    console.log('As SOL:', Number(balanceAsU64) / 1e9);
    
    // Check if remaining bytes are non-zero (V2 encrypted format)
    const tailBytes = encryptedBalance.slice(16, 64);
    const hasEncryptedData = Array.from(tailBytes).some((b: number) => b !== 0);
    console.log('Has V2 encrypted data (non-zero tail):', hasEncryptedData);
    
    // MAX_REASONABLE_BALANCE check
    const MAX_REASONABLE_BALANCE = BigInt('1000000000000000'); // 10^15
    const isLegacyBroken = balanceAsU64 > MAX_REASONABLE_BALANCE;
    console.log('Is legacy broken (> 10^15):', isLegacyBroken);
  } else {
    console.log('Account does not exist');
  }
  
  console.log('\n=== USDC C-SPL Account ===');
  if (usdcAccount) {
    console.log('Account exists, data length:', usdcAccount.data.length);
    console.log('Owner:', usdcAccount.owner.toBase58());
    
    const data = usdcAccount.data;
    
    const encryptedBalance = data.slice(72, 136);
    console.log('\nEncrypted balance (64 bytes, hex):', Buffer.from(encryptedBalance).toString('hex'));
    
    const balanceAsU64 = readU64LE(Buffer.from(encryptedBalance), 0);
    console.log('First 8 bytes as u64:', balanceAsU64.toString());
    console.log('As USDC:', Number(balanceAsU64) / 1e6);
    
    const tailBytes = encryptedBalance.slice(16, 64);
    const hasEncryptedData = Array.from(tailBytes).some((b: number) => b !== 0);
    console.log('Has V2 encrypted data (non-zero tail):', hasEncryptedData);
    
    const MAX_REASONABLE_BALANCE = BigInt('1000000000000000');
    const isLegacyBroken = balanceAsU64 > MAX_REASONABLE_BALANCE;
    console.log('Is legacy broken (> 10^15):', isLegacyBroken);
  } else {
    console.log('Account does not exist');
  }
  
  // Also fetch native balances for comparison
  console.log('\n=== Native Wallet Balances ===');
  const nativeSol = await connection.getBalance(wallet.publicKey);
  console.log('Native SOL:', nativeSol / 1e9, 'SOL');
  
  try {
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
    const usdcTokenAccount = await getAccount(connection, usdcAta);
    console.log('Native USDC:', Number(usdcTokenAccount.amount) / 1e6, 'USDC');
  } catch (e) {
    console.log('No USDC token account');
  }
}

main().catch(console.error);
