/**
 * Re-initialize Perpetual Market with Production-Ready Configuration
 *
 * This script:
 * 1. Creates proper PDA-derived token vault accounts
 * 2. Initializes the SOL-PERP market with correct struct layout
 * 3. Sets up funding state and liquidation config
 *
 * Prerequisites:
 * - Exchange must be initialized
 * - Wallet needs ~0.1 SOL for account creation
 * - Old market account must be closed first (or use different seeds)
 *
 * Usage: npx ts-node tests/reinit-perp-market.ts
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
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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

// Program ID (devnet)
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// Token mints
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Dummy USDC devnet

// Pyth Oracle (devnet SOL/USD)
const PYTH_SOL_USD_FEED = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

// Arcium cluster (devnet offset 123)
const ARCIUM_CLUSTER = PublicKey.default; // Will be derived or set to default

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PERP_MARKET_SEED = Buffer.from('perp_market');
const FUNDING_SEED = Buffer.from('funding');
const VAULT_SEED = Buffer.from('vault');
const INSURANCE_SEED = Buffer.from('insurance');

// Market parameters (production-ready)
const PERP_MARKET_CONFIG = {
  maxLeverage: 10,              // 10x max leverage
  maintenanceMarginBps: 500,    // 5% maintenance margin
  initialMarginBps: 1000,       // 10% initial margin
  takerFeeBps: 50,              // 0.5% taker fee
  makerFeeBps: 20,              // 0.2% maker fee
  liquidationFeeBps: 100,       // 1% liquidation fee
  minPositionSize: 10_000_000,  // 0.01 SOL minimum
  tickSize: 1_000,              // 0.001 USDC tick
  maxOpenInterest: 10_000_000_000_000, // 10,000 SOL max OI per side
  fundingIntervalSeconds: 3600, // 1 hour funding
  maxFundingRateBps: 100,       // 1% max funding rate
  insuranceFundTarget: 1_000_000_000, // 1000 USDC insurance target
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
// INSTRUCTION BUILDERS
// ============================================================================

function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const INIT_PERP_MARKET_DISCRIMINATOR = computeDiscriminator('initialize_perp_market');

/**
 * Build initialize_perp_market instruction
 *
 * Current struct layout (381 bytes total):
 * - discriminator: 8
 * - underlying_mint: 32
 * - quote_mint: 32
 * - max_leverage: 1
 * - maintenance_margin_bps: 2
 * - initial_margin_bps: 2
 * - taker_fee_bps: 2
 * - maker_fee_bps: 2
 * - liquidation_fee_bps: 2
 * - min_position_size: 8
 * - tick_size: 8
 * - max_open_interest: 8
 * - total_long_open_interest: 8
 * - total_short_open_interest: 8
 * - position_count: 8
 * - index: 8
 * - last_funding_time: 8
 * - cumulative_funding_long: 16
 * - cumulative_funding_short: 16
 * - oracle_price_feed: 32
 * - collateral_vault: 32
 * - insurance_fund: 32
 * - insurance_fund_target: 8  <-- This field was missing in old version
 * - fee_recipient: 32
 * - c_quote_mint: 32
 * - arcium_cluster: 32
 * - active: 1
 * - bump: 1
 */
function buildInitPerpMarketInstruction(
  authority: PublicKey,
  collateralVault: PublicKey,
  insuranceFund: PublicKey,
  feeRecipient: PublicKey,
  cQuoteMint: PublicKey,
  arciumCluster: PublicKey,
): TransactionInstruction {
  const [exchangePda] = deriveExchangePda();
  const [perpMarketPda] = derivePerpMarketPda(WSOL_MINT);
  const [fundingStatePda] = deriveFundingStatePda(perpMarketPda);

  // Instruction data: discriminator + params
  // Params: max_leverage(1) + maintenance_margin_bps(2) + initial_margin_bps(2) +
  //         taker_fee_bps(2) + maker_fee_bps(2) + liquidation_fee_bps(2) +
  //         min_position_size(8) + tick_size(8) + max_open_interest(8) +
  //         funding_interval_seconds(8) + max_funding_rate_bps(2) +
  //         insurance_fund_target(8) + arcium_cluster(32) = 85 bytes
  const dataSize = 8 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 2 + 8 + 32;
  const data = Buffer.alloc(dataSize);
  let offset = 0;

  // Discriminator
  INIT_PERP_MARKET_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  // max_leverage (u8)
  data.writeUInt8(PERP_MARKET_CONFIG.maxLeverage, offset);
  offset += 1;

  // maintenance_margin_bps (u16)
  data.writeUInt16LE(PERP_MARKET_CONFIG.maintenanceMarginBps, offset);
  offset += 2;

  // initial_margin_bps (u16)
  data.writeUInt16LE(PERP_MARKET_CONFIG.initialMarginBps, offset);
  offset += 2;

  // taker_fee_bps (u16)
  data.writeUInt16LE(PERP_MARKET_CONFIG.takerFeeBps, offset);
  offset += 2;

  // maker_fee_bps (u16)
  data.writeUInt16LE(PERP_MARKET_CONFIG.makerFeeBps, offset);
  offset += 2;

  // liquidation_fee_bps (u16)
  data.writeUInt16LE(PERP_MARKET_CONFIG.liquidationFeeBps, offset);
  offset += 2;

  // min_position_size (u64)
  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.minPositionSize), offset);
  offset += 8;

  // tick_size (u64)
  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.tickSize), offset);
  offset += 8;

  // max_open_interest (u64)
  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.maxOpenInterest), offset);
  offset += 8;

  // funding_interval_seconds (u64)
  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.fundingIntervalSeconds), offset);
  offset += 8;

  // max_funding_rate_bps (u16)
  data.writeUInt16LE(PERP_MARKET_CONFIG.maxFundingRateBps, offset);
  offset += 2;

  // insurance_fund_target (u64)
  data.writeBigUInt64LE(BigInt(PERP_MARKET_CONFIG.insuranceFundTarget), offset);
  offset += 8;

  // arcium_cluster (Pubkey, 32 bytes)
  arciumCluster.toBuffer().copy(data, offset);
  offset += 32;

  // Account order (must match Rust program):
  // 1. exchange (mut)
  // 2. perp_market (init, mut)
  // 3. funding_state (init, mut)
  // 4. underlying_mint (read)
  // 5. quote_mint (read)
  // 6. oracle_price_feed (read)
  // 7. collateral_vault (read) - must be valid token account
  // 8. insurance_fund (read) - must be valid token account
  // 9. fee_recipient (read)
  // 10. c_quote_mint (read)
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
      { pubkey: cQuoteMint, isSigner: false, isWritable: false },
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
  console.log('=== Confidex Perpetual Market Production Re-initialization ===\n');

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
    console.error('Run: solana airdrop 2 --url devnet');
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
  console.log('  Collateral Vault PDA:', collateralVaultPda.toString());
  console.log('  Insurance Fund PDA:', insuranceFundPda.toString());

  // Check exchange exists
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('\n✗ Exchange not initialized!');
    console.error('Run: npx ts-node tests/init-exchange.ts');
    process.exit(1);
  }
  console.log('\n✓ Exchange exists');

  // Check if old perp market exists
  const existingMarket = await connection.getAccountInfo(perpMarketPda);
  if (existingMarket) {
    console.log('\n⚠ Existing perp market found at', perpMarketPda.toString());
    console.log('  Size:', existingMarket.data.length, 'bytes');
    console.log('\nTo proceed, you need to either:');
    console.log('1. Close the existing market account (requires admin instruction)');
    console.log('2. Deploy a new program version that can migrate the data');
    console.log('3. Use a different underlying mint for testing\n');

    // For now, let's check if we can just update the vaults
    console.log('Checking if we can create proper vault accounts...\n');
  }

  // Create collateral vault ATA (USDC token account owned by vault PDA)
  const collateralVaultAta = await getAssociatedTokenAddress(
    USDC_MINT,
    collateralVaultPda,
    true // allowOwnerOffCurve - PDA is off-curve
  );
  console.log('Collateral Vault ATA:', collateralVaultAta.toString());

  // Create insurance fund ATA
  const insuranceFundAta = await getAssociatedTokenAddress(
    USDC_MINT,
    insuranceFundPda,
    true
  );
  console.log('Insurance Fund ATA:', insuranceFundAta.toString());

  // Fee recipient ATA (owned by authority for now)
  const feeRecipientAta = await getAssociatedTokenAddress(USDC_MINT, authority.publicKey);
  console.log('Fee Recipient ATA:', feeRecipientAta.toString());

  // Check if vault ATAs exist, create if not
  const tx = new Transaction();
  let needsVaultCreation = false;

  try {
    await getAccount(connection, collateralVaultAta);
    console.log('✓ Collateral vault ATA exists');
  } catch {
    console.log('→ Creating collateral vault ATA...');
    tx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        collateralVaultAta,
        collateralVaultPda,
        USDC_MINT
      )
    );
    needsVaultCreation = true;
  }

  try {
    await getAccount(connection, insuranceFundAta);
    console.log('✓ Insurance fund ATA exists');
  } catch {
    console.log('→ Creating insurance fund ATA...');
    tx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        insuranceFundAta,
        insuranceFundPda,
        USDC_MINT
      )
    );
    needsVaultCreation = true;
  }

  try {
    await getAccount(connection, feeRecipientAta);
    console.log('✓ Fee recipient ATA exists');
  } catch {
    console.log('→ Creating fee recipient ATA...');
    tx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        feeRecipientAta,
        authority.publicKey,
        USDC_MINT
      )
    );
    needsVaultCreation = true;
  }

  if (needsVaultCreation) {
    console.log('\nCreating vault token accounts...');
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('✓ Vault accounts created:', sig);
  }

  // Now initialize or update the perp market
  if (!existingMarket) {
    console.log('\n→ Initializing SOL-PERP market...');

    const initTx = new Transaction().add(
      buildInitPerpMarketInstruction(
        authority.publicKey,
        collateralVaultAta,
        insuranceFundAta,
        feeRecipientAta,
        USDC_MINT, // c_quote_mint (regular USDC until C-SPL)
        ARCIUM_CLUSTER,
      )
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, initTx, [authority]);
      console.log('✓ Perp market initialized:', sig);
    } catch (error) {
      console.error('Error initializing perp market:', error);
      process.exit(1);
    }
  } else {
    console.log('\n⚠ Market already exists - cannot re-initialize without closing first');
    console.log('\nThe existing market has these issues:');
    console.log('1. collateral_vault points to a wallet, not a token account');
    console.log('2. Account struct is missing insurance_fund_target field');
    console.log('\nOptions to fix:');
    console.log('A) Add an admin instruction to close/migrate the market');
    console.log('B) Redeploy the program with migration logic');
    console.log('C) For testing: use a mock/bypass in the frontend\n');

    // Print what the CORRECT values should be
    console.log('=== Correct Configuration ===');
    console.log('Collateral Vault (ATA):', collateralVaultAta.toString());
    console.log('Insurance Fund (ATA):', insuranceFundAta.toString());
    console.log('Fee Recipient (ATA):', feeRecipientAta.toString());
    console.log('Oracle:', PYTH_SOL_USD_FEED.toString());
  }

  console.log('\n=== Summary ===');
  console.log('Program ID:', PROGRAM_ID.toString());
  console.log('Perp Market PDA:', perpMarketPda.toString());
  console.log('Funding State PDA:', fundingStatePda.toString());
  console.log('Collateral Vault ATA:', collateralVaultAta.toString());
  console.log('Insurance Fund ATA:', insuranceFundAta.toString());

  console.log('\n📝 Update frontend/src/lib/constants.ts with:');
  console.log(`export const SOL_PERP_MARKET_PDA = new PublicKey('${perpMarketPda.toString()}');`);
  console.log(`export const SOL_PERP_FUNDING_PDA = new PublicKey('${fundingStatePda.toString()}');`);
  console.log(`export const SOL_PERP_COLLATERAL_VAULT = new PublicKey('${collateralVaultAta.toString()}');`);
}

main().catch(console.error);
