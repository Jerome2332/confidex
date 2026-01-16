/**
 * ShadowWire Settlement Provider
 *
 * Wraps the @radr/shadowwire SDK for use in the settlement abstraction layer.
 * Provides Bulletproof-based privacy for token transfers.
 */

import type {
  ISettlementProvider,
  SettlementCapabilities,
  SettlementTransferParams,
  SettlementTransferResult,
  SettlementBalance,
  SettlementToken,
} from '../types';
import { SHADOWWIRE_FEE_BPS } from '@/lib/constants';

import { createLogger } from '@/lib/logger';

const log = createLogger('api');

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

/**
 * ShadowWire settlement provider implementation
 */
export class ShadowWireProvider implements ISettlementProvider {
  private client: InstanceType<
    typeof import('@radr/shadowwire').ShadowWireClient
  > | null = null;
  private initialized = false;

  readonly capabilities: SettlementCapabilities = {
    id: 'shadowwire',
    name: 'ShadowWire',
    isAvailable: true, // Production-ready
    feeBps: SHADOWWIRE_FEE_BPS, // 1%
    supportedTokens: [
      'SOL',
      'USDC',
      'RADR',
      'ORE',
      'BONK',
      'JIM',
      'GODL',
      'HUSTLE',
      'ZEC',
      'CRT',
      'BLACKCOIN',
      'GIL',
      'ANON',
      'WLFI',
      'USD1',
      'AOL',
      'IQLABS',
    ],
    privacyLevel: 'full',
    estimatedTimeMs: 3000, // ~3 seconds for proof generation
    description: 'Bulletproof-based privacy with hidden amounts',
  };

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize WASM
      await initializeWASM();

      // Create client
      const sw = await getShadowWireModule();
      if (!sw) throw new Error('Failed to load ShadowWire module');

      this.client = new sw.ShadowWireClient({ debug: true });
      this.initialized = true;

      log.debug('Client initialized');
    } catch (error) {
      log.error('Initialization error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  isReady(): boolean {
    return this.initialized && this.client !== null;
  }

  async transfer(
    params: SettlementTransferParams
  ): Promise<SettlementTransferResult> {
    if (!this.client) {
      throw new Error('ShadowWire not initialized');
    }

    log.debug('Executing transfer...');
    log.debug('  Type:', { type: params.type });
    log.debug('  Token:', { token: params.token });
    log.debug('  Amount:', { amount: params.amount });
    log.debug('  Recipient:', { recipient: params.recipient });

    try {
      // Map token to ShadowWire token type
      const swToken = params.token as Parameters<
        typeof this.client.transfer
      >[0]['token'];

      // For internal transfers (amount hidden), generate proof client-side
      if (params.type === 'internal') {
        const proof = await this.generateProof(params.amount, params.token);

        const result = await this.client.transferWithClientProofs({
          sender: params.sender,
          recipient: params.recipient,
          amount: params.amount,
          token: swToken,
          type: params.type,
          customProof: proof,
          wallet: { signMessage: params.wallet.signMessage },
        });

        log.debug('[ShadowWire Provider] Transfer complete:', { tx_signature: result.tx_signature });

        return {
          success: result.success,
          txSignature: result.tx_signature,
          amountSent: result.amount_sent,
          amountHidden: result.amount_hidden,
          proofPda: result.proof_pda,
          feeCharged: params.amount * (this.capabilities.feeBps / 10000),
        };
      }

      // For external transfers (amount visible)
      const result = await this.client.transfer({
        sender: params.sender,
        recipient: params.recipient,
        amount: params.amount,
        token: swToken,
        type: params.type,
        wallet: { signMessage: params.wallet.signMessage },
      });

      log.debug('[ShadowWire Provider] Transfer complete:', { tx_signature: result.tx_signature });

      return {
        success: result.success,
        txSignature: result.tx_signature,
        amountSent: result.amount_sent,
        amountHidden: result.amount_hidden,
        proofPda: result.proof_pda,
        feeCharged: params.amount * (this.capabilities.feeBps / 10000),
      };
    } catch (error) {
      log.error('Transfer failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async getBalance(
    wallet: string,
    token: SettlementToken
  ): Promise<SettlementBalance | null> {
    if (!this.client) {
      return null;
    }

    try {
      const swToken = token as Parameters<
        typeof this.client.getBalance
      >[1];
      const balance = await this.client.getBalance(wallet, swToken);

      if (!balance) return null;

      return {
        wallet: balance.wallet,
        available: balance.available,
        deposited: balance.deposited,
        withdrawnToEscrow: balance.withdrawn_to_escrow,
        migrated: balance.migrated,
        poolAddress: balance.pool_address,
      };
    } catch (error) {
      log.warn('Failed to get balance:', { error });
      return null;
    }
  }

  async generateProof(
    amount: number,
    token: SettlementToken
  ): Promise<{
    proofBytes: string;
    commitmentBytes: string;
    blindingFactorBytes: string;
  }> {
    if (!this.client) {
      throw new Error('ShadowWire not initialized');
    }

    console.log('[ShadowWire Provider] Generating proof for', amount, token);
    const swToken = token as Parameters<
      typeof this.client.generateProofLocally
    >[1];
    const proof = await this.client.generateProofLocally(amount, swToken);
    log.debug('Proof generated');
    return proof;
  }
}

// Export singleton instance
export const shadowWireProvider = new ShadowWireProvider();
