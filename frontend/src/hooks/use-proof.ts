'use client';

import { useState, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

import { createLogger } from '@/lib/logger';

const log = createLogger('proof');

// Groth16 proof size for Sunspot/gnark format
// Layout: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes
const GROTH16_PROOF_SIZE = 324;

// Strict proof mode - when enabled, requires backend proof server
// In production (or when explicitly set), don't allow fallback to stale proofs
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const STRICT_PROOF_MODE = IS_PRODUCTION || process.env.NEXT_PUBLIC_STRICT_PROOFS === 'true';

interface ProofResult {
  proof: Uint8Array;
  blacklistRoot: Uint8Array;
  publicInputs: Uint8Array;
}

interface UseProofReturn {
  isGenerating: boolean;
  proofReady: boolean;
  lastProof: ProofResult | null;
  generateProof: () => Promise<ProofResult>;
  checkEligibility: () => Promise<boolean>;
  /** Error message if proof generation failed */
  error: string | null;
}

const PROOF_SERVER_URL = process.env.NEXT_PUBLIC_PROOF_SERVER_URL || 'http://localhost:3001';

/**
 * Hook for generating ZK eligibility proofs
 *
 * PRODUCTION: Requires backend proof server. Fails if unavailable.
 * DEVELOPMENT: Can use backend or fail gracefully with error message.
 *
 * The hook no longer uses hardcoded proofs as fallback - this was a privacy
 * concern as stale proofs could become invalid if the blacklist changes.
 */
export function useProof(): UseProofReturn {
  const { publicKey, signMessage } = useWallet();
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofReady, setProofReady] = useState(false);
  const [lastProof, setLastProof] = useState<ProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const proofCache = useRef<Map<string, ProofResult>>(new Map());

  const generateProof = useCallback(async (): Promise<ProofResult> => {
    if (!publicKey || !signMessage) {
      throw new Error('Wallet not connected');
    }

    // Check cache first
    const cacheKey = publicKey.toBase58();
    const cached = proofCache.current.get(cacheKey);
    if (cached) {
      log.debug('Using cached proof');
      setLastProof(cached);
      setProofReady(true);
      setError(null);
      return cached;
    }

    setIsGenerating(true);
    setProofReady(false);
    setError(null);

    try {
      log.info('Generating proof via backend server...');
      log.debug('Proof server URL:', { url: PROOF_SERVER_URL });

      // Create signed message for proof request
      const timestamp = Date.now();
      const message = `Confidex eligibility proof request: ${timestamp}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);

      const requestStart = Date.now();
      const response = await fetch(`${PROOF_SERVER_URL}/api/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: publicKey.toBase58(),
          signature: bs58.encode(signature),
          message,
        }),
        signal: AbortSignal.timeout(30000), // 30 second timeout (proof gen can take time)
      });

      const requestDuration = Date.now() - requestStart;

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorText;
        } catch {
          errorMessage = errorText;
        }

        throw new Error(`Proof server error (${response.status}): ${errorMessage}`);
      }

      const data = await response.json();

      // Decode proof from base64
      const proof = Uint8Array.from(atob(data.proof), (c) => c.charCodeAt(0));

      // Validate proof size
      if (proof.length !== GROTH16_PROOF_SIZE) {
        throw new Error(`Invalid proof size from server: ${proof.length} (expected ${GROTH16_PROOF_SIZE})`);
      }

      // Decode blacklist root from hex
      const rootHex = data.blacklistRoot.replace('0x', '');
      const blacklistRoot = new Uint8Array(
        rootHex.match(/.{2}/g)?.map((b: string) => parseInt(b, 16)) || []
      );

      const result: ProofResult = {
        proof,
        blacklistRoot,
        publicInputs: blacklistRoot, // For Sunspot, public input is the root
      };

      log.info('Proof generated successfully', {
        durationMs: requestDuration,
        serverLatency: data.durationMs,
        proofSize: proof.length,
      });

      // Cache the result
      proofCache.current.set(cacheKey, result);

      setLastProof(result);
      setProofReady(true);
      setError(null);

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error('Proof generation failed', { error: errorMessage });

      // In strict mode (production), throw the error
      if (STRICT_PROOF_MODE) {
        setError(`Proof generation failed: ${errorMessage}. Please ensure the proof server is running.`);
        throw new Error(`Proof generation failed (strict mode): ${errorMessage}`);
      }

      // In development mode, set error state but don't throw
      // This allows the UI to show an error message
      setError(`Proof server unavailable: ${errorMessage}. Start the backend server or set NEXT_PUBLIC_PROOF_SERVER_URL.`);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, [publicKey, signMessage]);

  const checkEligibility = useCallback(async (): Promise<boolean> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }

    try {
      // Try server first
      const response = await fetch(
        `${PROOF_SERVER_URL}/api/prove/check/${publicKey.toBase58()}`,
        { signal: AbortSignal.timeout(3000) }
      );

      if (response.ok) {
        const data = await response.json();
        return data.eligible;
      }
    } catch (error) {
      // Server unavailable
    }

    // Default: all addresses are eligible (empty blacklist)
    log.debug('Eligibility check: ELIGIBLE (empty blacklist)');
    return true;
  }, [publicKey]);

  return {
    isGenerating,
    proofReady,
    lastProof,
    generateProof,
    checkEligibility,
    error,
  };
}
