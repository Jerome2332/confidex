'use client';

import { useState, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

import { createLogger } from '@/lib/logger';

const log = createLogger('range-proof');

// Strict proof mode - when enabled, rejects simulated proofs and requires real server
// Set NEXT_PUBLIC_STRICT_PROOFS=true in production to ensure no fake proofs are accepted
const STRICT_PROOF_MODE = process.env.NEXT_PUBLIC_STRICT_PROOFS === 'true';

// Groth16 proof size for Sunspot/gnark format
const GROTH16_PROOF_SIZE = 324;

const PROOF_SERVER_URL = process.env.NEXT_PUBLIC_PROOF_SERVER_URL || 'http://localhost:3001';

interface RangeProofInputs {
  value: bigint;
  minBound: bigint;
  maxBound: bigint;
}

interface RangeProofResult {
  proof: Uint8Array;
  commitment: Uint8Array;
  minBound: bigint;
  maxBound: bigint;
  blindingFactor: Uint8Array;
}

interface UseRangeProofReturn {
  isGenerating: boolean;
  proofReady: boolean;
  lastProof: RangeProofResult | null;
  generateRangeProof: (inputs: RangeProofInputs) => Promise<RangeProofResult>;
  createCommitment: (value: bigint) => Promise<{ commitment: Uint8Array; blinding: Uint8Array }>;
}

/**
 * Generate a random blinding factor for commitment
 */
function generateBlindingFactor(): Uint8Array {
  const blinding = new Uint8Array(32);
  crypto.getRandomValues(blinding);
  return blinding;
}

/**
 * Convert bigint to 32-byte Uint8Array (big-endian)
 */
function bigintToBytes(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Simple Poseidon2-like commitment for demo
 * In production, this should match the circuit's Poseidon2 implementation
 */
async function computeCommitment(value: bigint, blinding: Uint8Array): Promise<Uint8Array> {
  // Combine value and blinding factor
  const valueBytes = bigintToBytes(value);
  const combined = new Uint8Array(64);
  combined.set(valueBytes, 0);
  combined.set(blinding, 32);

  // Hash to create commitment
  // Note: In production, use actual Poseidon2 hash matching the circuit
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuffer);
}

/**
 * Generate a simulated proof structure for demo
 * In production, this would call the actual prover
 */
function generateSimulatedProof(
  commitment: Uint8Array,
  minBound: bigint,
  maxBound: bigint
): Uint8Array {
  const proof = new Uint8Array(GROTH16_PROOF_SIZE);

  // Create deterministic but fake proof data based on inputs
  const combined = new Uint8Array(96);
  combined.set(commitment, 0);
  combined.set(bigintToBytes(minBound), 32);
  combined.set(bigintToBytes(maxBound), 64);

  // Fill proof with deterministic values
  for (let i = 0; i < GROTH16_PROOF_SIZE; i++) {
    proof[i] = combined[i % 96] ^ (i & 0xff);
  }

  // Set num_commitments field at offset 256
  proof[256] = 1;
  proof[257] = 0;
  proof[258] = 0;
  proof[259] = 0;

  return proof;
}

/**
 * Hook for generating ZK range proofs
 *
 * Range proofs allow proving that a hidden value lies within a specified range
 * without revealing the actual value. This is used for:
 * - Proving order amounts are within protocol limits
 * - Proving collateral ratios meet requirements
 * - Privacy-preserving amount validation
 */
export function useRangeProof(): UseRangeProofReturn {
  const { publicKey, signMessage } = useWallet();
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofReady, setProofReady] = useState(false);
  const [lastProof, setLastProof] = useState<RangeProofResult | null>(null);
  const proofCache = useRef<Map<string, RangeProofResult>>(new Map());

  /**
   * Create a commitment to a value
   * Returns the commitment and blinding factor (keep blinding secret!)
   */
  const createCommitment = useCallback(
    async (value: bigint): Promise<{ commitment: Uint8Array; blinding: Uint8Array }> => {
      const blinding = generateBlindingFactor();
      const commitment = await computeCommitment(value, blinding);

      log.debug('Created commitment', {
        value: value.toString(),
        commitmentHex: bytesToHex(commitment).slice(0, 16) + '...',
      });

      return { commitment, blinding };
    },
    []
  );

  /**
   * Generate a range proof for a value within bounds
   */
  const generateRangeProof = useCallback(
    async (inputs: RangeProofInputs): Promise<RangeProofResult> => {
      const { value, minBound, maxBound } = inputs;

      // Validate inputs
      if (value < minBound || value > maxBound) {
        throw new Error(`Value ${value} is not within range [${minBound}, ${maxBound}]`);
      }

      // Check cache
      const cacheKey = `${value}-${minBound}-${maxBound}`;
      const cached = proofCache.current.get(cacheKey);
      if (cached) {
        log.debug('Using cached range proof');
        setLastProof(cached);
        setProofReady(true);
        return cached;
      }

      setIsGenerating(true);
      setProofReady(false);

      try {
        // Generate commitment and blinding factor
        const blinding = generateBlindingFactor();
        const commitment = await computeCommitment(value, blinding);

        let proof: Uint8Array;

        // Try server-side proof generation first
        if (publicKey && signMessage) {
          try {
            log.debug('Attempting server-side range proof generation...');

            const timestamp = Date.now();
            const message = `Confidex range proof request: ${timestamp}`;
            const messageBytes = new TextEncoder().encode(message);
            const signature = await signMessage(messageBytes);

            const response = await fetch(`${PROOF_SERVER_URL}/api/prove/range`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                address: publicKey.toBase58(),
                signature: bs58.encode(signature),
                message,
                commitment: bytesToHex(commitment),
                minBound: minBound.toString(),
                maxBound: maxBound.toString(),
                value: value.toString(),
                blindingFactor: bytesToHex(blinding),
              }),
              signal: AbortSignal.timeout(10000),
            });

            if (response.ok) {
              const data = await response.json();
              proof = Uint8Array.from(atob(data.proof), (c) => c.charCodeAt(0));
              log.debug('Generated range proof via server');
            } else {
              throw new Error('Server returned error');
            }
          } catch (serverError) {
            if (STRICT_PROOF_MODE) {
              throw new Error('Proof server unavailable - strict proof mode enabled. Ensure the proof server is running at ' + PROOF_SERVER_URL);
            }
            log.warn('Server unavailable, generating simulated proof (DEV ONLY)');
            proof = generateSimulatedProof(commitment, minBound, maxBound);
          }
        } else {
          if (STRICT_PROOF_MODE) {
            throw new Error('No wallet connected - strict proof mode enabled. Connect wallet to generate real proofs.');
          }
          log.warn('No wallet connected, generating simulated proof (DEV ONLY)');
          proof = generateSimulatedProof(commitment, minBound, maxBound);
        }

        const result: RangeProofResult = {
          proof,
          commitment,
          minBound,
          maxBound,
          blindingFactor: blinding,
        };

        // Cache result
        proofCache.current.set(cacheKey, result);

        setLastProof(result);
        setProofReady(true);

        log.debug('Range proof generation complete', {
          proofSize: proof.length,
          commitmentHex: bytesToHex(commitment).slice(0, 16) + '...',
          range: `[${minBound}, ${maxBound}]`,
        });

        return result;
      } catch (error) {
        log.error('Range proof generation error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        setIsGenerating(false);
      }
    },
    [publicKey, signMessage]
  );

  return {
    isGenerating,
    proofReady,
    lastProof,
    generateRangeProof,
    createCommitment,
  };
}

/**
 * Utility types for range proof integration with Arcium
 */
export interface RangeProofWithEncryption {
  // ZK range proof (proves value in range without revealing it)
  proof: Uint8Array;
  commitment: Uint8Array;
  minBound: bigint;
  maxBound: bigint;

  // Arcium encrypted value (for MPC computation)
  encryptedValue: Uint8Array;

  // The same blinding factor links the commitment and allows verification
  blindingFactor: Uint8Array;
}

/**
 * Helper to prepare a value for both ZK range proof and Arcium encryption
 *
 * Flow:
 * 1. Generate commitment = Poseidon(value, blinding)
 * 2. Generate ZK proof that value is in [min, max]
 * 3. Encrypt value with Arcium for MPC operations
 * 4. Submit both commitment and ciphertext on-chain
 * 5. On-chain: verify ZK proof, use ciphertext for matching
 */
export async function prepareValueWithRangeProof(
  value: bigint,
  minBound: bigint,
  maxBound: bigint,
  encryptFn: (value: bigint) => Promise<Uint8Array>
): Promise<RangeProofWithEncryption> {
  // Generate blinding factor
  const blindingFactor = generateBlindingFactor();

  // Create commitment
  const commitment = await computeCommitment(value, blindingFactor);

  // Generate simulated proof (in production, use actual prover)
  const proof = generateSimulatedProof(commitment, minBound, maxBound);

  // Encrypt value for Arcium MPC
  const encryptedValue = await encryptFn(value);

  return {
    proof,
    commitment,
    minBound,
    maxBound,
    encryptedValue,
    blindingFactor,
  };
}
