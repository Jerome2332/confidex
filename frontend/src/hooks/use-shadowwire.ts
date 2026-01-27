'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

import { createLogger } from '@/lib/logger';

const log = createLogger('hooks');

// ShadowWire types (importing from the package)
type TokenSymbol = 'SOL' | 'USDC' | 'RADR' | 'ORE' | 'BONK' | 'JIM' | 'GODL' | 'HUSTLE' | 'ZEC' | 'CRT' | 'BLACKCOIN' | 'GIL' | 'ANON' | 'WLFI' | 'USD1' | 'AOL' | 'IQLABS';
type TransferType = 'internal' | 'external';

interface ZKProofData {
  proofBytes: string;
  commitmentBytes: string;
  blindingFactorBytes: string;
}

interface TransferResponse {
  success: boolean;
  tx_signature: string;
  amount_sent: number | null;
  amount_hidden: boolean;
  proof_pda?: string; // Optional - may not be returned in all SDK versions
}

interface PoolBalance {
  wallet: string;
  available: number;
  deposited: number;
  withdrawn_to_escrow: number;
  migrated: boolean;
  pool_address: string;
}

// Lazy-load ShadowWire to avoid SSR issues
let shadowWireModule: typeof import('@radr/shadowwire') | null = null;
let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

async function getShadowWireModule() {
  if (!shadowWireModule) {
    shadowWireModule = await import('@radr/shadowwire');
  }
  return shadowWireModule;
}

async function initializeWASM(): Promise<void> {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    const sw = await getShadowWireModule();

    if (!sw.isWASMSupported()) {
      throw new Error('WebAssembly is not supported in this browser');
    }

    await sw.initWASM('/wasm/settler_wasm_bg.wasm');
    wasmInitialized = true;
    log.debug('WASM initialized successfully');
  })();

  return wasmInitPromise;
}

export interface UseShadowWireReturn {
  isReady: boolean;
  isInitializing: boolean;
  error: string | null;
  transfer: (params: TransferParams) => Promise<TransferResponse>;
  getBalance: (token: TokenSymbol) => Promise<PoolBalance | null>;
  generateProof: (amount: number, token: TokenSymbol) => Promise<ZKProofData>;
}

export interface TransferParams {
  recipient: string;
  amount: number;
  token: TokenSymbol;
  type: TransferType;
}

/**
 * Hook for ShadowWire private transfers
 * Handles WASM initialization and provides transfer functionality
 */
export function useShadowWire(): UseShadowWireReturn {
  const { publicKey, signMessage } = useWallet();
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<InstanceType<typeof import('@radr/shadowwire').ShadowWireClient> | null>(null);

  // Initialize WASM and client on mount
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (isReady || isInitializing) return;

      setIsInitializing(true);
      setError(null);

      try {
        // Initialize WASM
        await initializeWASM();

        // Create client
        const sw = await getShadowWireModule();
        if (!sw) throw new Error('Failed to load ShadowWire module');

        clientRef.current = new sw.ShadowWireClient({ debug: true });

        if (!cancelled) {
          setIsReady(true);
          log.debug('Client initialized');
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to initialize ShadowWire';
          setError(message);
          log.error('Initialization error', { error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Generate a ZK range proof for an amount
   */
  const generateProof = useCallback(async (
    amount: number,
    token: TokenSymbol
  ): Promise<ZKProofData> => {
    if (!clientRef.current) {
      throw new Error('ShadowWire not initialized');
    }

    console.log('[ShadowWire] Generating proof for', amount, token);
    const proof = await clientRef.current.generateProofLocally(amount, token);
    log.debug('Proof generated');
    return proof;
  }, []);

  /**
   * Execute a private transfer via ShadowWire
   */
  const transfer = useCallback(async (params: TransferParams): Promise<TransferResponse> => {
    if (!clientRef.current) {
      throw new Error('ShadowWire not initialized');
    }

    if (!publicKey || !signMessage) {
      throw new Error('Wallet not connected');
    }

    log.debug('Executing transfer...');
    log.debug('  Type:', { type: params.type });
    log.debug('  Token:', { token: params.token });
    log.debug('  Amount:', { amount: params.amount });
    log.debug('  Recipient:', { recipient: params.recipient });

    // For internal transfers (amount hidden), generate proof client-side
    if (params.type === 'internal') {
      const proof = await generateProof(params.amount, params.token);

      const result = await clientRef.current.transferWithClientProofs({
        sender: publicKey.toBase58(),
        recipient: params.recipient,
        amount: params.amount,
        token: params.token,
        type: params.type,
        customProof: proof,
        wallet: { signMessage },
      });

      log.debug('[ShadowWire] Transfer complete:', { tx_signature: result.tx_signature });
      return result;
    }

    // For external transfers (amount visible)
    const result = await clientRef.current.transfer({
      sender: publicKey.toBase58(),
      recipient: params.recipient,
      amount: params.amount,
      token: params.token,
      type: params.type,
      wallet: { signMessage },
    });

    log.debug('[ShadowWire] Transfer complete:', { tx_signature: result.tx_signature });
    return result;
  }, [publicKey, signMessage, generateProof]);

  /**
   * Get ShadowWire pool balance for a token
   */
  const getBalance = useCallback(async (token: TokenSymbol): Promise<PoolBalance | null> => {
    if (!clientRef.current || !publicKey) {
      return null;
    }

    try {
      const balance = await clientRef.current.getBalance(publicKey.toBase58(), token);
      return balance;
    } catch (err) {
      log.warn('Failed to get balance:', { err });
      return null;
    }
  }, [publicKey]);

  return {
    isReady,
    isInitializing,
    error,
    transfer,
    getBalance,
    generateProof,
  };
}
