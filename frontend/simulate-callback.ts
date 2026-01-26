/**
 * Callback Simulator for MPC Testing
 *
 * This script simulates what an Arcium cluster would do:
 * 1. Reads pending ComputationRequest accounts
 * 2. Extracts encrypted inputs
 * 3. Simulates MPC result (using plaintext from first 8 bytes)
 * 4. Calls process_callback on arcium_mxe
 *
 * For production, this would be handled by Arx nodes in the Arcium cluster.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Configuration
const RPC_URL = 'https://api.devnet.solana.com';
const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
const MXE_CONFIG_PDA = new PublicKey('GqZ3v32aFzr1s5N4vSo6piur8pHuWw4jZpKW5xEy31qK');
const MXE_AUTHORITY_PDA = new PublicKey('9WH1PNEpvHQDLTUm1W3MuwSdsbTtLMK8eoy2SyNBLnyn');

// Seeds
const COMPUTATION_SEED = Buffer.from('computation');
const MXE_AUTHORITY_SEED = Buffer.from('mxe_authority');

// Computation types (must match arcium_mxe state)
enum ComputationType {
  ComparePrices = 0,
  CalculateFill = 1,
  Add = 2,
  Subtract = 3,
  Multiply = 4,
}

// Computation status
enum ComputationStatus {
  Pending = 0,
  Processing = 1,
  Completed = 2,
  Failed = 3,
  Expired = 4,
}

interface ComputationRequest {
  requestId: Uint8Array;
  computationType: ComputationType;
  requester: PublicKey;
  callbackProgram: PublicKey;
  callbackDiscriminator: Uint8Array;
  inputs: Uint8Array;
  status: ComputationStatus;
  createdAt: bigint;
  completedAt: bigint;
  result: Uint8Array;
  callbackAccount1: PublicKey;  // buy_order for order matching
  callbackAccount2: PublicKey;  // sell_order for order matching
  bump: number;
}

function parseComputationRequest(data: Buffer): ComputationRequest {
  let offset = 8; // Skip discriminator

  const requestId = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  const computationType = data.readUInt8(offset) as ComputationType;
  offset += 1;

  const requester = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const callbackProgram = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const callbackDiscriminator = new Uint8Array(data.subarray(offset, offset + 8));
  offset += 8;

  // Vec<u8> - 4 byte length prefix
  const inputsLen = data.readUInt32LE(offset);
  offset += 4;
  const inputs = new Uint8Array(data.subarray(offset, offset + inputsLen));
  offset += inputsLen;

  const status = data.readUInt8(offset) as ComputationStatus;
  offset += 1;

  const createdAt = data.readBigInt64LE(offset);
  offset += 8;

  const completedAt = data.readBigInt64LE(offset);
  offset += 8;

  // Vec<u8> - 4 byte length prefix
  const resultLen = data.readUInt32LE(offset);
  offset += 4;
  const result = new Uint8Array(data.subarray(offset, offset + resultLen));
  offset += resultLen;

  // callback_account_1 (Pubkey)
  const callbackAccount1 = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // callback_account_2 (Pubkey)
  const callbackAccount2 = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const bump = data.readUInt8(offset);

  return {
    requestId,
    computationType,
    requester,
    callbackProgram,
    callbackDiscriminator,
    inputs,
    status,
    createdAt,
    completedAt,
    result,
    callbackAccount1,
    callbackAccount2,
    bump,
  };
}

function deriveComputationPda(index: bigint): [PublicKey, number] {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(index);
  return PublicKey.findProgramAddressSync([COMPUTATION_SEED, indexBuf], MXE_PROGRAM_ID);
}

function extractPlaintext(encrypted: Uint8Array): bigint {
  // In development mode, plaintext is stored in first 8 bytes
  const view = new DataView(encrypted.buffer, encrypted.byteOffset, 8);
  return view.getBigUint64(0, true);
}

function simulateComparePrices(inputs: Uint8Array): Uint8Array {
  // Inputs: 64 bytes buy_price + 64 bytes sell_price
  if (inputs.length < 128) {
    console.error('Invalid inputs length for ComparePrices:', inputs.length);
    return new Uint8Array([0]);
  }

  const buyPrice = extractPlaintext(inputs.slice(0, 64));
  const sellPrice = extractPlaintext(inputs.slice(64, 128));

  console.log('  Simulated comparison:');
  console.log(`    Buy price:  ${buyPrice} (${Number(buyPrice) / 1e6} USDC)`);
  console.log(`    Sell price: ${sellPrice} (${Number(sellPrice) / 1e6} USDC)`);

  const match = buyPrice >= sellPrice;
  console.log(`    Result: ${match ? 'MATCH (buy >= sell)' : 'NO MATCH (buy < sell)'}`);

  return new Uint8Array([match ? 1 : 0]);
}

function simulateCalculateFill(inputs: Uint8Array): Uint8Array {
  // Inputs: buy_amount + buy_filled + sell_amount + sell_filled (4x 64 bytes)
  if (inputs.length < 256) {
    console.error('Invalid inputs length for CalculateFill:', inputs.length);
    return new Uint8Array(66);
  }

  const buyAmount = extractPlaintext(inputs.slice(0, 64));
  const buyFilled = extractPlaintext(inputs.slice(64, 128));
  const sellAmount = extractPlaintext(inputs.slice(128, 192));
  const sellFilled = extractPlaintext(inputs.slice(192, 256));

  const buyRemaining = buyAmount - buyFilled;
  const sellRemaining = sellAmount - sellFilled;
  const fillAmount = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;

  console.log('  Simulated fill calculation:');
  console.log(`    Buy remaining:  ${buyRemaining}`);
  console.log(`    Sell remaining: ${sellRemaining}`);
  console.log(`    Fill amount:    ${fillAmount}`);

  // Result: 64 bytes encrypted fill + 1 byte buy_fully_filled + 1 byte sell_fully_filled
  const result = new Uint8Array(66);
  const fillView = new DataView(result.buffer);
  fillView.setBigUint64(0, fillAmount, true);
  result[64] = fillAmount >= buyRemaining ? 1 : 0;
  result[65] = fillAmount >= sellRemaining ? 1 : 0;

  return result;
}

async function main() {
  // Load keypair (using devnet.json as cluster authority for testing)
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const clusterAuthority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Callback Simulator');
  console.log('==================');
  console.log('Cluster Authority:', clusterAuthority.publicKey.toString());
  console.log('MXE Program:', MXE_PROGRAM_ID.toString());
  console.log();

  const connection = new Connection(RPC_URL, 'confirmed');

  // Fetch MXE config to get computation count
  const configInfo = await connection.getAccountInfo(MXE_CONFIG_PDA);
  if (!configInfo) {
    console.error('MXE Config not found');
    return;
  }

  // Parse computation count
  const computationCount = configInfo.data.readBigUInt64LE(8 + 32 + 32 + 2 + 32);
  console.log('Total computations queued:', computationCount.toString());

  // Find pending computations
  const pendingRequests: { pda: PublicKey; request: ComputationRequest; index: bigint }[] = [];

  for (let i = BigInt(0); i < computationCount; i++) {
    const [pda] = deriveComputationPda(i);
    const accountInfo = await connection.getAccountInfo(pda);

    if (accountInfo) {
      const request = parseComputationRequest(accountInfo.data);
      if (request.status === ComputationStatus.Pending) {
        pendingRequests.push({ pda, request, index: i });
      }
    }
  }

  console.log('Pending computations:', pendingRequests.length);
  console.log();

  if (pendingRequests.length === 0) {
    console.log('No pending computations to process.');
    return;
  }

  // Process each pending request
  for (const { pda, request, index } of pendingRequests) {
    console.log(`\nProcessing computation #${index}:`);
    console.log('  PDA:', pda.toString());
    console.log('  Type:', ComputationType[request.computationType]);
    console.log('  Callback Program:', request.callbackProgram.toString());

    // Simulate the computation
    let result: Uint8Array;
    switch (request.computationType) {
      case ComputationType.ComparePrices:
        result = simulateComparePrices(request.inputs);
        break;
      case ComputationType.CalculateFill:
        result = simulateCalculateFill(request.inputs);
        break;
      default:
        console.log('  Unsupported computation type, skipping...');
        continue;
    }

    console.log('  Result bytes:', Buffer.from(result).toString('hex'));

    // Build process_callback instruction
    // Discriminator: sha256("global:process_callback")[0..8]
    const discriminator = crypto
      .createHash('sha256')
      .update('global:process_callback')
      .digest()
      .subarray(0, 8);

    // Instruction data: discriminator + request_id (32) + result (vec) + success (bool)
    const resultVecLen = Buffer.alloc(4);
    resultVecLen.writeUInt32LE(result.length);

    const instructionData = Buffer.concat([
      discriminator,
      Buffer.from(request.requestId),
      resultVecLen,
      Buffer.from(result),
      Buffer.from([1]), // success = true
    ]);

    // Log callback accounts
    console.log('  Callback Account 1 (buy_order):', request.callbackAccount1.toString());
    console.log('  Callback Account 2 (sell_order):', request.callbackAccount2.toString());

    const processCallbackIx = new TransactionInstruction({
      keys: [
        { pubkey: MXE_CONFIG_PDA, isSigner: false, isWritable: true },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: MXE_AUTHORITY_PDA, isSigner: false, isWritable: false },
        { pubkey: clusterAuthority.publicKey, isSigner: true, isWritable: false },
        { pubkey: request.callbackProgram, isSigner: false, isWritable: false },
        // NEW: Pass callback accounts for the DEX callback
        { pubkey: request.callbackAccount1, isSigner: false, isWritable: true }, // buy_order
        { pubkey: request.callbackAccount2, isSigner: false, isWritable: true }, // sell_order
      ],
      programId: MXE_PROGRAM_ID,
      data: instructionData,
    });

    const tx = new Transaction().add(processCallbackIx);

    console.log('  Sending process_callback transaction...');

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [clusterAuthority], {
        commitment: 'confirmed',
      });

      console.log('  SUCCESS:', sig);
      console.log(`  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    } catch (error) {
      console.error('  FAILED:', error);

      if (error instanceof Error && 'logs' in error) {
        console.log('  Logs:', (error as { logs?: string[] }).logs);
      }
    }
  }

  console.log('\n=== Callback Simulation Complete ===');
}

main().catch(console.error);
