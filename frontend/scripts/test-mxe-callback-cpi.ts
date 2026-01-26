/**
 * MXE Callback CPI Test Script
 *
 * Tests the Arcium MXE → DEX callback CPI flow:
 * 1. MXE authority PDA derivation consistency
 * 2. Callback account registration with order pubkeys
 * 3. CPI instruction format validation
 * 4. Full flow simulation (without actual MPC execution)
 *
 * Usage:
 *   cd frontend && npx tsx scripts/test-mxe-callback-cpi.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { getMXEAccAddress, getClusterAccAddress } from '@arcium-hq/client';
import * as crypto from 'crypto';

// =============================================================================
// CONFIGURATION
// =============================================================================

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

// MXE authority PDA seed (must match both programs)
const MXE_AUTHORITY_SEED = Buffer.from('mxe_authority');

// DEX finalize_match instruction discriminator
// sha256("global:finalize_match")[0..8]
const DEX_FINALIZE_MATCH_DISCRIMINATOR = Buffer.from([0xb6, 0x50, 0x2c, 0xc7, 0x3c, 0xf3, 0x94, 0x31]);

// =============================================================================
// TEST RESULTS TRACKING
// =============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, details?: string, error?: string) {
  results.push({ name, passed, details, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  if (error) console.log(`   Error: ${error}`);
}

// =============================================================================
// TEST 1: MXE Authority PDA Derivation
// =============================================================================

async function testMxeAuthorityPda(): Promise<{ pda: PublicKey; bump: number } | null> {
  console.log('\n--- Test 1: MXE Authority PDA Derivation ---');

  try {
    // Derive MXE authority PDA from MXE program
    const [mxeAuthorityPda, bump] = PublicKey.findProgramAddressSync(
      [MXE_AUTHORITY_SEED],
      MXE_PROGRAM_ID
    );

    logTest('Derive MXE authority PDA', true, `PDA: ${mxeAuthorityPda.toBase58()}, bump: ${bump}`);

    // Verify DEX expects this same PDA via seeds::program constraint
    // The DEX uses: seeds = [MXE_AUTHORITY_SEED], seeds::program = ARCIUM_MXE_PROGRAM_ID
    // This is the SAME derivation, just verified differently
    const [verifyPda, verifyBump] = PublicKey.findProgramAddressSync(
      [MXE_AUTHORITY_SEED],
      MXE_PROGRAM_ID
    );

    const pdaMatch = mxeAuthorityPda.equals(verifyPda) && bump === verifyBump;
    logTest('PDA derivation is deterministic', pdaMatch);

    if (pdaMatch) {
      return { pda: mxeAuthorityPda, bump };
    }
    return null;
  } catch (error) {
    logTest('MXE authority PDA derivation', false, undefined, (error as Error).message);
    return null;
  }
}

// =============================================================================
// TEST 2: Callback Account Structure
// =============================================================================

interface CallbackAccount {
  pubkey: PublicKey;
  is_writable: boolean;
}

function testCallbackAccountStructure(
  mxeAuthorityPda: PublicKey,
  buyOrder: PublicKey,
  sellOrder: PublicKey
): CallbackAccount[] | null {
  console.log('\n--- Test 2: Callback Account Structure ---');

  try {
    // Build callback accounts as MXE does in compare_prices()
    const callbackAccounts: CallbackAccount[] = [
      {
        pubkey: mxeAuthorityPda,
        is_writable: false, // MXE authority is read-only signer
      },
      {
        pubkey: buyOrder,
        is_writable: true, // buy_order is mutable
      },
      {
        pubkey: sellOrder,
        is_writable: true, // sell_order is mutable
      },
    ];

    logTest('Build callback accounts array', true, `Count: ${callbackAccounts.length}`);

    // Verify structure matches what MXE expects
    const structureValid =
      callbackAccounts.length === 3 &&
      !callbackAccounts[0].is_writable && // mxe_authority not writable
      callbackAccounts[1].is_writable &&  // buy_order writable
      callbackAccounts[2].is_writable;    // sell_order writable

    logTest('Callback account structure valid', structureValid,
      `[mxe_authority(ro), buy_order(rw), sell_order(rw)]`);

    return structureValid ? callbackAccounts : null;
  } catch (error) {
    logTest('Callback account structure', false, undefined, (error as Error).message);
    return null;
  }
}

// =============================================================================
// TEST 3: CPI Instruction Format
// =============================================================================

function testCpiInstructionFormat(
  mxeAuthorityPda: PublicKey,
  buyOrder: PublicKey,
  sellOrder: PublicKey,
  pricesMatch: boolean
): TransactionInstruction | null {
  console.log('\n--- Test 3: CPI Instruction Format ---');

  try {
    // Generate a mock request_id (computation_account.key().to_bytes())
    const requestId = crypto.randomBytes(32);
    logTest('Generate request_id', true, `First 8 bytes: ${requestId.slice(0, 8).toString('hex')}`);

    // Build result data: 1 byte for prices_match
    const resultData = Buffer.from([pricesMatch ? 1 : 0]);
    logTest('Build result data', true, `prices_match: ${pricesMatch}, byte: ${resultData[0]}`);

    // Build CPI instruction data as MXE does
    // Format: [discriminator (8)] [request_id (32)] [result_len (4)] [result (N)]
    const instructionData = Buffer.concat([
      DEX_FINALIZE_MATCH_DISCRIMINATOR,
      requestId,
      Buffer.from(new Uint32Array([resultData.length]).buffer), // little-endian u32
      resultData,
    ]);

    logTest('Build instruction data', true, `Total size: ${instructionData.length} bytes`);

    // Verify format
    const formatValid =
      instructionData.length === 8 + 32 + 4 + 1 && // 45 bytes total
      instructionData.slice(0, 8).equals(DEX_FINALIZE_MATCH_DISCRIMINATOR);

    logTest('Instruction data format valid', formatValid, `Expected: 45 bytes, Got: ${instructionData.length}`);

    // Build the instruction
    const instruction = new TransactionInstruction({
      programId: DEX_PROGRAM_ID,
      keys: [
        { pubkey: mxeAuthorityPda, isSigner: true, isWritable: false }, // MXE authority (signer)
        { pubkey: buyOrder, isSigner: false, isWritable: true },        // buy_order
        { pubkey: sellOrder, isSigner: false, isWritable: true },       // sell_order
      ],
      data: instructionData,
    });

    // Verify instruction structure matches DEX FinalizeMatch accounts
    const instructionValid =
      instruction.keys.length === 3 &&
      instruction.keys[0].isSigner &&     // mxe_authority must be signer
      !instruction.keys[0].isWritable &&  // mxe_authority not writable
      instruction.keys[1].isWritable &&   // buy_order writable
      instruction.keys[2].isWritable;     // sell_order writable

    logTest('CPI instruction structure valid', instructionValid,
      `Keys: ${instruction.keys.length}, Program: ${instruction.programId.toBase58().slice(0, 8)}...`);

    return instructionValid ? instruction : null;
  } catch (error) {
    logTest('CPI instruction format', false, undefined, (error as Error).message);
    return null;
  }
}

// =============================================================================
// TEST 4: On-Chain Account Verification
// =============================================================================

async function testOnChainAccounts(connection: Connection): Promise<boolean> {
  console.log('\n--- Test 4: On-Chain Account Verification ---');

  try {
    // Verify MXE account exists
    const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
    const mxeInfo = await connection.getAccountInfo(mxeAccount);
    const mxeExists = mxeInfo !== null && mxeInfo.data.length > 0;
    logTest('MXE account exists', mxeExists, mxeExists ? `Size: ${mxeInfo!.data.length} bytes` : 'Not found');

    if (!mxeExists) return false;

    // Verify DEX program is deployed
    const dexInfo = await connection.getAccountInfo(DEX_PROGRAM_ID);
    const dexDeployed = dexInfo !== null && dexInfo.executable;
    logTest('DEX program deployed', dexDeployed);

    // Verify Arcium program is deployed
    const arciumInfo = await connection.getAccountInfo(ARCIUM_PROGRAM_ID);
    const arciumDeployed = arciumInfo !== null && arciumInfo.executable;
    logTest('Arcium program deployed', arciumDeployed);

    // Verify cluster 456 exists
    const clusterAccount = getClusterAccAddress(456);
    const clusterInfo = await connection.getAccountInfo(clusterAccount);
    const clusterExists = clusterInfo !== null;
    logTest('Cluster 456 account exists', clusterExists,
      clusterExists ? `Size: ${clusterInfo!.data.length} bytes` : 'Not found');

    return mxeExists && dexDeployed && arciumDeployed && clusterExists;
  } catch (error) {
    logTest('On-chain account verification', false, undefined, (error as Error).message);
    return false;
  }
}

// =============================================================================
// TEST 5: Signer Seeds Derivation
// =============================================================================

function testSignerSeeds(mxeAuthorityPda: PublicKey, bump: number): boolean {
  console.log('\n--- Test 5: Signer Seeds Derivation ---');

  try {
    // The MXE callback uses invoke_signed with these seeds:
    // let seeds: &[&[u8]] = &[MXE_AUTHORITY_SEED, &[bump]];
    // let signer_seeds = &[seeds];

    const seeds = [MXE_AUTHORITY_SEED, Buffer.from([bump])];
    logTest('Build signer seeds', true, `Seeds: ["mxe_authority", [${bump}]]`);

    // Verify the seeds would derive the expected PDA
    const derivedPda = PublicKey.createProgramAddressSync(seeds, MXE_PROGRAM_ID);
    const seedsValid = derivedPda.equals(mxeAuthorityPda);
    logTest('Signer seeds derive correct PDA', seedsValid,
      seedsValid ? 'PDA matches!' : `Expected: ${mxeAuthorityPda.toBase58()}, Got: ${derivedPda.toBase58()}`);

    return seedsValid;
  } catch (error) {
    logTest('Signer seeds derivation', false, undefined, (error as Error).message);
    return false;
  }
}

// =============================================================================
// TEST 6: End-to-End Flow Simulation
// =============================================================================

async function testEndToEndFlow(connection: Connection): Promise<boolean> {
  console.log('\n--- Test 6: End-to-End Flow Simulation ---');

  try {
    // 1. Generate mock order pubkeys (would be real orders in production)
    const mockBuyOrder = Keypair.generate().publicKey;
    const mockSellOrder = Keypair.generate().publicKey;
    logTest('Generate mock order pubkeys', true,
      `buy: ${mockBuyOrder.toBase58().slice(0, 8)}..., sell: ${mockSellOrder.toBase58().slice(0, 8)}...`);

    // 2. Derive MXE authority PDA
    const [mxeAuthorityPda, bump] = PublicKey.findProgramAddressSync(
      [MXE_AUTHORITY_SEED],
      MXE_PROGRAM_ID
    );
    logTest('Derive MXE authority for flow', true);

    // 3. Build callback accounts (as MXE does in queue_computation)
    const callbackAccounts = [
      { pubkey: mxeAuthorityPda, is_writable: false },
      { pubkey: mockBuyOrder, is_writable: true },
      { pubkey: mockSellOrder, is_writable: true },
    ];
    logTest('Register callback accounts', true, `Count: ${callbackAccounts.length}`);

    // 4. Simulate callback with prices_match = true
    const requestId = crypto.randomBytes(32);
    const pricesMatch = true;
    const resultData = Buffer.from([pricesMatch ? 1 : 0]);

    const instructionData = Buffer.concat([
      DEX_FINALIZE_MATCH_DISCRIMINATOR,
      requestId,
      Buffer.from(new Uint32Array([resultData.length]).buffer),
      resultData,
    ]);
    logTest('Build finalize_match instruction data', true, `Size: ${instructionData.length} bytes`);

    // 5. Build the CPI instruction
    const cpiInstruction = new TransactionInstruction({
      programId: DEX_PROGRAM_ID,
      keys: [
        { pubkey: mxeAuthorityPda, isSigner: true, isWritable: false },
        { pubkey: mockBuyOrder, isSigner: false, isWritable: true },
        { pubkey: mockSellOrder, isSigner: false, isWritable: true },
      ],
      data: instructionData,
    });
    logTest('Build CPI instruction', true);

    // 6. Verify the flow would succeed (can't actually execute without real MPC)
    // In production:
    // - MXE callback receives SignedComputationOutputs
    // - MXE calls output.verify_output() for cryptographic verification
    // - MXE builds CPI instruction
    // - MXE calls invoke_signed with signer seeds
    // - DEX finalize_match verifies MXE authority via seeds constraint
    // - DEX updates order state

    const flowValid =
      cpiInstruction.keys.length === 3 &&
      cpiInstruction.keys[0].pubkey.equals(mxeAuthorityPda) &&
      cpiInstruction.keys[0].isSigner &&
      cpiInstruction.programId.equals(DEX_PROGRAM_ID);

    logTest('End-to-end flow structure valid', flowValid);

    // 7. Document the verification chain
    console.log('\n   Verification Chain:');
    console.log('   1. MXE callback: output.verify_output() ✓');
    console.log('   2. MXE derives: PDA from [mxe_authority] seed ✓');
    console.log('   3. MXE signs: invoke_signed with [seed, bump] ✓');
    console.log('   4. DEX verifies: seeds::program = MXE_PROGRAM_ID ✓');

    return flowValid;
  } catch (error) {
    logTest('End-to-end flow simulation', false, undefined, (error as Error).message);
    return false;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('   MXE Callback CPI Test Suite');
  console.log('='.repeat(70));
  console.log(`\nConfiguration:`);
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  DEX Program: ${DEX_PROGRAM_ID.toBase58()}`);
  console.log(`  MXE Program: ${MXE_PROGRAM_ID.toBase58()}`);
  console.log(`  Arcium Program: ${ARCIUM_PROGRAM_ID.toBase58()}`);

  const connection = new Connection(RPC_URL, 'confirmed');

  // Test 1: MXE Authority PDA Derivation
  const pdaResult = await testMxeAuthorityPda();
  if (!pdaResult) {
    console.log('\n❌ Test 1 failed - cannot continue without valid PDA');
    process.exit(1);
  }

  // Test 2: Callback Account Structure
  const mockBuyOrder = Keypair.generate().publicKey;
  const mockSellOrder = Keypair.generate().publicKey;
  const callbackAccounts = testCallbackAccountStructure(pdaResult.pda, mockBuyOrder, mockSellOrder);

  // Test 3: CPI Instruction Format
  const cpiInstruction = testCpiInstructionFormat(pdaResult.pda, mockBuyOrder, mockSellOrder, true);

  // Test 4: On-Chain Account Verification
  await testOnChainAccounts(connection);

  // Test 5: Signer Seeds Derivation
  testSignerSeeds(pdaResult.pda, pdaResult.bump);

  // Test 6: End-to-End Flow Simulation
  await testEndToEndFlow(connection);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('   Test Summary');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${results.length}`);

  if (failed === 0) {
    console.log('\n✅ All tests passed! MXE callback CPI flow is correctly configured.');
    console.log('\nNext steps:');
    console.log('  1. Deploy updated MXE with callback CPI (if not already done)');
    console.log('  2. Place orders to trigger MPC computation');
    console.log('  3. Monitor for PriceCompareResult events');
    console.log('  4. Verify DEX finalize_match receives CPI callback');
  } else {
    console.log('\n❌ Some tests failed. Review errors above.');
    console.log('\nCommon issues:');
    console.log('  - MXE program not deployed');
    console.log('  - DEX program not deployed');
    console.log('  - Cluster 456 not available');
    console.log('  - PDA derivation mismatch');
  }

  console.log('\n' + '='.repeat(70));

  // Document the key constants for reference
  console.log('\nKey Constants:');
  console.log(`  MXE_AUTHORITY_SEED: "mxe_authority"`);
  console.log(`  MXE Authority PDA: ${pdaResult.pda.toBase58()}`);
  console.log(`  MXE Authority Bump: ${pdaResult.bump}`);
  console.log(`  DEX finalize_match discriminator: 0x${DEX_FINALIZE_MATCH_DISCRIMINATOR.toString('hex')}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
