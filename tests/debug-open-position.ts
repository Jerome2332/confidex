/**
 * Debug Open Position Transaction
 *
 * This script simulates an open_position transaction to get detailed error information.
 * Usage: npx ts-node tests/debug-open-position.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, NATIVE_MINT } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
const WSOL_MINT = NATIVE_MINT;
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

// PDA seeds
const PERP_MARKET_SEED = Buffer.from('perp_market');
const FUNDING_SEED = Buffer.from('funding');
const POSITION_SEED = Buffer.from('position');

// ============================================================================
// DISCRIMINATOR
// ============================================================================

function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const OPEN_POSITION_DISCRIMINATOR = computeDiscriminator('open_position');

// ============================================================================
// PDA DERIVATION
// ============================================================================

function derivePerpMarketPda(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PERP_MARKET_SEED, underlyingMint.toBuffer()],
    PROGRAM_ID
  );
}

function deriveFundingPda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FUNDING_SEED, perpMarket.toBuffer()],
    PROGRAM_ID
  );
}

function derivePositionPda(
  trader: PublicKey,
  perpMarket: PublicKey,
  positionCount: bigint
): [PublicKey, number] {
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(positionCount);
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, trader.toBuffer(), perpMarket.toBuffer(), countBuf],
    PROGRAM_ID
  );
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Debug Open Position Transaction ===\n');

  // Load keypair
  const keypairPath = path.join(process.env.HOME || '~', '.config/solana/devnet.json');
  if (!fs.existsSync(keypairPath)) {
    console.error('Error: Keypair not found at', keypairPath);
    process.exit(1);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const trader = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log('Trader:', trader.publicKey.toString());

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Derive PDAs
  const [perpMarketPda] = derivePerpMarketPda(WSOL_MINT);
  const [fundingStatePda] = deriveFundingPda(perpMarketPda);

  console.log('\nDerived PDAs:');
  console.log('  Perp Market:', perpMarketPda.toString());
  console.log('  Funding State:', fundingStatePda.toString());

  // Fetch market data
  const marketAccount = await connection.getAccountInfo(perpMarketPda);
  if (!marketAccount) {
    console.error('Perp market not found!');
    process.exit(1);
  }

  // Parse position count (offset 123 in 381-byte struct)
  const data = marketAccount.data;
  const positionCountOffset = 8 + 32 + 32 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 8;
  const positionCount = data.readBigUInt64LE(positionCountOffset);
  console.log('  Position Count:', positionCount.toString());

  // Parse oracle (offset 179)
  const oracleOffset = positionCountOffset + 8 + 8 + 8 + 16 + 16;
  const oracle = new PublicKey(data.slice(oracleOffset, oracleOffset + 32));
  console.log('  Oracle:', oracle.toString());

  // Parse collateral vault (offset 211)
  const collateralVault = new PublicKey(data.slice(oracleOffset + 32, oracleOffset + 64));
  console.log('  Collateral Vault:', collateralVault.toString());

  // Derive position PDA for this trader
  const [positionPda] = derivePositionPda(trader.publicKey, perpMarketPda, positionCount);
  console.log('  Position PDA:', positionPda.toString());

  // Get trader's USDC ATA
  const traderUsdcAta = await getAssociatedTokenAddress(USDC_MINT, trader.publicKey);
  console.log('  Trader USDC ATA:', traderUsdcAta.toString());

  // Check if trader has USDC
  const usdcAccountInfo = await connection.getAccountInfo(traderUsdcAta);
  if (!usdcAccountInfo) {
    console.log('\n⚠️  Trader does not have a USDC token account!');
  } else {
    console.log('  Trader USDC ATA exists, data length:', usdcAccountInfo.data.length);
  }

  // Build instruction data
  // Layout: discriminator(8) + OpenPositionParams serialization
  // OpenPositionParams: side(1) + leverage(1) + encrypted_size(64) + encrypted_collateral(64) +
  //                     encrypted_entry_price(64) + liquidation_threshold(8) + eligibility_proof(388)
  const dataSize = 8 + 1 + 1 + 64 + 64 + 64 + 8 + 388;
  const instructionData = Buffer.alloc(dataSize);
  let offset = 0;

  // Discriminator
  OPEN_POSITION_DISCRIMINATOR.copy(instructionData, offset);
  offset += 8;

  // Side: 0 = Long
  instructionData.writeUInt8(0, offset);
  offset += 1;

  // Leverage: 10x
  instructionData.writeUInt8(10, offset);
  offset += 1;

  // Encrypted size (64 bytes) - dummy hybrid format
  // First 8 bytes: plaintext size (2 SOL = 2_000_000_000 lamports)
  const sizeValue = BigInt(2_000_000_000);
  instructionData.writeBigUInt64LE(sizeValue, offset);
  offset += 64;

  // Encrypted collateral (64 bytes) - dummy hybrid format
  // First 8 bytes: plaintext collateral (20 USDC = 20_000_000 in 6 decimals)
  const collateralValue = BigInt(20_000_000);
  instructionData.writeBigUInt64LE(collateralValue, offset);
  offset += 64;

  // Encrypted entry price (64 bytes) - dummy hybrid format
  // First 8 bytes: plaintext price (e.g., 140 USD = 140_000_000 in 6 decimals)
  const entryPrice = BigInt(140_000_000);
  instructionData.writeBigUInt64LE(entryPrice, offset);
  offset += 64;

  // Liquidation threshold (u64) - calculated as: entry * (1 - 1/leverage + mm_bps/10000)
  // For 10x long, mm=500bps=5%:
  // leverage_factor = 10000/10 = 1000 bps = 10%
  // factor = 10000 - 1000 + 500 = 9500 bps = 95%
  // threshold = 140 * 0.95 = 133
  const leverage = 10;
  const mm_bps = 500; // 5%
  const leverage_factor_bps = 10000 / leverage;
  const factor_bps = 10000 - leverage_factor_bps + mm_bps; // 9500 for 10x long
  const liquidationThreshold = BigInt(Math.floor(Number(entryPrice) * factor_bps / 10000));
  console.log('  Calculated Liq Threshold:', liquidationThreshold.toString(), `(${Number(liquidationThreshold) / 1_000_000} USD)`);
  instructionData.writeBigUInt64LE(liquidationThreshold, offset);
  offset += 8;

  // Eligibility proof (388 bytes) - zero for now (verification disabled)
  // No need to fill, already zeroed

  console.log('\nInstruction data size:', instructionData.length, 'bytes');

  // Build transaction
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: fundingStatePda, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: oracle, isSigner: false, isWritable: false },
      { pubkey: traderUsdcAta, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: trader.publicKey, isSigner: true, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: instructionData,
  });

  const transaction = new Transaction();
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  transaction.add(instruction);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = trader.publicKey;

  console.log('\n=== Simulating Transaction ===\n');

  try {
    // Sign the transaction for simulation
    transaction.sign(trader);

    const simulation = await connection.simulateTransaction(transaction);

    if (simulation.value.err) {
      console.error('❌ SIMULATION FAILED');
      console.error('Error:', JSON.stringify(simulation.value.err, null, 2));

      if (simulation.value.logs) {
        console.log('\nProgram Logs:');
        for (const log of simulation.value.logs) {
          console.log('  ', log);
        }
      }
    } else {
      console.log('✓ Simulation succeeded!');
      console.log('Units consumed:', simulation.value.unitsConsumed);

      if (simulation.value.logs) {
        console.log('\nProgram Logs:');
        for (const log of simulation.value.logs) {
          console.log('  ', log);
        }
      }

      // If simulation passes, try to actually send it
      console.log('\n=== Sending Transaction ===\n');
      transaction.sign(trader);
      const sig = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      });
      console.log('Transaction signature:', sig);

      const confirmation = await connection.confirmTransaction({
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      if (confirmation.value.err) {
        console.error('❌ Transaction failed:', JSON.stringify(confirmation.value.err));
      } else {
        console.log('✓ Transaction confirmed!');
      }
    }
  } catch (error) {
    console.error('Error during simulation:', error);
  }
}

main().catch(console.error);
