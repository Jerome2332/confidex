/**
 * Test V8 Position Opening
 *
 * This script tests that new positions created with the V8 format
 * include the full 32-byte ephemeral pubkey for MPC decryption.
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
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// SOL-PERP market underlying mint (Wrapped SOL)
const UNDERLYING_MINT = new PublicKey('So11111111111111111111111111111111111111112');
// Quote mint (USDC)
const QUOTE_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Discriminators
function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const OPEN_POSITION_DISCRIMINATOR = getDiscriminator('open_position');

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

function derivePositionPda(
  trader: PublicKey,
  market: PublicKey,
  positionCount: bigint
): [PublicKey, number] {
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(positionCount);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), trader.toBuffer(), market.toBuffer(), countBuf],
    DEX_PROGRAM_ID
  );
}

function deriveTraderEligibilityPda(trader: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('trader_eligibility'), trader.toBuffer()],
    DEX_PROGRAM_ID
  );
}

function deriveFundingPda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('funding'), perpMarket.toBuffer()],
    DEX_PROGRAM_ID
  );
}

function deriveVaultAuthorityPda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), perpMarket.toBuffer()],
    DEX_PROGRAM_ID
  );
}

async function main() {
  console.log('=== V8 Position Opening Test ===\n');

  // Load keypair
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const traderKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Trader wallet:', traderKeypair.publicKey.toString());

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [perpMarketPda] = derivePerpMarketPda(UNDERLYING_MINT);
  const [fundingStatePda] = deriveFundingPda(perpMarketPda);
  const [vaultAuthorityPda] = deriveVaultAuthorityPda(perpMarketPda);
  const [eligibilityPda] = deriveTraderEligibilityPda(traderKeypair.publicKey);

  console.log('Exchange PDA:', exchangePda.toString());
  console.log('Perp Market PDA:', perpMarketPda.toString());
  console.log('Funding State PDA:', fundingStatePda.toString());
  console.log('Eligibility PDA:', eligibilityPda.toString());

  // Check eligibility
  const eligibilityInfo = await connection.getAccountInfo(eligibilityPda);
  if (!eligibilityInfo) {
    console.error('\nERROR: Trader eligibility not verified.');
    console.log('You need to verify eligibility via the frontend or a separate script.');
    console.log('This requires generating and submitting a ZK proof of eligibility.');
    return;
  }
  console.log('✓ Trader eligibility verified');

  // Get market data to find position count
  const marketInfo = await connection.getAccountInfo(perpMarketPda);
  if (!marketInfo) {
    throw new Error('Perp market not found');
  }

  // Read position count from market data (offset based on struct layout)
  // After: underlying_mint(32) + quote_mint(32) + max_leverage(1) + margins(6) + fees(6) +
  //        min_pos(8) + tick(8) + max_oi(8) + long_oi(8) + short_oi(8) = position_count offset 117
  const positionCountOffset = 8 + 32 + 32 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 8;
  const positionCount = marketInfo.data.readBigUInt64LE(positionCountOffset);
  console.log('Current position count:', positionCount.toString());

  // Derive position PDA for the NEW position
  const [positionPda] = derivePositionPda(
    traderKeypair.publicKey,
    perpMarketPda,
    positionCount
  );
  console.log('New position PDA:', positionPda.toString());

  // Read oracle address from market (offset 211 - 32 = 179)
  const oracleOffset = 211 - 32;
  const oraclePriceFeed = new PublicKey(marketInfo.data.slice(oracleOffset, oracleOffset + 32));
  console.log('Oracle price feed:', oraclePriceFeed.toString());

  // Read collateral vault from market (offset 211)
  const collateralVaultOffset = 211;
  const collateralVault = new PublicKey(marketInfo.data.slice(collateralVaultOffset, collateralVaultOffset + 32));
  console.log('Collateral vault:', collateralVault.toString());

  // Get trader's USDC ATA
  const traderCollateralAta = await getAssociatedTokenAddress(QUOTE_MINT, traderKeypair.publicKey);
  console.log('Trader USDC ATA:', traderCollateralAta.toString());

  // Check trader's USDC balance
  const traderAtaInfo = await connection.getAccountInfo(traderCollateralAta);
  if (!traderAtaInfo) {
    console.error('\nERROR: No USDC token account found.');
    console.log('Please get devnet USDC first.');
    return;
  }

  const tokenBalance = await connection.getTokenAccountBalance(traderCollateralAta);
  console.log('Trader USDC balance:', tokenBalance.value.uiAmountString);

  // Position parameters
  const side = 0; // Long
  const leverage = 2;
  const collateralAmount = BigInt(5_000_000); // 5 USDC

  // Generate random encrypted values (in real usage these come from RescueCipher)
  const encryptedSize = crypto.randomBytes(64);
  const encryptedEntryPrice = crypto.randomBytes(64);

  // Generate a proper 32-byte ephemeral pubkey (simulating X25519)
  const ephemeralPubkey = crypto.randomBytes(32);
  console.log('\nEphemeral pubkey (32 bytes):', ephemeralPubkey.toString('hex'));

  // Generate random position nonce
  const positionNonce = crypto.randomBytes(16);

  // Build instruction data
  // V8 OpenPositionParams (from perp_open_position.rs):
  // - side: PositionSide (1 byte enum)
  // - leverage: u8 (1)
  // - collateral_amount: u64 (8)
  // - position_nonce: [u8; 8] (8, NOT 16!)
  // - encrypted_size: [u8; 64] (64)
  // - encrypted_entry_price: [u8; 64] (64)
  // - ephemeral_pubkey: [u8; 32] (32)
  // Total: 1 + 1 + 8 + 8 + 64 + 64 + 32 = 178 bytes
  const instructionData = Buffer.alloc(8 + 178);
  let offset = 0;

  // Discriminator
  OPEN_POSITION_DISCRIMINATOR.copy(instructionData, offset);
  offset += 8;

  // side (PositionSide enum: 0 = Long, 1 = Short)
  instructionData.writeUInt8(side, offset);
  offset += 1;

  // leverage
  instructionData.writeUInt8(leverage, offset);
  offset += 1;

  // collateral_amount
  instructionData.writeBigUInt64LE(collateralAmount, offset);
  offset += 8;

  // position_nonce (8 bytes, not 16)
  positionNonce.slice(0, 8).copy(instructionData, offset);
  offset += 8;

  // encrypted_size
  encryptedSize.copy(instructionData, offset);
  offset += 64;

  // encrypted_entry_price
  encryptedEntryPrice.copy(instructionData, offset);
  offset += 64;

  // ephemeral_pubkey (V8 - full 32 bytes)
  ephemeralPubkey.copy(instructionData, offset);
  offset += 32;

  console.log('\nInstruction data length:', instructionData.length);
  console.log('Expected V8 params length:', 8 + 178);

  // Arcium program for MPC (using placeholder for now)
  const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

  // Build transaction
  // Account order from OpenPosition struct:
  // 1. exchange
  // 2. eligibility
  // 3. perp_market
  // 4. funding_state
  // 5. position
  // 6. oracle
  // 7. trader_collateral_account
  // 8. collateral_vault
  // 9. trader (signer)
  // 10. arcium_program
  // 11. token_program
  // 12. system_program
  const ix = new TransactionInstruction({
    programId: DEX_PROGRAM_ID,
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: eligibilityPda, isSigner: false, isWritable: false },
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: fundingStatePda, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: oraclePriceFeed, isSigner: false, isWritable: false },
      { pubkey: traderCollateralAta, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: traderKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(ix);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = traderKeypair.publicKey;

  // Sign first, then simulate
  tx.sign(traderKeypair);

  // Simulate
  console.log('\nSimulating transaction...');
  try {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      console.log('Simulation failed:', JSON.stringify(sim.value.err));
      console.log('Logs:', sim.value.logs?.slice(-15).join('\n'));
      return;
    }
    console.log('✓ Simulation success! Units consumed:', sim.value.unitsConsumed);
  } catch (simError) {
    console.log('Simulation error:', simError);
    return;
  }
  console.log('\nSending transaction...');

  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('Tx signature:', signature);

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    console.log('\n✓ Position opened successfully!');

    // Verify the position was created with V8 format (724 bytes)
    const positionInfo = await connection.getAccountInfo(positionPda);
    if (positionInfo) {
      console.log('\nPosition account size:', positionInfo.data.length, 'bytes');
      console.log('Expected V8 size: 724 bytes');

      if (positionInfo.data.length === 724) {
        console.log('✓ Position is V8 format!');

        // Read the ephemeral pubkey from position (offset depends on struct layout)
        // After all encrypted fields + status fields, ephemeral_pubkey is at the end
        // V8 layout: ... + ephemeral_pubkey(32) at offset 692
        const storedEphemeralOffset = 692;
        const storedEphemeral = positionInfo.data.slice(storedEphemeralOffset, storedEphemeralOffset + 32);
        console.log('\nStored ephemeral pubkey:', Buffer.from(storedEphemeral).toString('hex'));
        console.log('Original ephemeral pubkey:', ephemeralPubkey.toString('hex'));

        if (Buffer.compare(storedEphemeral, ephemeralPubkey) === 0) {
          console.log('✓ Ephemeral pubkey matches! MPC decryption will work.');
        } else {
          console.log('✗ Ephemeral pubkey mismatch!');
        }
      } else if (positionInfo.data.length === 692) {
        console.log('✗ Position is V7 format (old) - ephemeral pubkey not stored');
      } else {
        console.log('? Unknown position format');
      }
    }
  } catch (sendError: any) {
    console.log('Send error:', sendError.message);
    if (sendError.logs) {
      console.log('Logs:', sendError.logs.slice(-10).join('\n'));
    }
  }
}

main().catch(console.error);
