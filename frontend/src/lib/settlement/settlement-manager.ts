/**
 * Settlement Manager
 *
 * Singleton registry for settlement providers.
 * Handles provider selection, auto-fallback, and initialization.
 */

import type {
  SettlementMethod,
  SettlementCapabilities,
  ISettlementProvider,
} from './types';
import { shadowWireProvider } from './providers/shadowwire-provider';
import { csplProvider } from './providers/cspl-provider';

/**
 * Settlement manager class
 * Manages multiple settlement providers and routes requests
 */
class SettlementManagerClass {
  private providers = new Map<SettlementMethod, ISettlementProvider>();
  private initializationPromises = new Map<SettlementMethod, Promise<void>>();

  constructor() {
    // Register available providers
    this.providers.set('shadowwire', shadowWireProvider);
    this.providers.set('cspl', csplProvider);

    console.log('[Settlement Manager] Registered providers:',
      Array.from(this.providers.keys())
    );
  }

  /**
   * Get a specific provider by method
   */
  getProvider(method: SettlementMethod): ISettlementProvider | null {
    if (method === 'auto') {
      return this.selectBestProvider();
    }
    return this.providers.get(method) || null;
  }

  /**
   * Select the best available provider
   * Priority: C-SPL (if available and ready) > ShadowWire
   */
  private selectBestProvider(): ISettlementProvider | null {
    // C-SPL has priority (no fees)
    const cspl = this.providers.get('cspl');
    if (cspl?.isReady() && cspl.capabilities.isAvailable) {
      console.log('[Settlement Manager] Auto-selected: C-SPL');
      return cspl;
    }

    // Fallback to ShadowWire (production-ready, 1% fee)
    const shadowWire = this.providers.get('shadowwire');
    if (shadowWire?.isReady() && shadowWire.capabilities.isAvailable) {
      console.log('[Settlement Manager] Auto-selected: ShadowWire');
      return shadowWire;
    }

    // No provider available
    console.warn('[Settlement Manager] No provider available');
    return null;
  }

  /**
   * Get all registered providers' capabilities
   */
  getAllCapabilities(): SettlementCapabilities[] {
    return Array.from(this.providers.values()).map((p) => p.capabilities);
  }

  /**
   * Get only available providers' capabilities
   */
  getAvailableCapabilities(): SettlementCapabilities[] {
    return Array.from(this.providers.values())
      .filter((p) => p.capabilities.isAvailable)
      .map((p) => p.capabilities);
  }

  /**
   * Initialize a specific provider
   */
  async initializeProvider(method: SettlementMethod): Promise<void> {
    if (method === 'auto') {
      // Initialize all available providers
      await this.initializeAll();
      return;
    }

    const provider = this.providers.get(method);
    if (!provider) {
      throw new Error(`Unknown settlement method: ${method}`);
    }

    // Check for existing initialization
    const existingPromise = this.initializationPromises.get(method);
    if (existingPromise) {
      return existingPromise;
    }

    // Start initialization
    const promise = provider.initialize();
    this.initializationPromises.set(method, promise);

    try {
      await promise;
      console.log(`[Settlement Manager] ${method} initialized`);
    } catch (error) {
      console.error(`[Settlement Manager] Failed to initialize ${method}:`, error);
      this.initializationPromises.delete(method);
      throw error;
    }
  }

  /**
   * Initialize all available providers
   */
  async initializeAll(): Promise<void> {
    const initPromises: Promise<void>[] = [];

    for (const [method, provider] of Array.from(this.providers.entries())) {
      if (provider.capabilities.isAvailable) {
        initPromises.push(
          this.initializeProvider(method).catch((err) => {
            console.warn(
              `[Settlement Manager] Non-critical: ${method} init failed:`,
              err
            );
          })
        );
      }
    }

    await Promise.all(initPromises);
    console.log('[Settlement Manager] All available providers initialized');
  }

  /**
   * Check if any provider is ready
   */
  isAnyProviderReady(): boolean {
    for (const provider of Array.from(this.providers.values())) {
      if (provider.isReady()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the fee for a specific method (in basis points)
   */
  getFeeBps(method: SettlementMethod): number {
    if (method === 'auto') {
      const best = this.selectBestProvider();
      return best?.capabilities.feeBps ?? 0;
    }

    const provider = this.providers.get(method);
    return provider?.capabilities.feeBps ?? 0;
  }

  /**
   * Calculate estimated fee for an amount
   */
  calculateFee(amount: number, method: SettlementMethod): number {
    const feeBps = this.getFeeBps(method);
    return amount * (feeBps / 10000);
  }

  /**
   * Get human-readable status for a method
   */
  getStatus(method: SettlementMethod): {
    ready: boolean;
    available: boolean;
    message: string;
  } {
    if (method === 'auto') {
      const best = this.selectBestProvider();
      if (best?.isReady()) {
        return {
          ready: true,
          available: true,
          message: `Auto-selected: ${best.capabilities.name}`,
        };
      }
      return {
        ready: false,
        available: this.isAnyProviderReady(),
        message: 'Initializing...',
      };
    }

    const provider = this.providers.get(method);
    if (!provider) {
      return { ready: false, available: false, message: 'Unknown method' };
    }

    if (!provider.capabilities.isAvailable) {
      return { ready: false, available: false, message: 'Coming Soon' };
    }

    if (!provider.isReady()) {
      return { ready: false, available: true, message: 'Initializing...' };
    }

    return { ready: true, available: true, message: 'Ready' };
  }
}

// Export singleton instance
export const settlementManager = new SettlementManagerClass();

// Export type for external use
export type { SettlementManagerClass };
