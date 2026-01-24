import { test as base, expect, Page } from '@playwright/test';

/**
 * Extended test fixtures for wallet-connected tests.
 *
 * Since Solana wallet connections require browser extensions,
 * we use a mock wallet approach for E2E tests.
 */

export interface WalletFixtures {
  /** Page with mocked wallet ready */
  walletPage: Page;
  /** Mock a connected wallet state */
  mockWalletConnection: (publicKey: string) => Promise<void>;
}

export const test = base.extend<WalletFixtures>({
  walletPage: async ({ page }, use) => {
    // Inject wallet mock before page loads
    await page.addInitScript(() => {
      // Mock window.solana for wallet detection
      (window as unknown as { solana: unknown }).solana = {
        isPhantom: true,
        isConnected: false,
        publicKey: null,
        connect: async () => {
          return {
            publicKey: {
              toBase58: () => 'MockPublicKey111111111111111111111111111111',
              toString: () => 'MockPublicKey111111111111111111111111111111',
            },
          };
        },
        disconnect: async () => {},
        signMessage: async (message: Uint8Array) => {
          return { signature: new Uint8Array(64) };
        },
        signTransaction: async (tx: unknown) => tx,
        signAllTransactions: async (txs: unknown[]) => txs,
        on: () => {},
        off: () => {},
      };
    });

    await use(page);
  },

  mockWalletConnection: async ({ page }, use) => {
    const mockConnection = async (publicKey: string) => {
      await page.evaluate((pk) => {
        const solana = (window as unknown as { solana: unknown }).solana as Record<string, unknown>;
        solana.isConnected = true;
        solana.publicKey = {
          toBase58: () => pk,
          toString: () => pk,
        };

        // Dispatch connection event
        window.dispatchEvent(new CustomEvent('wallet-connected', { detail: { publicKey: pk } }));
      }, publicKey);
    };

    await use(mockConnection);
  },
});

export { expect };
