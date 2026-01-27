/**
 * Admin Force-Close Broken V2 Positions
 *
 * This script calls admin_force_close_position for positions that cannot be
 * closed via MPC due to broken V2 encryption (truncated ephemeral pubkey).
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// SOL-PERP market underlying mint (Wrapped SOL)
const UNDERLYING_MINT = new PublicKey('So11111111111111111111111111111111111111112');
// Quote mint (USDC)
const QUOTE_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Discriminator for admin_force_close_v7_position (sha256("global:admin_force_close_v7_position")[0..8])
function getDiscriminator(name: string): Buffer {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// Use V7 instruction for 692-byte positions
const ADMIN_FORCE_CLOSE_V7_DISCRIMINATOR = getDiscriminator('admin_force_close_v7_position');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    DEX_PROGRAM_ID
  );
}

function derivePerpMarketPda(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('perp_market'), underlyingMint.toBuffer()],
    DEX_PROGRAM_ID
  );
}

function deriveVaultAuthorityPda(perpMarketPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), perpMarketPda.toBuffer()],
    DEX_PROGRAM_ID
  );
}

async function main() {
  // Load admin keypair from default Solana CLI location
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}. Set up Solana CLI first.`);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Admin wallet:', adminKeypair.publicKey.toString());

  // Get exchange state to verify admin
  const [exchangePda] = deriveExchangePda();
  const exchangeInfo = await connection.getAccountInfo(exchangePda);
  if (!exchangeInfo) {
    throw new Error('Exchange account not found');
  }

  // Check admin authority (at offset 8)
  const exchangeAuthority = new PublicKey(exchangeInfo.data.slice(8, 40));
  console.log('Exchange authority:', exchangeAuthority.toString());

  if (!exchangeAuthority.equals(adminKeypair.publicKey)) {
    throw new Error(`Admin wallet ${adminKeypair.publicKey.toString()} is not exchange authority ${exchangeAuthority.toString()}`);
  }

  console.log('Admin authority verified!');

  // Derive market PDA
  const [perpMarketPda] = derivePerpMarketPda(UNDERLYING_MINT);
  console.log('Perp market PDA:', perpMarketPda.toString());

  // Fetch market data to get collateral vault
  const marketInfo = await connection.getAccountInfo(perpMarketPda);
  if (!marketInfo) {
    throw new Error('Perp market not found');
  }

  // Collateral vault is at offset 8 + 32 + 32 + ... (need to find exact offset)
  // From perp_market.rs: underlying_mint(32) + quote_mint(32) + ... + collateral_vault
  // Let's read it from a known offset or derive it
  // Actually, the vault is a PDA derived from the market
  const [vaultAuthorityPda] = deriveVaultAuthorityPda(perpMarketPda);
  console.log('Vault authority PDA:', vaultAuthorityPda.toString());

  // Collateral vault is stored in market data
  // Offset verified from decode-market.ts output:
  // After oracle_price_feed (offset 211), collateral_vault is at offset 211
  const collateralVaultOffset = 211;
  const collateralVault = new PublicKey(marketInfo.data.slice(collateralVaultOffset, collateralVaultOffset + 32));
  console.log('Collateral vault (from market):', collateralVault.toString());

  // Verify the vault exists
  const vaultInfo = await connection.getAccountInfo(collateralVault);
  if (!vaultInfo) {
    throw new Error(`Collateral vault not found at ${collateralVault.toString()}`);
  }
  console.log('Vault owner:', new PublicKey(vaultInfo.owner).toString());

  // Find all broken V7 positions
  const accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [
      { dataSize: 692 },
    ],
  });

  console.log(`\nFound ${accounts.length} V7 positions to force-close\n`);

  for (const { pubkey: positionPda, account } of accounts) {
    const data = account.data;
    const trader = new PublicKey(data.slice(8, 40));
    const market = new PublicKey(data.slice(40, 72));
    const status = data[547];

    // Skip if already closed
    if (status !== 0) {
      console.log(`Skipping ${positionPda.toString()} - already closed`);
      continue;
    }

    // Read collateral from plaintext position data (bytes 0-8 of encrypted_collateral)
    // encrypted_collateral is at offset: 8 + 32 + 32 + 16 + 8 + 8 + 1 + 1 + 64 + 64 = 234
    const encryptedCollateralOffset = 234;
    const collateralPlaintext = data.readBigUInt64LE(encryptedCollateralOffset);

    console.log(`\nPosition: ${positionPda.toString()}`);
    console.log(`  Trader: ${trader.toString()}`);
    console.log(`  Collateral (plaintext): ${collateralPlaintext.toString()} (${Number(collateralPlaintext) / 1e6} USDC)`);

    // Get trader's USDC ATA
    const traderCollateralAta = await getAssociatedTokenAddress(QUOTE_MINT, trader);

    // Build admin_force_close_position instruction
    // Accounts order from AdminForceClosePosition struct:
    // 1. exchange (read)
    // 2. perp_market (mut)
    // 3. position (mut)
    // 4. trader (mut) - receives rent
    // 5. trader_collateral_account (mut)
    // 6. collateral_vault (mut)
    // 7. vault_authority (read)
    // 8. authority (signer, mut)
    // 9. token_program (read)

    // Instruction data: discriminator(8) + refund_amount(u64)
    const refundAmount = collateralPlaintext; // Return the original collateral
    const instructionData = Buffer.alloc(16);
    ADMIN_FORCE_CLOSE_V7_DISCRIMINATOR.copy(instructionData, 0);
    instructionData.writeBigUInt64LE(refundAmount, 8);

    const ix = new TransactionInstruction({
      programId: DEX_PROGRAM_ID,
      keys: [
        { pubkey: exchangePda, isSigner: false, isWritable: false },
        { pubkey: perpMarketPda, isSigner: false, isWritable: true },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: trader, isSigner: false, isWritable: true },
        { pubkey: traderCollateralAta, isSigner: false, isWritable: true },
        { pubkey: collateralVault, isSigner: false, isWritable: true },
        { pubkey: vaultAuthorityPda, isSigner: false, isWritable: false },
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    tx.add(ix);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;

    // Simulate first
    console.log('  Simulating transaction...');
    try {
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.log('  Simulation failed:', JSON.stringify(sim.value.err));
        console.log('  Logs:', sim.value.logs?.slice(-10).join('\n'));
        continue;
      }
      console.log('  Simulation success, units:', sim.value.unitsConsumed);
    } catch (simError) {
      console.log('  Simulation error:', simError);
      continue;
    }

    // Sign and send
    tx.sign(adminKeypair);
    console.log('  Sending transaction...');

    try {
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log('  Tx signature:', signature);

      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      console.log('  Position force-closed successfully!');
    } catch (sendError: any) {
      console.log('  Send error:', sendError.message);
      if (sendError.logs) {
        console.log('  Logs:', sendError.logs.slice(-10).join('\n'));
      }
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
