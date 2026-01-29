/**
 * Arcium Account Derivation Module
 *
 * Centralized derivation of all 11 Arcium MXE infrastructure accounts required
 * for queue_computation instructions. Uses the official @arcium-hq/client SDK.
 *
 * Account Order (matches Rust match_orders.rs remaining_accounts[0..10]):
 *   0. sign_pda_account    - [b"ArciumSignerAccount"] @ MXE program
 *   1. mxe_account         - getMXEAccAddress(mxeProgramId)
 *   2. mempool_account     - getMempoolAccAddress(clusterOffset)
 *   3. executing_pool      - getExecutingPoolAccAddress(clusterOffset)
 *   4. computation_account - getComputationAccAddress(clusterOffset, offset)
 *   5. comp_def_account    - getCompDefAccAddress(mxeProgramId, compDefOffset)
 *   6. cluster_account     - getClusterAccAddress(clusterOffset)
 *   7. pool_account        - getFeePoolAccAddress()
 *   8. clock_account       - getClockAccAddress()
 *   9. arcium_program      - ARCIUM_ADDR (Arcj82pX...)
 *  10. mxe_program         - MXE Program ID (4pdgnqNQ...)
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';

// Arcium SDK imports
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
  ARCIUM_ADDR,
} from '@arcium-hq/client';

/**
 * All 11 Arcium MXE accounts required for queue_computation instructions
 *
 * Account order matches Rust match_orders.rs remaining_accounts[0..10]:
 *   0. sign_pda_account    - [b"ArciumSignerAccount"] @ MXE program
 *   1. mxe_account         - getMXEAccAddress(mxeProgramId)
 *   2. mempool_account     - getMempoolAccAddress(clusterOffset)
 *   3. executing_pool      - getExecutingPoolAccAddress(clusterOffset)
 *   4. computation_account - getComputationAccAddress(clusterOffset, offset)
 *   5. comp_def_account    - getCompDefAccAddress(mxeProgramId, compDefOffset)
 *   6. cluster_account     - getClusterAccAddress(clusterOffset)
 *   7. pool_account        - getFeePoolAccAddress()
 *   8. clock_account       - getClockAccAddress()
 *   9. arcium_program      - ARCIUM_ADDR (Arcj82pX...)
 *  10. mxe_program         - MXE Program ID (4pdgnqNQ...)
 */
export interface ArciumMxeAccounts {
  /** Index 0: Signer PDA for MXE program [b"ArciumSignerAccount"] */
  signPdaAccount: PublicKey;
  /** Index 1: MXE account (program state) */
  mxeAccount: PublicKey;
  /** Index 2: Cluster mempool for pending computations */
  mempoolAccount: PublicKey;
  /** Index 3: Executing pool for in-flight computations */
  executingPool: PublicKey;
  /** Index 4: Computation account for this specific computation */
  computationAccount: PublicKey;
  /** Index 5: Computation definition account (circuit metadata) */
  compDefAccount: PublicKey;
  /** Index 6: Cluster account (MPC cluster state) */
  clusterAccount: PublicKey;
  /** Index 7: Arcium fee pool */
  poolAccount: PublicKey;
  /** Index 8: Arcium clock account */
  clockAccount: PublicKey;
  /** Index 9: Arcium core program (CPI target) */
  arciumProgram: PublicKey;
  /** Index 10: MXE program (the confidex_mxe deployed via arcium deploy) */
  mxeProgram: PublicKey;
}

/**
 * Default cluster offset for devnet (cluster 456 = Arcium v0.6.3)
 */
export const DEFAULT_CLUSTER_OFFSET = 456;

/**
 * Default MXE Program ID (confidex_mxe deployed via `arcium deploy`)
 */
export const DEFAULT_MXE_PROGRAM_ID = new PublicKey(
  process.env.FULL_MXE_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ||
    '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'
);

/**
 * Arcium Core Program ID
 */
export const ARCIUM_PROGRAM_ID = new PublicKey(ARCIUM_ADDR);

/**
 * Get computation definition offset for compare_prices circuit
 * Uses sha256("compare_prices")[0..4] as little-endian u32
 */
export function getComparePricesCompDefOffset(): number {
  const offsetBytes = getCompDefAccOffset('compare_prices');
  return Buffer.from(offsetBytes).readUInt32LE(0);
}

/**
 * Derive the signer PDA for an MXE program
 *
 * Seeds: [b"ArciumSignerAccount"]
 * Program: mxeProgramId
 */
export function deriveSignPdaAccount(mxeProgramId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    mxeProgramId
  );
  return pda;
}

/**
 * Derive all 11 Arcium MXE accounts needed for match_orders remaining_accounts
 *
 * @param mxeProgramId - The confidex_mxe program ID
 * @param clusterOffset - The Arcium cluster offset (456 for devnet v0.6.3)
 * @param computationOffset - Random offset for this computation
 * @returns All 11 accounts in the correct order for remaining_accounts
 */
export function deriveArciumAccounts(
  mxeProgramId: PublicKey,
  clusterOffset: number,
  computationOffset: BN,
  compDefOffset?: number
): ArciumMxeAccounts {
  // Use provided compDefOffset or default to compare_prices
  const offset = compDefOffset ?? getComparePricesCompDefOffset();

  return {
    signPdaAccount: deriveSignPdaAccount(mxeProgramId),
    mxeAccount: getMXEAccAddress(mxeProgramId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
    compDefAccount: getCompDefAccAddress(mxeProgramId, offset),
    clusterAccount: getClusterAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
    arciumProgram: ARCIUM_PROGRAM_ID,
    mxeProgram: mxeProgramId, // The MXE program is the CPI target for queue_computation
  };
}

/**
 * Convert ArciumMxeAccounts to an array of AccountMeta for remaining_accounts
 *
 * The order must match match_orders.rs remaining_accounts[0..10]:
 *   0: sign_pda_account (mut)
 *   1: mxe_account (mut)
 *   2: mempool_account (mut)
 *   3: executing_pool (mut)
 *   4: computation_account (mut)
 *   5: comp_def_account (readonly)
 *   6: cluster_account (mut)
 *   7: pool_account (mut)
 *   8: clock_account (mut)
 *   9: arcium_program (readonly) - Arcj82pX...
 *  10: mxe_program (readonly) - 4pdgnqNQ...
 */
export function arciumAccountsToRemainingAccounts(
  accounts: ArciumMxeAccounts
): Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> {
  return [
    { pubkey: accounts.signPdaAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.mxeAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.mempoolAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.executingPool, isSigner: false, isWritable: true },
    { pubkey: accounts.computationAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.compDefAccount, isSigner: false, isWritable: false },
    { pubkey: accounts.clusterAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.poolAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.clockAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.arciumProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.mxeProgram, isSigner: false, isWritable: false },
  ];
}

/**
 * Convert ArciumMxeAccounts to account array for DIRECT MXE calls (not CPI)
 *
 * This is for perpetuals operations where backend calls MXE directly.
 * The order matches the queue_computation_accounts macro in MXE lib.rs:
 *
 *   0: sign_pda_account (mut)
 *   1: mxe_account (mut)
 *   2: mempool_account (mut)
 *   3: executing_pool (mut)
 *   4: computation_account (mut)
 *   5: comp_def_account (readonly)
 *   6: cluster_account (mut)
 *   7: pool_account (mut)
 *   8: clock_account (mut)
 *   9: system_program (readonly) - CRITICAL: Must be SystemProgram.programId
 *  10: arcium_program (readonly) - Arcj82pX...
 *
 * NOTE: This differs from arciumAccountsToRemainingAccounts which is for
 * CPI scenarios (DEX → MXE) where mxe_program is needed at position 10.
 */
export function arciumAccountsForDirectMxeCall(
  accounts: ArciumMxeAccounts
): Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> {
  return [
    { pubkey: accounts.signPdaAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.mxeAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.mempoolAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.executingPool, isSigner: false, isWritable: true },
    { pubkey: accounts.computationAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.compDefAccount, isSigner: false, isWritable: false },
    { pubkey: accounts.clusterAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.poolAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.clockAccount, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: accounts.arciumProgram, isSigner: false, isWritable: false },
  ];
}

/**
 * Log all derived Arcium accounts for debugging
 */
export function logArciumAccounts(accounts: ArciumMxeAccounts, prefix: string = ''): void {
  console.log(`${prefix}Arcium MXE Accounts:`);
  console.log(`${prefix}  [0] signPdaAccount:     ${accounts.signPdaAccount.toBase58()}`);
  console.log(`${prefix}  [1] mxeAccount:         ${accounts.mxeAccount.toBase58()}`);
  console.log(`${prefix}  [2] mempoolAccount:     ${accounts.mempoolAccount.toBase58()}`);
  console.log(`${prefix}  [3] executingPool:      ${accounts.executingPool.toBase58()}`);
  console.log(`${prefix}  [4] computationAccount: ${accounts.computationAccount.toBase58()}`);
  console.log(`${prefix}  [5] compDefAccount:     ${accounts.compDefAccount.toBase58()}`);
  console.log(`${prefix}  [6] clusterAccount:     ${accounts.clusterAccount.toBase58()}`);
  console.log(`${prefix}  [7] poolAccount:        ${accounts.poolAccount.toBase58()}`);
  console.log(`${prefix}  [8] clockAccount:       ${accounts.clockAccount.toBase58()}`);
  console.log(`${prefix}  [9] arciumProgram:      ${accounts.arciumProgram.toBase58()}`);
  console.log(`${prefix}  [10] mxeProgram:        ${accounts.mxeProgram.toBase58()}`);
}
