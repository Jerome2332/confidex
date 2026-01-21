import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// Mock PublicKey for tests
export class MockPublicKey {
  private _base58: string;

  constructor(value: string | Uint8Array = 'TestPublicKey11111111111111111111111111111') {
    this._base58 = typeof value === 'string' ? value : 'TestPublicKey11111111111111111111111111111';
  }

  toBase58(): string {
    return this._base58;
  }

  toString(): string {
    return this._base58;
  }

  toBuffer(): Buffer {
    return Buffer.alloc(32);
  }

  equals(other: MockPublicKey): boolean {
    return this._base58 === other._base58;
  }
}

// Mock wallet context
export const mockWallet = {
  publicKey: new MockPublicKey(),
  connecting: false,
  connected: true,
  disconnecting: false,
  select: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendTransaction: vi.fn().mockResolvedValue('mock-signature'),
  signTransaction: vi.fn(),
  signAllTransactions: vi.fn(),
  signMessage: vi.fn(),
};

export const mockDisconnectedWallet = {
  ...mockWallet,
  publicKey: null,
  connected: false,
};

// Mock connection
export const mockConnection = {
  getAccountInfo: vi.fn(),
  getBalance: vi.fn().mockResolvedValue(5000000000), // 5 SOL
  getLatestBlockhash: vi.fn().mockResolvedValue({
    blockhash: 'test-blockhash',
    lastValidBlockHeight: 1000,
  }),
  simulateTransaction: vi.fn().mockResolvedValue({
    value: { err: null, logs: [], unitsConsumed: 100000 },
  }),
  confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  sendTransaction: vi.fn().mockResolvedValue('mock-signature'),
  getTransaction: vi.fn().mockResolvedValue(null),
};

// Mock encryption hook return value
export const mockEncryption = {
  context: null,
  isInitialized: true,
  isProductionMode: false,
  keySource: 'demo' as const,
  initializeEncryption: vi.fn().mockResolvedValue(undefined),
  encryptValue: vi.fn().mockImplementation((value: bigint) =>
    Promise.resolve(new Uint8Array(64).fill(Number(value % 256n)))
  ),
  decryptValue: vi.fn().mockImplementation(() => Promise.resolve(BigInt(0))),
  getEphemeralPublicKey: vi.fn().mockReturnValue(new Uint8Array(32)),
};

export const mockEncryptionNotInitialized = {
  ...mockEncryption,
  isInitialized: false,
  context: null,
};

// Mock proof hook return value
export const mockProof = {
  isGenerating: false,
  proofReady: true,
  lastProof: null,
  generateProof: vi.fn().mockResolvedValue({
    proof: new Uint8Array(324),
    blacklistRoot: new Uint8Array(32),
  }),
};

export const mockProofGenerating = {
  ...mockProof,
  isGenerating: true,
  proofReady: false,
};

// Mock trading state
export const mockTradingState = {
  selectedPair: {
    symbol: 'SOL/USDC',
    baseMint: 'So11111111111111111111111111111111111111112',
    quoteMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
  },
  orderBook: {
    bids: [
      { price: 139.50, size: 10, total: 10 },
      { price: 139.00, size: 25, total: 35 },
    ],
    asks: [
      { price: 140.00, size: 15, total: 15 },
      { price: 140.50, size: 20, total: 35 },
    ],
  },
  balances: {
    SOL: { available: 5.5, locked: 0.5 },
    USDC: { available: 1000, locked: 150 },
  },
};

// Mock order store
export const mockOrderStore = {
  orders: [],
  openOrders: [],
  isPlacingOrder: false,
  addOrder: vi.fn(),
  removeOrder: vi.fn(),
  updateOrder: vi.fn(),
  setIsPlacingOrder: vi.fn(),
};

// Mock settings store
export const mockSettingsStore = {
  autoWrap: true,
  slippage: 0.5,
  notifications: true,
  confirmTx: false,
  privacyMode: false,
  setPrivacyMode: vi.fn(),
  setAutoWrap: vi.fn(),
  setSlippage: vi.fn(),
  setNotifications: vi.fn(),
  setConfirmTx: vi.fn(),
};

// Mock perpetuals store
export const mockPerpetualStore = {
  currentInput: '',
  setCurrentInput: vi.fn(),
  defaultLeverage: 5,
  maxLeverage: 20,
  fundingRates: new Map(),
  selectedMarket: 'SOL-PERP',
  isOpeningPosition: false,
  setIsOpeningPosition: vi.fn(),
  estimateLiquidationPrice: vi.fn().mockReturnValue(100),
  setBottomTab: vi.fn(),
  positions: [],
  addPosition: vi.fn(),
};

// Mock encrypted balance hook
export const mockEncryptedBalance = {
  balances: {
    sol: BigInt(5500000000), // 5.5 SOL
    usdc: BigInt(1000000000), // 1000 USDC
    solAccount: null,
    usdcAccount: null,
  },
  isLoading: false,
  refresh: vi.fn(),
  canAfford: vi.fn().mockReturnValue(true),
  isEncrypted: true,
};

// Mock token balance hook
export const mockTokenBalance = {
  balances: {
    sol: BigInt(5000000000), // 5 SOL
    usdc: BigInt(500000000), // 500 USDC
    solUiAmount: '5.00',
    usdcUiAmount: '500.00',
  },
  refresh: vi.fn(),
};

// Mock SOL price hook
export const mockSolPrice = {
  price: 140.50,
  isLoading: false,
  error: null,
};

// Test providers wrapper
interface ProvidersProps {
  children: React.ReactNode;
}

function TestProviders({ children }: ProvidersProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// Custom render function with providers
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: TestProviders, ...options });

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };

// Helper to create a mock function that tracks calls
export function createMockFn<T extends (...args: unknown[]) => unknown>() {
  return vi.fn() as unknown as T;
}

// Helper to wait for async operations
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to create mock order data
export function createMockOrder(overrides = {}) {
  return {
    id: `order-${Date.now()}`,
    maker: new MockPublicKey(),
    pair: 'SOL/USDC',
    baseMint: 'So11111111111111111111111111111111111111112',
    quoteMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
    side: 'buy' as const,
    type: 'limit' as const,
    encryptedAmount: new Uint8Array(64),
    encryptedPrice: new Uint8Array(64),
    encryptedFilled: new Uint8Array(64),
    status: 'open' as const,
    createdAt: new Date(),
    filledPercent: 0,
    slippage: 0.5,
    ...overrides,
  };
}

// Helper to create mock position data
export function createMockPosition(overrides = {}) {
  return {
    id: `pos-${Date.now()}`,
    positionId: `pos_${Date.now()}`,
    market: new MockPublicKey(),
    marketSymbol: 'SOL-PERP',
    trader: new MockPublicKey(),
    side: 'long' as const,
    leverage: 5,
    encryptedSize: new Uint8Array(64),
    encryptedEntryPrice: new Uint8Array(64),
    encryptedCollateral: new Uint8Array(64),
    encryptedRealizedPnl: new Uint8Array(64),
    encryptedLiqBelow: new Uint8Array(64),
    encryptedLiqAbove: new Uint8Array(64),
    riskLevel: 'unknown' as const,
    thresholdVerified: false,
    entryCumulativeFunding: BigInt(0),
    pendingFunding: BigInt(0),
    status: 'open' as const,
    createdAt: new Date(),
    lastUpdated: new Date(),
    partialCloseCount: 0,
    autoDeleveragePriority: 0,
    ...overrides,
  };
}
