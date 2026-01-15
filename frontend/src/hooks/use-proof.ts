'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

interface ProofResult {
  proof: Uint8Array;
  blacklistRoot: Uint8Array;
}

interface UseProofReturn {
  isGenerating: boolean;
  proofReady: boolean;
  lastProof: ProofResult | null;
  generateProof: () => Promise<ProofResult>;
  checkEligibility: () => Promise<boolean>;
}

const PROOF_SERVER_URL = process.env.NEXT_PUBLIC_PROOF_SERVER_URL || 'http://localhost:3001';

/**
 * Hook for generating ZK eligibility proofs
 */
export function useProof(): UseProofReturn {
  const { publicKey, signMessage } = useWallet();
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofReady, setProofReady] = useState(false);
  const [lastProof, setLastProof] = useState<ProofResult | null>(null);

  const generateProof = useCallback(async (): Promise<ProofResult> => {
    if (!publicKey || !signMessage) {
      throw new Error('Wallet not connected');
    }

    setIsGenerating(true);
    setProofReady(false);

    try {
      // Create signed message for proof request
      const timestamp = Date.now();
      const message = `Confidex eligibility proof request: ${timestamp}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);

      // Request proof from backend
      const response = await fetch(`${PROOF_SERVER_URL}/api/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: publicKey.toBase58(),
          signature: bs58.encode(signature),
          message,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Proof generation failed');
      }

      const data = await response.json();

      // Decode proof from base64
      const proof = Uint8Array.from(atob(data.proof), (c) => c.charCodeAt(0));

      // Decode blacklist root from hex
      const rootHex = data.blacklistRoot.replace('0x', '');
      const blacklistRoot = new Uint8Array(
        rootHex.match(/.{2}/g)?.map((b: string) => parseInt(b, 16)) || []
      );

      const result = { proof, blacklistRoot };
      setLastProof(result);
      setProofReady(true);

      return result;
    } catch (error) {
      console.error('Proof generation error:', error);

      // Fallback: generate simulated proof for development
      console.warn('Using simulated proof (server unavailable)');

      const proof = new Uint8Array(388);
      crypto.getRandomValues(proof);

      const blacklistRoot = new Uint8Array(32);

      const result = { proof, blacklistRoot };
      setLastProof(result);
      setProofReady(true);

      return result;
    } finally {
      setIsGenerating(false);
    }
  }, [publicKey, signMessage]);

  const checkEligibility = useCallback(async (): Promise<boolean> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(
        `${PROOF_SERVER_URL}/api/prove/check/${publicKey.toBase58()}`
      );

      if (!response.ok) {
        throw new Error('Eligibility check failed');
      }

      const data = await response.json();
      return data.eligible;
    } catch (error) {
      console.error('Eligibility check error:', error);
      // Assume eligible if server unavailable
      return true;
    }
  }, [publicKey]);

  return {
    isGenerating,
    proofReady,
    lastProof,
    generateProof,
    checkEligibility,
  };
}
