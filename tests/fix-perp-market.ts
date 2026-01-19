/**
 * Fix Perpetual Market Configuration
 *
 * This script:
 * 1. Creates proper PDA-derived token vault accounts for collateral and insurance
 * 2. Calls set_perp_market_vaults to update the market with correct vault addresses
 *
 * Prerequisites:
 * - Program must be redeployed with the new set_perp_market_vaults instruction
 * - Wallet must be the exchange authority
 * - Wallet needs ~0.05 SOL for account creation
 *
 * Usage: npx ts-node tests/fix-perp-market.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PERP_MARKET_SEED = Buffer.from('perp_market');
const VAULT_SEED = Buffer.from('vault');
const INSURANCE_SEED = Buffer.from('insurance');

// ============================================================================
// PDA DERIVATION
// ============================================================================

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], PROGRAM_ID);
}

function derivePerpMarketPda(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PERP_MARKET_SEED, underlyingMint.toBuffer()],
    PROGRAM_ID
  );
}

function deriveCollateralVaultPda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, perpMarket.toBuffer()],
    PROGRAM_ID
  );
}

function deriveInsuranceFundPda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [INSURANCE_SEED, perpMarket.toBuffer()],
    PROGRAM_ID
  );
}

// ============================================================================
// INSTRUCTION BUILDER
// ============================================================================

function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const SET_PERP_MARKET_VAULTS_DISCRIMINATOR = computeDiscriminator('set_perp_market_vaults');

function buildSetPerpMarketVaultsInstruction(
  authority: PublicKey,
  exchangePda: PublicKey,
  perpMarketPda: PublicKey,
  collateralVault: PublicKey,
  insuranceFund: PublicKey,
  feeRecipient: PublicKey,
): TransactionInstruction {
  // Account order (from admin.rs SetPerpMarketVaults):
  // 1. exchange (read)
  // 2. perp_market (mut)
  // 3. collateral_vault (read, TokenAccount)
  // 4. insurance_fund (read, TokenAccount)
  // 5. fee_recipient (read, TokenAccount)
  // 6. authority (signer)
  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: false },
      { pubkey: insuranceFund, isSigner: false, isWritable: false },
      { pubkey: feeRecipient, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: SET_PERP_MARKET_VAULTS_DISCRIMINATOR,
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Fix Perpetual Market Vaults ===\n');

  // Load keypair
  const keypairPath = path.join(process.env.HOME || '~', '.config/solana/id.json');
  if (!fs.existsSync(keypairPath)) {
    console.error('Error: Keypair not found at', keypairPath);
    process.exit(1);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log('Authority:', authority.publicKey.toString());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');

  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.error('Error: Need at least 0.05 SOL');
    console.error('Run: solana airdrop 2 --url devnet');
    process.exit(1);
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [perpMarketPda] = derivePerpMarketPda(WSOL_MINT);
  const [collateralVaultPda] = deriveCollateralVaultPda(perpMarketPda);
  const [insuranceFundPda] = deriveInsuranceFundPda(perpMarketPda);

  console.log('\nDerived PDAs:');
  console.log('  Exchange:', exchangePda.toString());
  console.log('  Perp Market:', perpMarketPda.toString());
  console.log('  Collateral Vault PDA:', collateralVaultPda.toString());
  console.log('  Insurance Fund PDA:', insuranceFundPda.toString());

  // Verify exchange exists
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('\n✗ Exchange not found!');
    process.exit(1);
  }
  console.log('\n✓ Exchange exists');

  // Verify perp market exists
  const perpMarketAccount = await connection.getAccountInfo(perpMarketPda);
  if (!perpMarketAccount) {
    console.error('\n✗ Perp market not found!');
    process.exit(1);
  }
  console.log('✓ Perp market exists');

  // Derive ATAs for vaults
  const collateralVaultAta = await getAssociatedTokenAddress(
    USDC_MINT,
    collateralVaultPda,
    true // allowOwnerOffCurve for PDAs
  );

  const insuranceFundAta = await getAssociatedTokenAddress(
    USDC_MINT,
    insuranceFundPda,
    true
  );

  const feeRecipientAta = await getAssociatedTokenAddress(
    USDC_MINT,
    authority.publicKey
  );

  console.log('\nToken Account Addresses:');
  console.log('  Collateral Vault ATA:', collateralVaultAta.toString());
  console.log('  Insurance Fund ATA:', insuranceFundAta.toString());
  console.log('  Fee Recipient ATA:', feeRecipientAta.toString());

  // Create ATAs if they don't exist
  const createAtasTx = new Transaction();
  let needsAtaCreation = false;

  try {
    await getAccount(connection, collateralVaultAta);
    console.log('\n✓ Collateral vault ATA exists');
  } catch {
    console.log('\n→ Will create collateral vault ATA');
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        collateralVaultAta,
        collateralVaultPda,
        USDC_MINT
      )
    );
    needsAtaCreation = true;
  }

  try {
    await getAccount(connection, insuranceFundAta);
    console.log('✓ Insurance fund ATA exists');
  } catch {
    console.log('→ Will create insurance fund ATA');
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        insuranceFundAta,
        insuranceFundPda,
        USDC_MINT
      )
    );
    needsAtaCreation = true;
  }

  try {
    await getAccount(connection, feeRecipientAta);
    console.log('✓ Fee recipient ATA exists');
  } catch {
    console.log('→ Will create fee recipient ATA');
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        feeRecipientAta,
        authority.publicKey,
        USDC_MINT
      )
    );
    needsAtaCreation = true;
  }

  if (needsAtaCreation) {
    console.log('\nCreating token accounts...');
    const sig = await sendAndConfirmTransaction(connection, createAtasTx, [authority]);
    console.log('✓ Token accounts created:', sig);
  }

  // Build and send set_perp_market_vaults instruction
  console.log('\nUpdating perp market vaults...');

  const setVaultsTx = new Transaction().add(
    buildSetPerpMarketVaultsInstruction(
      authority.publicKey,
      exchangePda,
      perpMarketPda,
      collateralVaultAta,
      insuranceFundAta,
      feeRecipientAta,
    )
  );

  try {
    const sig = await sendAndConfirmTransaction(connection, setVaultsTx, [authority]);
    console.log('✓ Perp market vaults updated:', sig);
  } catch (error) {
    console.error('Error updating vaults:', error);
    console.error('\nNote: The program must be redeployed with the new set_perp_market_vaults instruction.');
    console.error('Run: anchor build && anchor deploy --program-name confidex_dex');
    process.exit(1);
  }

  // Verify the update
  console.log('\n=== Verification ===');
  const updatedMarket = await connection.getAccountInfo(perpMarketPda);
  if (updatedMarket) {
    const data = updatedMarket.data;
    // Read collateral_vault at offset 179 + 32 = 211
    const collateralOffset = 179 + 32;
    const storedCollateralVault = new PublicKey(data.slice(collateralOffset, collateralOffset + 32));
    console.log('Stored collateral_vault:', storedCollateralVault.toString());
    console.log('Expected:', collateralVaultAta.toString());
    console.log('Match:', storedCollateralVault.equals(collateralVaultAta) ? '✓' : '✗');
  }

  console.log('\n=== Complete ===');
  console.log('\nNow you can open positions on the SOL-PERP market!');
  console.log('The collateral vault is properly configured as a token account.');
}

main().catch(console.error);
