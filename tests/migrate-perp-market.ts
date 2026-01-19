/**
 * Migrate Perpetual Market
 *
 * This script:
 * 1. Closes the existing perp market (returns lamports to authority)
 * 2. Creates proper token vault accounts
 * 3. Reinitializes the perp market with correct configuration
 *
 * Usage: npx ts-node migrate-perp-market.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
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
const PYTH_SOL_USD_FEED = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PERP_MARKET_SEED = Buffer.from('perp_market');
const FUNDING_SEED = Buffer.from('funding');
const VAULT_SEED = Buffer.from('vault');
const INSURANCE_SEED = Buffer.from('insurance');

// Market parameters
const PERP_MARKET_CONFIG = {
  maxLeverage: 10,
  maintenanceMarginBps: 500,
  initialMarginBps: 1000,
  takerFeeBps: 50,
  makerFeeBps: 20,
  liquidationFeeBps: 100,
  minPositionSize: 10_000_000,
  tickSize: 1_000,
  maxOpenInterest: 10_000_000_000_000,
  fundingIntervalSeconds: 3600,
  maxFundingRateBps: 100,
};

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

function deriveFundingStatePda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FUNDING_SEED, perpMarket.toBuffer()],
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
// DISCRIMINATORS
// ============================================================================

function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const CLOSE_PERP_MARKET_DISCRIMINATOR = computeDiscriminator('close_perp_market');
const CLOSE_FUNDING_STATE_DISCRIMINATOR = computeDiscriminator('close_funding_state');
const INIT_PERP_MARKET_DISCRIMINATOR = computeDiscriminator('initialize_perp_market');

// ============================================================================
// INSTRUCTION BUILDERS
// ============================================================================

function buildClosePerpMarketInstruction(
  authority: PublicKey,
  exchangePda: PublicKey,
  perpMarketPda: PublicKey,
  underlyingMint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: underlyingMint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: CLOSE_PERP_MARKET_DISCRIMINATOR,
  });
}

function buildCloseFundingStateInstruction(
  authority: PublicKey,
  exchangePda: PublicKey,
  perpMarketPda: PublicKey,
  fundingStatePda: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: perpMarketPda, isSigner: false, isWritable: false },
      { pubkey: fundingStatePda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: CLOSE_FUNDING_STATE_DISCRIMINATOR,
  });
}

function buildInitPerpMarketInstruction(
  authority: PublicKey,
  exchangePda: PublicKey,
  perpMarketPda: PublicKey,
  fundingStatePda: PublicKey,
  collateralVault: PublicKey,
  insuranceFund: PublicKey,
  feeRecipient: PublicKey,
): TransactionInstruction {
  // Instruction data layout (from perp_init_market.rs handler signature)
  const dataSize = 8 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 2;
  const data = Buffer.alloc(dataSize);
  let offset = 0;

  INIT_PERP_MARKET_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  data.writeUInt8(PERP_MARKET_CONFIG.maxLeverage, offset);
  offset += 1;

  data.writeUInt16LE(PERP_MARKET_CONFIG.maintenanceMarginBps, offset);
  offset += 2;

  data.writeUInt16LE(PERP_MARKET_CONFIG.initialMarginBps, offset);
  offset += 2;

  data.writeUInt16LE(PERP_MARKET_CONFIG.takerFeeBps, offset);
  offset += 2;

  data.writeUInt16LE(PERP_MARKET_CONFIG.makerFeeBps, offset);
  offset += 2;

  data.writeUInt16LE(PERP_MARKET_CONFIG.liquidationFeeBps, offset);
  offset += 2;

  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.minPositionSize), offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.tickSize), offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.maxOpenInterest), offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.fundingIntervalSeconds), offset);
  offset += 8;

  data.writeUInt16LE(PERP_MARKET_CONFIG.maxFundingRateBps, offset);

  // Account order (from perp_init_market.rs):
  // 1. exchange (mut)
  // 2. perp_market (init, mut)
  // 3. funding_state (init, mut)
  // 4. underlying_mint (read)
  // 5. quote_mint (read)
  // 6. oracle_price_feed (read)
  // 7. collateral_vault (read)
  // 8. insurance_fund (read)
  // 9. fee_recipient (read)
  // 10. c_quote_mint (read) - we use USDC for now
  // 11. authority (signer, mut)
  // 12. system_program (read)
  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: fundingStatePda, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: PYTH_SOL_USD_FEED, isSigner: false, isWritable: false },
      { pubkey: collateralVault, isSigner: false, isWritable: false },
      { pubkey: insuranceFund, isSigner: false, isWritable: false },
      { pubkey: feeRecipient, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false }, // c_quote_mint
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Migrate Perpetual Market ===\n');

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

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error('Error: Need at least 0.1 SOL');
    process.exit(1);
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [perpMarketPda] = derivePerpMarketPda(WSOL_MINT);
  const [fundingStatePda] = deriveFundingStatePda(perpMarketPda);
  const [collateralVaultPda] = deriveCollateralVaultPda(perpMarketPda);
  const [insuranceFundPda] = deriveInsuranceFundPda(perpMarketPda);

  console.log('\nDerived PDAs:');
  console.log('  Exchange:', exchangePda.toString());
  console.log('  Perp Market:', perpMarketPda.toString());
  console.log('  Funding State:', fundingStatePda.toString());

  // Verify exchange exists
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('\n✗ Exchange not found!');
    process.exit(1);
  }
  console.log('\n✓ Exchange exists');

  // Check if old market exists
  const oldMarketAccount = await connection.getAccountInfo(perpMarketPda);
  if (oldMarketAccount) {
    console.log('✓ Old perp market found (' + oldMarketAccount.data.length + ' bytes)');
    console.log('\n=== Step 1: Close old perp market ===');

    const closeTx = new Transaction().add(
      buildClosePerpMarketInstruction(
        authority.publicKey,
        exchangePda,
        perpMarketPda,
        WSOL_MINT,
      )
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, closeTx, [authority]);
      console.log('✓ Old market closed:', sig);
    } catch (error) {
      console.error('Error closing market:', error);
      process.exit(1);
    }

    // Wait for account to be cleaned up
    await new Promise(resolve => setTimeout(resolve, 2000));
  } else {
    console.log('No existing perp market found - creating fresh');
  }

  // Check if funding state exists and close it
  const fundingAccount = await connection.getAccountInfo(fundingStatePda);
  if (fundingAccount) {
    console.log('\n=== Step 1b: Close old funding state ===');
    console.log('Funding state found (' + fundingAccount.data.length + ' bytes)');

    const closeFundingTx = new Transaction().add(
      buildCloseFundingStateInstruction(
        authority.publicKey,
        exchangePda,
        perpMarketPda,
        fundingStatePda,
      )
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, closeFundingTx, [authority]);
      console.log('✓ Funding state closed:', sig);
    } catch (error: any) {
      console.error('Error closing funding state:', error.message);
      if (error.logs) {
        console.log('Logs:', error.logs);
      }
      process.exit(1);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // === Step 2: Create vault token accounts ===
  console.log('\n=== Step 2: Create vault token accounts ===');

  const collateralVaultAta = await getAssociatedTokenAddress(
    USDC_MINT,
    collateralVaultPda,
    true
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

  console.log('Collateral Vault ATA:', collateralVaultAta.toString());
  console.log('Insurance Fund ATA:', insuranceFundAta.toString());
  console.log('Fee Recipient ATA:', feeRecipientAta.toString());

  const createAtasTx = new Transaction();
  let needsAtaCreation = false;

  try {
    await getAccount(connection, collateralVaultAta);
    console.log('✓ Collateral vault ATA exists');
  } catch {
    console.log('→ Creating collateral vault ATA');
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
    console.log('→ Creating insurance fund ATA');
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
    console.log('→ Creating fee recipient ATA');
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
    const sig = await sendAndConfirmTransaction(connection, createAtasTx, [authority]);
    console.log('✓ Token accounts created:', sig);
  }

  // === Step 3: Initialize new perp market ===
  console.log('\n=== Step 3: Initialize new perp market ===');

  const initTx = new Transaction().add(
    buildInitPerpMarketInstruction(
      authority.publicKey,
      exchangePda,
      perpMarketPda,
      fundingStatePda,
      collateralVaultAta,
      insuranceFundAta,
      feeRecipientAta,
    )
  );

  try {
    const sig = await sendAndConfirmTransaction(connection, initTx, [authority]);
    console.log('✓ New perp market initialized:', sig);
  } catch (error: any) {
    console.error('Error initializing market:', error.message);
    if (error.logs) {
      console.log('Logs:', error.logs);
    }
    process.exit(1);
  }

  // === Verify ===
  console.log('\n=== Verification ===');
  const newMarket = await connection.getAccountInfo(perpMarketPda);
  if (newMarket) {
    console.log('✓ New market account size:', newMarket.data.length, 'bytes');

    // Read collateral_vault from the new account
    // Offset: 8(disc) + 32(underlying) + 32(quote) + 1(max_lev) + 2(mm) + 2(im) + 2(taker) + 2(maker) + 2(liq) +
    //         8(min) + 8(tick) + 8(max_oi) + 8(long_oi) + 8(short_oi) + 8(pos_count) + 8(index) + 8(fund_time) +
    //         16(cum_fund_long) + 16(cum_fund_short) + 32(oracle) = 211 offset
    const collateralOffset = 211;
    const storedCollateralVault = new PublicKey(newMarket.data.slice(collateralOffset, collateralOffset + 32));
    console.log('✓ Collateral vault:', storedCollateralVault.toString());
    console.log('  Expected:', collateralVaultAta.toString());
    console.log('  Match:', storedCollateralVault.equals(collateralVaultAta));
  }

  console.log('\n=== Migration Complete ===');
  console.log('\nPerp Market PDA:', perpMarketPda.toString());
  console.log('Funding State PDA:', fundingStatePda.toString());
  console.log('Collateral Vault:', collateralVaultAta.toString());
  console.log('Insurance Fund:', insuranceFundAta.toString());
  console.log('\nYou can now open positions on the SOL-PERP market!');
}

main().catch(console.error);
