/**
 * Initialize Perpetual Market on Devnet
 *
 * Usage: npx ts-node tests/init-perp-market.ts
 *
 * This script:
 * 1. Initializes the SOL-PERP perpetual market
 * 2. Creates the FundingRateState account
 * 3. Optionally initializes the LiquidationConfig
 *
 * Prerequisites:
 * - Exchange must be initialized (run init-exchange.ts first)
 * - Wallet must have ~0.05 SOL for account creation
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Program ID (devnet) - same as spot trading
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// Token mints
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // Underlying (SOL)
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Quote/Collateral (Dummy USDC)

// Pyth Oracle (devnet SOL/USD)
const PYTH_SOL_USD_FEED = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PERP_MARKET_SEED = Buffer.from('perp_market');
const FUNDING_SEED = Buffer.from('funding');
const LIQUIDATION_CONFIG_SEED = Buffer.from('liquidation_config');

// Market parameters
const PERP_MARKET_CONFIG = {
  maxLeverage: 10,              // 10x max leverage
  maintenanceMarginBps: 500,    // 5% maintenance margin
  initialMarginBps: 1000,       // 10% initial margin
  takerFeeBps: 50,              // 0.5% taker fee
  makerFeeBps: 20,              // 0.2% maker fee (rebate can be negative)
  liquidationFeeBps: 100,       // 1% liquidation fee (to liquidator)
  minPositionSize: 10_000_000,  // 0.01 SOL minimum position
  tickSize: 1_000,              // 0.001 USDC tick size
  maxOpenInterest: 1_000_000_000_000, // 1000 SOL max OI per side
  fundingIntervalSeconds: 3600, // 1 hour funding interval
  maxFundingRateBps: 100,       // 1% max funding rate per interval
};

// Liquidation config parameters
const LIQUIDATION_CONFIG = {
  liquidationBonusBps: 50,      // 0.5% bonus to liquidators
  insuranceFundShareBps: 2500,  // 25% of remaining collateral to insurance
  maxLiquidationPerTx: 100_000_000_000, // 100 SOL max per liquidation
  minLiquidationThreshold: 1_000_000, // 0.001 SOL minimum
  adlEnabled: true,             // Enable auto-deleveraging
  adlTriggerThresholdBps: 1000, // ADL triggers at 10% insurance fund
};

// Compute instruction discriminators (Anchor style)
function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const INIT_PERP_MARKET_DISCRIMINATOR = computeDiscriminator('initialize_perp_market');
const INIT_LIQUIDATION_CONFIG_DISCRIMINATOR = computeDiscriminator('initialize_liquidation_config');

// Derive PDAs
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

function deriveLiquidationConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LIQUIDATION_CONFIG_SEED],
    PROGRAM_ID
  );
}

/**
 * Build initialize_perp_market instruction
 *
 * Instruction layout:
 * - discriminator: 8 bytes
 * - max_leverage: 1 byte (u8)
 * - maintenance_margin_bps: 2 bytes (u16)
 * - initial_margin_bps: 2 bytes (u16)
 * - taker_fee_bps: 2 bytes (u16)
 * - maker_fee_bps: 2 bytes (u16)
 * - liquidation_fee_bps: 2 bytes (u16)
 * - min_position_size: 8 bytes (u64)
 * - tick_size: 8 bytes (u64)
 * - max_open_interest: 8 bytes (u64)
 * - funding_interval_seconds: 8 bytes (u64)
 * - max_funding_rate_bps: 2 bytes (u16)
 */
function buildInitPerpMarketInstruction(
  authority: PublicKey,
  collateralVault: PublicKey,
  insuranceFund: PublicKey,
  feeRecipient: PublicKey,
  cQuoteMint: PublicKey,
): TransactionInstruction {
  const [exchangePda] = deriveExchangePda();
  const [perpMarketPda] = derivePerpMarketPda(WSOL_MINT);
  const [fundingStatePda] = deriveFundingStatePda(perpMarketPda);

  // Total data size: 8 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 2 = 53 bytes
  const data = Buffer.alloc(53);
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

  // Account order from perp_init_market.rs:
  // 1. exchange (mut)
  // 2. perp_market (init, mut)
  // 3. funding_state (init, mut)
  // 4. underlying_mint (read)
  // 5. quote_mint (read)
  // 6. oracle_price_feed (read)
  // 7. collateral_vault (read)
  // 8. insurance_fund (read)
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

/**
 * Build initialize_liquidation_config instruction
 */
function buildInitLiquidationConfigInstruction(
  authority: PublicKey,
  insuranceFund: PublicKey,
): TransactionInstruction {
  const [exchangePda] = deriveExchangePda();
  const [liquidationConfigPda] = deriveLiquidationConfigPda();

  // Data: discriminator(8) + liquidation_bonus_bps(2) + insurance_fund_share_bps(2) +
  //       max_liquidation_per_tx(8) + min_liquidation_threshold(8) + adl_enabled(1) +
  //       adl_trigger_threshold_bps(2) = 31 bytes
  const data = Buffer.alloc(31);
  let offset = 0;

  INIT_LIQUIDATION_CONFIG_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  data.writeUInt16LE(LIQUIDATION_CONFIG.liquidationBonusBps, offset);
  offset += 2;

  data.writeUInt16LE(LIQUIDATION_CONFIG.insuranceFundShareBps, offset);
  offset += 2;

  data.writeBigUInt64LE(BigInt(LIQUIDATION_CONFIG.maxLiquidationPerTx), offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(LIQUIDATION_CONFIG.minLiquidationThreshold), offset);
  offset += 8;

  data.writeUInt8(LIQUIDATION_CONFIG.adlEnabled ? 1 : 0, offset);
  offset += 1;

  data.writeUInt16LE(LIQUIDATION_CONFIG.adlTriggerThresholdBps, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: liquidationConfigPda, isSigner: false, isWritable: true },
      { pubkey: insuranceFund, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

async function main() {
  console.log('=== Confidex Perpetual Market Initialization ===\n');

  // Load keypair
  const keypairPath = path.join(
    process.env.HOME || '~',
    '.config/solana/id.json'
  );

  if (!fs.existsSync(keypairPath)) {
    console.error('Error: Keypair not found at', keypairPath);
    console.error('Please run: solana-keygen new');
    process.exit(1);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Authority:', authority.publicKey.toString());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL');

  if (balance < 0.05 * 1e9) {
    console.error('Error: Insufficient balance. Need at least 0.05 SOL');
    console.error('Run: solana airdrop 2 --url devnet');
    process.exit(1);
  }

  // Derive all PDAs
  const [exchangePda] = deriveExchangePda();
  const [perpMarketPda] = derivePerpMarketPda(WSOL_MINT);
  const [fundingStatePda] = deriveFundingStatePda(perpMarketPda);
  const [liquidationConfigPda] = deriveLiquidationConfigPda();

  console.log('\nDerived PDAs:');
  console.log('  Exchange PDA:', exchangePda.toString());
  console.log('  Perp Market PDA:', perpMarketPda.toString());
  console.log('  Funding State PDA:', fundingStatePda.toString());
  console.log('  Liquidation Config PDA:', liquidationConfigPda.toString());

  // Check if exchange exists (required)
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('\n✗ Exchange not initialized!');
    console.error('Please run: npx ts-node tests/init-exchange.ts');
    process.exit(1);
  }
  console.log('\n✓ Exchange is initialized');

  // For devnet, we'll use the authority's wallet as placeholder for vaults
  // In production, these would be separate token accounts
  const collateralVault = authority.publicKey; // Placeholder
  const insuranceFund = authority.publicKey;   // Placeholder
  const feeRecipient = authority.publicKey;    // Placeholder
  const cQuoteMint = USDC_MINT;                // Use regular USDC until C-SPL

  // Check if perp market already exists
  const perpMarketAccount = await connection.getAccountInfo(perpMarketPda);
  if (perpMarketAccount) {
    console.log('✓ Perp market already initialized');
  } else {
    console.log('\n→ Initializing SOL-PERP market...');
    console.log('  Max Leverage:', PERP_MARKET_CONFIG.maxLeverage, 'x');
    console.log('  Maintenance Margin:', PERP_MARKET_CONFIG.maintenanceMarginBps / 100, '%');
    console.log('  Initial Margin:', PERP_MARKET_CONFIG.initialMarginBps / 100, '%');
    console.log('  Taker Fee:', PERP_MARKET_CONFIG.takerFeeBps / 100, '%');
    console.log('  Maker Fee:', PERP_MARKET_CONFIG.makerFeeBps / 100, '%');
    console.log('  Funding Interval:', PERP_MARKET_CONFIG.fundingIntervalSeconds / 60, 'minutes');

    const initPerpTx = new Transaction().add(
      buildInitPerpMarketInstruction(
        authority.publicKey,
        collateralVault,
        insuranceFund,
        feeRecipient,
        cQuoteMint,
      )
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, initPerpTx, [authority], {
        commitment: 'confirmed',
      });
      console.log('✓ Perp market initialized:', sig);
    } catch (error) {
      console.error('Error initializing perp market:', error);
      // Try to parse the error
      if (error instanceof Error && error.message.includes('custom program error')) {
        console.error('\nPossible causes:');
        console.error('- Exchange authority mismatch (your wallet must be the exchange authority)');
        console.error('- Invalid parameters');
        console.error('- Account already exists');
      }
      process.exit(1);
    }
  }

  // Check if liquidation config exists
  const liquidationConfigAccount = await connection.getAccountInfo(liquidationConfigPda);
  if (liquidationConfigAccount) {
    console.log('✓ Liquidation config already initialized');
  } else {
    console.log('\n→ Initializing liquidation config...');
    console.log('  Liquidation Bonus:', LIQUIDATION_CONFIG.liquidationBonusBps / 100, '%');
    console.log('  Insurance Fund Share:', LIQUIDATION_CONFIG.insuranceFundShareBps / 100, '%');
    console.log('  ADL Enabled:', LIQUIDATION_CONFIG.adlEnabled);

    const initLiquidationTx = new Transaction().add(
      buildInitLiquidationConfigInstruction(authority.publicKey, insuranceFund)
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, initLiquidationTx, [authority], {
        commitment: 'confirmed',
      });
      console.log('✓ Liquidation config initialized:', sig);
    } catch (error) {
      console.error('Error initializing liquidation config:', error);
      // Non-fatal - perp market can work without liquidation config for basic testing
      console.warn('Warning: Liquidations may not work properly without config');
    }
  }

  console.log('\n=== Initialization Complete ===');
  console.log('\nSOL-PERP Market Details:');
  console.log('  Program ID:', PROGRAM_ID.toString());
  console.log('  Perp Market PDA:', perpMarketPda.toString());
  console.log('  Funding State PDA:', fundingStatePda.toString());
  console.log('  Underlying:', 'SOL (Wrapped SOL)');
  console.log('  Quote:', 'USDC (Dummy USDC devnet)');
  console.log('  Oracle:', PYTH_SOL_USD_FEED.toString());

  console.log('\n📝 Add to frontend/src/lib/constants.ts:');
  console.log(`export const SOL_PERP_MARKET_PDA = '${perpMarketPda.toString()}';`);
  console.log(`export const SOL_PERP_FUNDING_PDA = '${fundingStatePda.toString()}';`);
}

main().catch(console.error);
