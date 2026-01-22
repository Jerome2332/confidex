/**
 * Arcium Account Derivation Module (Frontend)
 *
 * Centralized derivation of all 11 Arcium MXE infrastructure accounts required
 * for async MPC operations like initiate_close_position.
 *
 * Account Order (must match Rust struct remaining_accounts):
 *   0. sign_pda_account    - [b"ArciumSignerAccount"] @ MXE program
 *   1. mxe_account         - getMXEAccAddress(mxeProgramId)
 *   2. mempool_account     - getMempoolAccAddress(clusterOffset)
 *   3. executing_pool      - getExecutingPoolAccAddress(clusterOffset)
 *   4. computation_account - getComputationAccAddress(clusterOffset, offset)
 *   5. comp_def_account    - getCompDefAccAddress(mxeProgramId, compDefOffset)
 *   6. cluster_account     - getClusterAccAddress(clusterOffset)
 *   7. pool_account        - getFeePoolAccAddress()
 *   8. clock_account       - getClockAccAddress()
 *   9. arcium_program      - ARCIUM_ADDR
 *  10. mxe_program         - mxeProgramId
 */

import { PublicKey } from '@solana/web3.js';
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
import BN from 'bn.js';
import {
  MXE_PROGRAM_ID,
  ARCIUM_PROGRAM_ID,
  ARCIUM_CLUSTER_OFFSET,
} from './constants';

/**
 * All 11 Arcium MXE accounts required for async MPC operations
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
  /** Index 9: Arcium core program */
  arciumProgram: PublicKey;
  /** Index 10: MXE program (confidex_mxe) */
  mxeProgram: PublicKey;
}

/**
 * Computation definition offsets for different MPC circuits
 * Uses sha256("<circuit_name>")[0..4] as little-endian u32
 */
export function getCircuitCompDefOffset(circuitName: string): number {
  const offsetBytes = getCompDefAccOffset(circuitName);
  return Buffer.from(offsetBytes).readUInt32LE(0);
}

/**
 * Known circuit names and their computation definition offsets
 */
export const CIRCUIT_OFFSETS = {
  compare_prices: () => getCircuitCompDefOffset('compare_prices'),
  calculate_fill: () => getCircuitCompDefOffset('calculate_fill'),
  calculate_pnl: () => getCircuitCompDefOffset('calculate_pnl'),
  calculate_funding: () => getCircuitCompDefOffset('calculate_funding'),
  add_encrypted: () => getCircuitCompDefOffset('add_encrypted'),
  sub_encrypted: () => getCircuitCompDefOffset('sub_encrypted'),
  check_liquidation: () => getCircuitCompDefOffset('check_liquidation'),
} as const;

/**
 * Derive the signer PDA for an MXE program
 *
 * Seeds: [b"ArciumSignerAccount"]
 * Program: mxeProgramId
 */
export function deriveSignPdaAccount(mxeProgramId: PublicKey = MXE_PROGRAM_ID): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    mxeProgramId
  );
  return pda;
}

/**
 * Generate a random computation offset
 * Used to create unique computation accounts for each MPC request
 */
export function generateComputationOffset(): BN {
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  return new BN(randomBytes);
}

/**
 * Derive all 11 Arcium MXE accounts needed for async MPC operations
 *
 * @param circuitName - The name of the MPC circuit (e.g., 'calculate_pnl')
 * @param computationOffset - Random offset for this computation (use generateComputationOffset())
 * @param mxeProgramId - The confidex_mxe program ID (optional, defaults to MXE_PROGRAM_ID)
 * @param clusterOffset - The Arcium cluster offset (optional, defaults to ARCIUM_CLUSTER_OFFSET)
 * @returns All 11 accounts in the correct order for remaining_accounts
 */
export function deriveArciumAccounts(
  circuitName: keyof typeof CIRCUIT_OFFSETS,
  computationOffset: BN,
  mxeProgramId: PublicKey = MXE_PROGRAM_ID,
  clusterOffset: number = ARCIUM_CLUSTER_OFFSET
): ArciumMxeAccounts {
  const compDefOffset = CIRCUIT_OFFSETS[circuitName]();

  return {
    signPdaAccount: deriveSignPdaAccount(mxeProgramId),
    mxeAccount: getMXEAccAddress(mxeProgramId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
    compDefAccount: getCompDefAccAddress(mxeProgramId, compDefOffset),
    clusterAccount: getClusterAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
    arciumProgram: new PublicKey(ARCIUM_ADDR),
    mxeProgram: mxeProgramId,
  };
}

/**
 * Convert ArciumMxeAccounts to an array of AccountMeta for remaining_accounts
 * or for inclusion in the main accounts array.
 *
 * The order must match the Rust struct remaining_accounts order.
 */
export function arciumAccountsToAccountMetas(
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
