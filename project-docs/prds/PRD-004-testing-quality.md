# PRD-004: Testing & Quality Gates

**Status:** Draft
**Priority:** CRITICAL
**Complexity:** Medium
**Estimated Effort:** 3-4 days

---

## Executive Summary

Test coverage is minimal (~20%) with no E2E automation, leaving critical paths untested. This PRD implements comprehensive testing across frontend, backend, and on-chain components with coverage thresholds that block CI.

---

## Problem Statement

Current testing state has critical gaps:

1. **Frontend Coverage ~20%** - Core trading components untested
2. **Backend Coverage ~15%** - Crank service has no unit tests
3. **No E2E Automation** - Full order flow never tested automatically
4. **No On-Chain Tests** - Anchor program tests incomplete
5. **No Coverage Gates** - PRs merge without coverage checks

---

## Scope

### In Scope
- Frontend component tests (trading panel, order book, balances)
- Backend crank service unit tests
- E2E test automation for order flow
- On-chain program integration tests
- Coverage thresholds (frontend >70%, backend >80%)

### Out of Scope
- Performance testing (PRD separate)
- Security penetration testing (PRD-007)
- Chaos engineering

---

## Coverage Targets

| Component | Current | Target | Priority |
|-----------|---------|--------|----------|
| Frontend Components | ~20% | >70% | HIGH |
| Frontend Hooks | ~10% | >80% | HIGH |
| Backend Crank | ~15% | >80% | CRITICAL |
| Backend API | ~30% | >70% | MEDIUM |
| On-Chain Programs | ~25% | >60% | HIGH |
| E2E Flow | 0% | 100% critical paths | CRITICAL |

---

## Implementation Plan

### Task 1: Frontend Component Tests

**New Files:**
- `frontend/src/__tests__/components/trading-panel.test.tsx`
- `frontend/src/__tests__/components/order-book.test.tsx`
- `frontend/src/__tests__/components/balance-display.test.tsx`
- `frontend/src/__tests__/components/position-manager.test.tsx`

**Step 1.1: Setup Test Utilities**

```typescript
// frontend/src/__tests__/utils/test-utils.tsx

import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletProvider } from '@solana/wallet-adapter-react';
import { ConnectionProvider } from '@solana/wallet-adapter-react';

// Mock wallet adapter
const mockWallet = {
  publicKey: null,
  connecting: false,
  connected: false,
  disconnecting: false,
  select: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  sendTransaction: jest.fn(),
  signTransaction: jest.fn(),
  signAllTransactions: jest.fn(),
  signMessage: jest.fn(),
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
      <ConnectionProvider endpoint="https://api.devnet.solana.com">
        <WalletProvider wallets={[]} autoConnect={false}>
          {children}
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: TestProviders, ...options });

export * from '@testing-library/react';
export { customRender as render, mockWallet };

// Mock encryption hook
export const mockEncryption = {
  isInitialized: true,
  isLoading: false,
  error: null,
  initializeEncryption: jest.fn().mockResolvedValue(undefined),
  encryptValue: jest.fn().mockImplementation((value: bigint) =>
    Promise.resolve(new Uint8Array(64).fill(Number(value % 256n)))
  ),
  providerName: 'arcium' as const,
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
```

**Step 1.2: Trading Panel Tests**

```typescript
// frontend/src/__tests__/components/trading-panel.test.tsx

import { render, screen, fireEvent, waitFor } from '../utils/test-utils';
import userEvent from '@testing-library/user-event';
import { TradingPanel } from '@/components/trading-panel';
import { useEncryption } from '@/hooks/use-encryption';
import { useTradingStore } from '@/stores/trading-store';

// Mock hooks
jest.mock('@/hooks/use-encryption');
jest.mock('@/stores/trading-store');
jest.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({
    connected: true,
    publicKey: { toBase58: () => 'TestPublicKey123' },
    signTransaction: jest.fn(),
  }),
}));

const mockUseEncryption = useEncryption as jest.Mock;
const mockUseTradingStore = useTradingStore as jest.Mock;

describe('TradingPanel', () => {
  beforeEach(() => {
    mockUseEncryption.mockReturnValue({
      isInitialized: true,
      isLoading: false,
      encryptValue: jest.fn().mockResolvedValue(new Uint8Array(64)),
    });

    mockUseTradingStore.mockReturnValue({
      side: 'buy',
      setSide: jest.fn(),
      price: '',
      setPrice: jest.fn(),
      amount: '',
      setAmount: jest.fn(),
      orderType: 'limit',
      setOrderType: jest.fn(),
    });
  });

  describe('Rendering', () => {
    it('renders buy/sell tabs', () => {
      render(<TradingPanel />);

      expect(screen.getByRole('tab', { name: /buy/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /sell/i })).toBeInTheDocument();
    });

    it('renders price input for limit orders', () => {
      render(<TradingPanel />);

      expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
    });

    it('renders amount input', () => {
      render(<TradingPanel />);

      expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    });

    it('renders submit button', () => {
      render(<TradingPanel />);

      expect(screen.getByRole('button', { name: /place.*order/i })).toBeInTheDocument();
    });
  });

  describe('Side Selection', () => {
    it('switches to sell when sell tab clicked', async () => {
      const setSide = jest.fn();
      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        setSide,
      });

      render(<TradingPanel />);

      await userEvent.click(screen.getByRole('tab', { name: /sell/i }));

      expect(setSide).toHaveBeenCalledWith('sell');
    });

    it('applies correct styling for buy side', () => {
      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        side: 'buy',
      });

      render(<TradingPanel />);

      const buyTab = screen.getByRole('tab', { name: /buy/i });
      expect(buyTab).toHaveClass('bg-emerald');
    });

    it('applies correct styling for sell side', () => {
      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        side: 'sell',
      });

      render(<TradingPanel />);

      const sellTab = screen.getByRole('tab', { name: /sell/i });
      expect(sellTab).toHaveClass('bg-rose');
    });
  });

  describe('Input Validation', () => {
    it('shows error for negative price', async () => {
      render(<TradingPanel />);

      const priceInput = screen.getByLabelText(/price/i);
      await userEvent.type(priceInput, '-10');

      expect(screen.getByText(/price must be positive/i)).toBeInTheDocument();
    });

    it('shows error for zero amount', async () => {
      render(<TradingPanel />);

      const amountInput = screen.getByLabelText(/amount/i);
      await userEvent.type(amountInput, '0');

      expect(screen.getByText(/amount must be greater than 0/i)).toBeInTheDocument();
    });

    it('shows error for amount exceeding balance', async () => {
      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        side: 'sell',
      });

      render(<TradingPanel />);

      const amountInput = screen.getByLabelText(/amount/i);
      await userEvent.type(amountInput, '1000'); // More than 5.5 SOL balance

      expect(screen.getByText(/insufficient balance/i)).toBeInTheDocument();
    });
  });

  describe('Order Submission', () => {
    it('disables submit when inputs empty', () => {
      render(<TradingPanel />);

      const submitButton = screen.getByRole('button', { name: /place.*order/i });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit when inputs valid', async () => {
      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        price: '140.00',
        amount: '1.5',
      });

      render(<TradingPanel />);

      const submitButton = screen.getByRole('button', { name: /place.*order/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('encrypts order values before submission', async () => {
      const encryptValue = jest.fn().mockResolvedValue(new Uint8Array(64));
      mockUseEncryption.mockReturnValue({
        isInitialized: true,
        encryptValue,
      });

      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        price: '140.00',
        amount: '1.5',
      });

      render(<TradingPanel />);

      const submitButton = screen.getByRole('button', { name: /place.*order/i });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(encryptValue).toHaveBeenCalledTimes(2); // Price and amount
      });
    });

    it('shows loading state during submission', async () => {
      mockUseTradingStore.mockReturnValue({
        ...mockUseTradingStore(),
        price: '140.00',
        amount: '1.5',
      });

      render(<TradingPanel />);

      const submitButton = screen.getByRole('button', { name: /place.*order/i });
      await userEvent.click(submitButton);

      expect(screen.getByText(/placing order/i)).toBeInTheDocument();
    });
  });

  describe('Encryption Status', () => {
    it('shows encryption initializing state', () => {
      mockUseEncryption.mockReturnValue({
        isInitialized: false,
        isLoading: true,
      });

      render(<TradingPanel />);

      expect(screen.getByText(/initializing encryption/i)).toBeInTheDocument();
    });

    it('shows encryption error state', () => {
      mockUseEncryption.mockReturnValue({
        isInitialized: false,
        isLoading: false,
        error: new Error('Failed to initialize'),
      });

      render(<TradingPanel />);

      expect(screen.getByText(/encryption failed/i)).toBeInTheDocument();
    });

    it('disables trading when encryption not ready', () => {
      mockUseEncryption.mockReturnValue({
        isInitialized: false,
        isLoading: false,
      });

      render(<TradingPanel />);

      const submitButton = screen.getByRole('button', { name: /place.*order/i });
      expect(submitButton).toBeDisabled();
    });
  });
});
```

**Step 1.3: Order Book Tests**

```typescript
// frontend/src/__tests__/components/order-book.test.tsx

import { render, screen } from '../utils/test-utils';
import { OrderBook } from '@/components/order-book';

const mockOrderBook = {
  bids: [
    { price: 139.50, size: 10, total: 10 },
    { price: 139.00, size: 25, total: 35 },
    { price: 138.50, size: 15, total: 50 },
  ],
  asks: [
    { price: 140.00, size: 15, total: 15 },
    { price: 140.50, size: 20, total: 35 },
    { price: 141.00, size: 30, total: 65 },
  ],
};

describe('OrderBook', () => {
  describe('Rendering', () => {
    it('renders bid and ask columns', () => {
      render(<OrderBook data={mockOrderBook} />);

      expect(screen.getByText(/bids/i)).toBeInTheDocument();
      expect(screen.getByText(/asks/i)).toBeInTheDocument();
    });

    it('renders all bid levels', () => {
      render(<OrderBook data={mockOrderBook} />);

      expect(screen.getByText('139.50')).toBeInTheDocument();
      expect(screen.getByText('139.00')).toBeInTheDocument();
      expect(screen.getByText('138.50')).toBeInTheDocument();
    });

    it('renders all ask levels', () => {
      render(<OrderBook data={mockOrderBook} />);

      expect(screen.getByText('140.00')).toBeInTheDocument();
      expect(screen.getByText('140.50')).toBeInTheDocument();
      expect(screen.getByText('141.00')).toBeInTheDocument();
    });

    it('shows encrypted indicator for confidential order book', () => {
      render(<OrderBook data={mockOrderBook} isConfidential={true} />);

      expect(screen.getByText(/encrypted/i)).toBeInTheDocument();
    });
  });

  describe('Spread Calculation', () => {
    it('displays correct spread', () => {
      render(<OrderBook data={mockOrderBook} />);

      // Best ask (140.00) - Best bid (139.50) = 0.50
      expect(screen.getByText(/spread.*0\.50/i)).toBeInTheDocument();
    });

    it('displays spread percentage', () => {
      render(<OrderBook data={mockOrderBook} />);

      // 0.50 / 139.75 * 100 = ~0.36%
      expect(screen.getByText(/0\.3[56]%/)).toBeInTheDocument();
    });
  });

  describe('Depth Visualization', () => {
    it('renders depth bars for bids', () => {
      render(<OrderBook data={mockOrderBook} />);

      const bidRows = screen.getAllByTestId(/bid-row/);
      expect(bidRows).toHaveLength(3);

      // Check depth bar widths are proportional
      bidRows.forEach((row, index) => {
        const depthBar = row.querySelector('[data-testid="depth-bar"]');
        expect(depthBar).toHaveStyle({
          width: expect.stringMatching(/\d+%/),
        });
      });
    });
  });

  describe('Click Interaction', () => {
    it('calls onPriceClick when bid price clicked', async () => {
      const onPriceClick = jest.fn();
      render(<OrderBook data={mockOrderBook} onPriceClick={onPriceClick} />);

      const bidPrice = screen.getByText('139.50');
      await userEvent.click(bidPrice);

      expect(onPriceClick).toHaveBeenCalledWith(139.50);
    });

    it('calls onPriceClick when ask price clicked', async () => {
      const onPriceClick = jest.fn();
      render(<OrderBook data={mockOrderBook} onPriceClick={onPriceClick} />);

      const askPrice = screen.getByText('140.00');
      await userEvent.click(askPrice);

      expect(onPriceClick).toHaveBeenCalledWith(140.00);
    });
  });

  describe('Empty State', () => {
    it('shows no data message when order book empty', () => {
      render(<OrderBook data={{ bids: [], asks: [] }} />);

      expect(screen.getByText(/no orders/i)).toBeInTheDocument();
    });
  });
});
```

---

### Task 2: Backend Crank Service Tests

**New Files:**
- `backend/src/crank/__tests__/match-executor.test.ts`
- `backend/src/crank/__tests__/settlement-executor.test.ts`
- `backend/src/crank/__tests__/order-monitor.test.ts`
- `backend/src/__tests__/lib/retry.test.ts`

**Step 2.1: Match Executor Tests**

```typescript
// backend/src/crank/__tests__/match-executor.test.ts

import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { MatchExecutor } from '../match-executor.js';
import { DistributedLockManager } from '../distributed-lock.js';
import { DatabaseClient } from '../../db/client.js';

// Mock dependencies
jest.mock('@solana/web3.js', () => ({
  ...jest.requireActual('@solana/web3.js'),
  Connection: jest.fn().mockImplementation(() => ({
    getAccountInfo: jest.fn(),
    sendTransaction: jest.fn(),
    confirmTransaction: jest.fn(),
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: 'test-blockhash',
      lastValidBlockHeight: 1000,
    }),
  })),
}));

jest.mock('../../db/client.js');
jest.mock('../distributed-lock.js');

describe('MatchExecutor', () => {
  let executor: MatchExecutor;
  let mockConnection: jest.Mocked<Connection>;
  let mockLockManager: jest.Mocked<DistributedLockManager>;
  let crankKeypair: Keypair;

  beforeEach(() => {
    crankKeypair = Keypair.generate();
    mockConnection = new Connection('https://api.devnet.solana.com') as jest.Mocked<Connection>;

    mockLockManager = {
      acquire: jest.fn().mockResolvedValue({
        key: 'test-lock',
        release: jest.fn(),
      }),
      release: jest.fn(),
      releaseAll: jest.fn(),
    } as unknown as jest.Mocked<DistributedLockManager>;

    executor = new MatchExecutor(
      mockConnection,
      crankKeypair,
      {
        programs: { confidexDex: 'TestProgramId' },
        pollingIntervalMs: 5000,
        useAsyncMpc: true,
        maxConcurrentMatches: 5,
      },
      mockLockManager
    );
  });

  describe('executeMatch', () => {
    const buyOrder = new PublicKey('BuyOrderPda11111111111111111111111111111111');
    const sellOrder = new PublicKey('SellOrderPda1111111111111111111111111111111');

    it('acquires lock before processing', async () => {
      mockConnection.sendTransaction.mockResolvedValue('test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({ value: { err: null } });

      await executor.executeMatch(buyOrder, sellOrder);

      expect(mockLockManager.acquire).toHaveBeenCalledWith(
        expect.stringContaining('match:'),
        expect.any(Object)
      );
    });

    it('releases lock after completion', async () => {
      const releaseFn = jest.fn();
      mockLockManager.acquire.mockResolvedValue({
        key: 'test-lock',
        release: releaseFn,
      });

      mockConnection.sendTransaction.mockResolvedValue('test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({ value: { err: null } });

      await executor.executeMatch(buyOrder, sellOrder);

      expect(releaseFn).toHaveBeenCalled();
    });

    it('skips if lock cannot be acquired', async () => {
      mockLockManager.acquire.mockResolvedValue(null);

      const result = await executor.executeMatch(buyOrder, sellOrder);

      expect(result).toBe(false);
      expect(mockConnection.sendTransaction).not.toHaveBeenCalled();
    });

    it('retries on network error', async () => {
      mockConnection.sendTransaction
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce('test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({ value: { err: null } });

      await executor.executeMatch(buyOrder, sellOrder);

      expect(mockConnection.sendTransaction).toHaveBeenCalledTimes(2);
    });

    it('fails immediately on non-retryable error', async () => {
      mockConnection.sendTransaction.mockRejectedValue(
        new Error('custom program error: 0x1782') // InsufficientBalance
      );

      const result = await executor.executeMatch(buyOrder, sellOrder);

      expect(result).toBe(false);
      expect(mockConnection.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('records transaction in history', async () => {
      const mockTxHistory = {
        create: jest.fn(),
        updateStatus: jest.fn(),
      };

      // Inject mock
      (executor as any).txHistory = mockTxHistory;

      mockConnection.sendTransaction.mockResolvedValue('test-signature');
      mockConnection.confirmTransaction.mockResolvedValue({ value: { err: null } });

      await executor.executeMatch(buyOrder, sellOrder);

      expect(mockTxHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tx_type: 'match',
          status: 'pending',
        })
      );
    });
  });

  describe('buildMatchInstruction', () => {
    it('creates instruction with correct accounts', () => {
      const buyOrder = new PublicKey('BuyOrderPda11111111111111111111111111111111');
      const sellOrder = new PublicKey('SellOrderPda1111111111111111111111111111111');

      const instruction = (executor as any).buildMatchInstruction(buyOrder, sellOrder);

      expect(instruction.keys).toHaveLength(expect.any(Number));
      expect(instruction.keys[0].pubkey.equals(buyOrder)).toBe(true);
      expect(instruction.keys[1].pubkey.equals(sellOrder)).toBe(true);
    });

    it('sets crank as signer', () => {
      const buyOrder = new PublicKey('BuyOrderPda11111111111111111111111111111111');
      const sellOrder = new PublicKey('SellOrderPda1111111111111111111111111111111');

      const instruction = (executor as any).buildMatchInstruction(buyOrder, sellOrder);

      const crankAccount = instruction.keys.find(
        k => k.pubkey.equals(crankKeypair.publicKey)
      );
      expect(crankAccount?.isSigner).toBe(true);
    });
  });
});
```

**Step 2.2: Retry Logic Tests**

```typescript
// backend/src/__tests__/lib/retry.test.ts

import { withRetry, isRetryableError, isSolanaFatalError } from '../../lib/retry.js';

describe('withRetry', () => {
  describe('successful execution', () => {
    it('returns value on first success', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns value after retry', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce('success');

      const result = await withRetry(fn, { initialDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(2);
    });
  });

  describe('failure handling', () => {
    it('fails after max attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('timeout'));

      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('fails immediately on non-retryable error', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('insufficient funds'));

      const result = await withRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 10,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('respects max time limit', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('timeout'));

      const startTime = Date.now();
      const result = await withRetry(fn, {
        maxAttempts: 100,
        maxTimeMs: 500,
        initialDelayMs: 100,
      });

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(600);
      expect(result.success).toBe(false);
    });
  });

  describe('exponential backoff', () => {
    it('increases delay exponentially', async () => {
      const delays: number[] = [];
      const fn = jest.fn().mockRejectedValue(new Error('timeout'));

      await withRetry(fn, {
        maxAttempts: 4,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0, // Disable jitter for predictable test
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });

      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(400);
    });

    it('caps delay at maxDelayMs', async () => {
      const delays: number[] = [];
      const fn = jest.fn().mockRejectedValue(new Error('timeout'));

      await withRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });

      expect(delays[3]).toBeLessThanOrEqual(2000);
    });
  });

  describe('callbacks', () => {
    it('calls onRetry with error and attempt info', async () => {
      const onRetry = jest.fn();
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('first error'))
        .mockResolvedValueOnce('success');

      await withRetry(fn, { initialDelayMs: 10, onRetry });

      expect(onRetry).toHaveBeenCalledWith(
        expect.any(Error),
        1,
        expect.any(Number)
      );
    });
  });
});

describe('isRetryableError', () => {
  const retryableMessages = [
    'Connection timeout',
    'ECONNRESET',
    'Network error',
    'socket hang up',
    'Error 429: Too many requests',
    '503 Service Unavailable',
    'Blockhash not found',
    'Node is behind',
  ];

  const nonRetryableMessages = [
    'Insufficient funds',
    'Account not found',
    'Invalid account owner',
    'Custom program error: 0x1',
  ];

  retryableMessages.forEach(msg => {
    it(`returns true for "${msg}"`, () => {
      expect(isRetryableError(new Error(msg))).toBe(true);
    });
  });

  nonRetryableMessages.forEach(msg => {
    it(`returns false for "${msg}"`, () => {
      expect(isRetryableError(new Error(msg))).toBe(false);
    });
  });
});

describe('isSolanaFatalError', () => {
  it('identifies insufficient funds as fatal', () => {
    expect(isSolanaFatalError(new Error('Insufficient funds for transaction'))).toBe(true);
  });

  it('identifies account not found as fatal', () => {
    expect(isSolanaFatalError(new Error('Account not found'))).toBe(true);
  });

  it('does not flag network errors as fatal', () => {
    expect(isSolanaFatalError(new Error('Connection timeout'))).toBe(false);
  });
});
```

---

### Task 3: E2E Test Automation

**New Files:**
- `tests/e2e/order-flow.spec.ts`
- `tests/e2e/setup.ts`
- `tests/e2e/helpers.ts`

**Step 3.1: E2E Test Setup**

```typescript
// tests/e2e/setup.ts

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createMint, mintTo } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

export const DEVNET_URL = process.env.E2E_RPC_URL || 'https://api.devnet.solana.com';
export const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

export interface TestContext {
  connection: Connection;
  buyer: Keypair;
  seller: Keypair;
  baseMint: PublicKey; // SOL
  quoteMint: PublicKey; // USDC
  pairPda: PublicKey;
}

export async function setupTestContext(): Promise<TestContext> {
  const connection = new Connection(DEVNET_URL, 'confirmed');

  // Load or generate test keypairs
  const buyer = loadOrGenerateKeypair('e2e-buyer');
  const seller = loadOrGenerateKeypair('e2e-seller');

  // Ensure wallets have SOL
  await ensureFunded(connection, buyer.publicKey, 2 * LAMPORTS_PER_SOL);
  await ensureFunded(connection, seller.publicKey, 2 * LAMPORTS_PER_SOL);

  // Standard mints
  const baseMint = new PublicKey('So11111111111111111111111111111111111111112');
  const quoteMint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

  // Derive pair PDA
  const [pairPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pair'), baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );

  return {
    connection,
    buyer,
    seller,
    baseMint,
    quoteMint,
    pairPda,
  };
}

function loadOrGenerateKeypair(name: string): Keypair {
  const keyPath = path.join(__dirname, 'keys', `${name}.json`);

  if (fs.existsSync(keyPath)) {
    const data = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }

  const keypair = Keypair.generate();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

async function ensureFunded(connection: Connection, pubkey: PublicKey, minBalance: number): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance < minBalance) {
    console.log(`Airdropping to ${pubkey.toBase58()}...`);
    const sig = await connection.requestAirdrop(pubkey, minBalance - balance);
    await connection.confirmTransaction(sig);
  }
}

export async function cleanupTestOrders(ctx: TestContext): Promise<void> {
  // Cancel any pending orders from test accounts
  // ... implementation
}
```

**Step 3.2: Order Flow E2E Tests**

```typescript
// tests/e2e/order-flow.spec.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { setupTestContext, cleanupTestOrders, TestContext, CONFIDEX_PROGRAM_ID } from './setup';
import {
  createPlaceOrderInstruction,
  createCancelOrderInstruction,
  encryptOrderValues,
  generateEligibilityProof,
  waitForOrderMatch,
  getOrderAccount,
} from './helpers';

describe('Order Flow E2E', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestContext();
  }, 60000);

  afterAll(async () => {
    await cleanupTestOrders(ctx);
  });

  describe('Place Order', () => {
    it('should place a buy order successfully', async () => {
      // Generate ZK proof
      const proof = await generateEligibilityProof(ctx.buyer.publicKey);

      // Encrypt order values
      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(1_000_000_000), // 1 SOL
        price: BigInt(140_000_000), // $140
      });

      // Build transaction
      const tx = new Transaction();
      const orderKeypair = Keypair.generate();

      tx.add(
        createPlaceOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          pairPda: ctx.pairPda,
          userPubkey: ctx.buyer.publicKey,
          orderPubkey: orderKeypair.publicKey,
          side: 'buy',
          encryptedAmount,
          encryptedPrice,
          ephemeralPubkey,
          proof,
        })
      );

      // Send transaction
      const signature = await sendAndConfirmTransaction(
        ctx.connection,
        tx,
        [ctx.buyer, orderKeypair],
        { commitment: 'confirmed' }
      );

      expect(signature).toBeDefined();

      // Verify order account created
      const orderAccount = await getOrderAccount(ctx.connection, orderKeypair.publicKey);
      expect(orderAccount).toBeDefined();
      expect(orderAccount.status).toBe('Active');
      expect(orderAccount.side).toBe('Buy');
    }, 30000);

    it('should place a sell order successfully', async () => {
      const proof = await generateEligibilityProof(ctx.seller.publicKey);

      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(1_000_000_000),
        price: BigInt(139_000_000), // $139
      });

      const tx = new Transaction();
      const orderKeypair = Keypair.generate();

      tx.add(
        createPlaceOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          pairPda: ctx.pairPda,
          userPubkey: ctx.seller.publicKey,
          orderPubkey: orderKeypair.publicKey,
          side: 'sell',
          encryptedAmount,
          encryptedPrice,
          ephemeralPubkey,
          proof,
        })
      );

      const signature = await sendAndConfirmTransaction(
        ctx.connection,
        tx,
        [ctx.seller, orderKeypair],
        { commitment: 'confirmed' }
      );

      expect(signature).toBeDefined();

      const orderAccount = await getOrderAccount(ctx.connection, orderKeypair.publicKey);
      expect(orderAccount.side).toBe('Sell');
    }, 30000);

    it('should reject order without valid ZK proof', async () => {
      const invalidProof = new Uint8Array(388).fill(0);

      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(1_000_000_000),
        price: BigInt(140_000_000),
      });

      const tx = new Transaction();
      const orderKeypair = Keypair.generate();

      tx.add(
        createPlaceOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          pairPda: ctx.pairPda,
          userPubkey: ctx.buyer.publicKey,
          orderPubkey: orderKeypair.publicKey,
          side: 'buy',
          encryptedAmount,
          encryptedPrice,
          ephemeralPubkey,
          proof: invalidProof,
        })
      );

      await expect(
        sendAndConfirmTransaction(ctx.connection, tx, [ctx.buyer, orderKeypair])
      ).rejects.toThrow(/ZkVerificationFailed|InvalidProof/i);
    }, 30000);
  });

  describe('Order Matching', () => {
    let buyOrderPda: PublicKey;
    let sellOrderPda: PublicKey;

    beforeEach(async () => {
      // Place matching orders
      buyOrderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 140_000_000n);
      sellOrderPda = await placeTestOrder(ctx, ctx.seller, 'sell', 139_000_000n);
    }, 60000);

    it('should match compatible orders via crank', async () => {
      // Wait for crank to match orders (polling)
      const matchResult = await waitForOrderMatch(ctx.connection, buyOrderPda, sellOrderPda, {
        timeoutMs: 60000,
        pollIntervalMs: 2000,
      });

      expect(matchResult.matched).toBe(true);

      // Verify order statuses updated
      const buyOrder = await getOrderAccount(ctx.connection, buyOrderPda);
      const sellOrder = await getOrderAccount(ctx.connection, sellOrderPda);

      expect(buyOrder.status).toMatch(/Filled|PartiallyFilled/);
      expect(sellOrder.status).toMatch(/Filled|PartiallyFilled/);
    }, 90000);

    it('should execute MPC price comparison', async () => {
      // The match process should trigger MPC
      const matchResult = await waitForOrderMatch(ctx.connection, buyOrderPda, sellOrderPda, {
        timeoutMs: 60000,
      });

      // Check MPC callback occurred
      expect(matchResult.mpcCallbackReceived).toBe(true);
    }, 90000);
  });

  describe('Order Cancellation', () => {
    it('should cancel an active order', async () => {
      const orderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 150_000_000n);

      const tx = new Transaction();
      tx.add(
        createCancelOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          orderPda,
          userPubkey: ctx.buyer.publicKey,
        })
      );

      const signature = await sendAndConfirmTransaction(
        ctx.connection,
        tx,
        [ctx.buyer],
        { commitment: 'confirmed' }
      );

      expect(signature).toBeDefined();

      const orderAccount = await getOrderAccount(ctx.connection, orderPda);
      expect(orderAccount.status).toBe('Cancelled');
    }, 30000);

    it('should not cancel another users order', async () => {
      const orderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 150_000_000n);

      const tx = new Transaction();
      tx.add(
        createCancelOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          orderPda,
          userPubkey: ctx.seller.publicKey, // Wrong user
        })
      );

      await expect(
        sendAndConfirmTransaction(ctx.connection, tx, [ctx.seller])
      ).rejects.toThrow(/Unauthorized/i);
    }, 30000);
  });

  describe('Settlement', () => {
    it('should settle matched orders and transfer tokens', async () => {
      // Place matching orders
      const buyOrderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 140_000_000n);
      const sellOrderPda = await placeTestOrder(ctx, ctx.seller, 'sell', 139_000_000n);

      // Get initial balances
      const [initialBuyerQuote, initialSellerBase] = await Promise.all([
        getUserBalance(ctx, ctx.buyer.publicKey, ctx.quoteMint),
        getUserBalance(ctx, ctx.seller.publicKey, ctx.baseMint),
      ]);

      // Wait for match and settlement
      await waitForOrderMatch(ctx.connection, buyOrderPda, sellOrderPda, {
        timeoutMs: 120000,
      });

      // Wait additional time for settlement
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Get final balances
      const [finalBuyerQuote, finalSellerBase] = await Promise.all([
        getUserBalance(ctx, ctx.buyer.publicKey, ctx.quoteMint),
        getUserBalance(ctx, ctx.seller.publicKey, ctx.baseMint),
      ]);

      // Verify token transfers occurred
      // Buyer spent USDC, received SOL
      expect(finalBuyerQuote).toBeLessThan(initialBuyerQuote);

      // Seller spent SOL, received USDC
      expect(finalSellerBase).toBeLessThan(initialSellerBase);
    }, 180000);
  });
});

// Helper to place test order
async function placeTestOrder(
  ctx: TestContext,
  user: Keypair,
  side: 'buy' | 'sell',
  price: bigint
): Promise<PublicKey> {
  const proof = await generateEligibilityProof(user.publicKey);
  const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
    amount: BigInt(100_000_000), // 0.1 SOL
    price,
  });

  const orderKeypair = Keypair.generate();
  const tx = new Transaction();

  tx.add(
    createPlaceOrderInstruction({
      programId: CONFIDEX_PROGRAM_ID,
      pairPda: ctx.pairPda,
      userPubkey: user.publicKey,
      orderPubkey: orderKeypair.publicKey,
      side,
      encryptedAmount,
      encryptedPrice,
      ephemeralPubkey,
      proof,
    })
  );

  await sendAndConfirmTransaction(ctx.connection, tx, [user, orderKeypair]);

  return orderKeypair.publicKey;
}
```

---

### Task 4: On-Chain Program Tests

**Files to Modify:**
- `programs/confidex_dex/tests/mod.rs`

**Step 4.1: Create Anchor Integration Tests**

```rust
// programs/confidex_dex/tests/integration.rs

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_spl::token::{Token, TokenAccount};
use confidex_dex::state::*;
use confidex_dex::instructions::*;
use solana_program_test::*;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};

#[tokio::test]
async fn test_initialize_exchange() {
    let program_id = confidex_dex::ID;
    let mut program_test = ProgramTest::new(
        "confidex_dex",
        program_id,
        processor!(confidex_dex::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    // Derive exchange PDA
    let (exchange_pda, bump) = Pubkey::find_program_address(
        &[ExchangeState::SEED],
        &program_id,
    );

    // Build initialize instruction
    let ix = confidex_dex::instruction::initialize(
        &program_id,
        &payer.pubkey(),
        &exchange_pda,
        100, // 1% fee
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );

    banks_client.process_transaction(tx).await.unwrap();

    // Verify exchange account
    let exchange_account = banks_client
        .get_account(exchange_pda)
        .await
        .unwrap()
        .unwrap();

    let exchange_state: ExchangeState = ExchangeState::try_deserialize(
        &mut exchange_account.data.as_ref()
    ).unwrap();

    assert_eq!(exchange_state.admin, payer.pubkey());
    assert_eq!(exchange_state.fee_bps, 100);
    assert!(!exchange_state.paused);
}

#[tokio::test]
async fn test_place_order() {
    let (mut banks_client, payer, exchange_pda, pair_pda) = setup_exchange().await;

    let user = Keypair::new();
    let order = Keypair::new();

    // Airdrop to user
    airdrop(&mut banks_client, &user.pubkey(), 1_000_000_000).await;

    // Create encrypted values (mock for test)
    let encrypted_amount = [0u8; 64];
    let encrypted_price = [0u8; 64];
    let eligibility_proof = [0u8; 388];
    let ephemeral_pubkey = [0u8; 32];

    let ix = confidex_dex::instruction::place_order(
        &confidex_dex::ID,
        &exchange_pda,
        &pair_pda,
        &user.pubkey(),
        &order.pubkey(),
        encrypted_amount,
        encrypted_price,
        Side::Buy,
        OrderType::Limit,
        eligibility_proof,
        ephemeral_pubkey,
    );

    let recent_blockhash = banks_client.get_recent_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &user, &order],
        recent_blockhash,
    );

    banks_client.process_transaction(tx).await.unwrap();

    // Verify order created
    let order_account = banks_client
        .get_account(order.pubkey())
        .await
        .unwrap()
        .unwrap();

    let order_state: ConfidentialOrder = ConfidentialOrder::try_deserialize(
        &mut order_account.data.as_ref()
    ).unwrap();

    assert_eq!(order_state.maker, user.pubkey());
    assert_eq!(order_state.status, OrderStatus::Active);
    assert_eq!(order_state.side, Side::Buy);
}

#[tokio::test]
async fn test_cancel_order() {
    let (mut banks_client, payer, exchange_pda, pair_pda) = setup_exchange().await;

    // Place order first
    let (user, order_pda) = place_test_order(&mut banks_client, &payer, &exchange_pda, &pair_pda).await;

    // Cancel order
    let ix = confidex_dex::instruction::cancel_order(
        &confidex_dex::ID,
        &order_pda,
        &user.pubkey(),
    );

    let recent_blockhash = banks_client.get_recent_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &user],
        recent_blockhash,
    );

    banks_client.process_transaction(tx).await.unwrap();

    // Verify order cancelled
    let order_account = banks_client
        .get_account(order_pda)
        .await
        .unwrap()
        .unwrap();

    let order_state: ConfidentialOrder = ConfidentialOrder::try_deserialize(
        &mut order_account.data.as_ref()
    ).unwrap();

    assert_eq!(order_state.status, OrderStatus::Cancelled);
}

#[tokio::test]
async fn test_cancel_order_unauthorized() {
    let (mut banks_client, payer, exchange_pda, pair_pda) = setup_exchange().await;

    // Place order
    let (user, order_pda) = place_test_order(&mut banks_client, &payer, &exchange_pda, &pair_pda).await;

    // Try to cancel with different user
    let attacker = Keypair::new();
    airdrop(&mut banks_client, &attacker.pubkey(), 1_000_000_000).await;

    let ix = confidex_dex::instruction::cancel_order(
        &confidex_dex::ID,
        &order_pda,
        &attacker.pubkey(),
    );

    let recent_blockhash = banks_client.get_recent_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &attacker],
        recent_blockhash,
    );

    // Should fail with Unauthorized error
    let result = banks_client.process_transaction(tx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_wrap_tokens() {
    let (mut banks_client, payer, exchange_pda, pair_pda) = setup_exchange().await;

    let user = Keypair::new();
    airdrop(&mut banks_client, &user.pubkey(), 5_000_000_000).await;

    // Get vaults from pair
    let pair_account = banks_client.get_account(pair_pda).await.unwrap().unwrap();
    let pair_state: TradingPair = TradingPair::try_deserialize(
        &mut pair_account.data.as_ref()
    ).unwrap();

    // Wrap 1 SOL
    let amount = 1_000_000_000u64;

    let ix = confidex_dex::instruction::wrap_tokens(
        &confidex_dex::ID,
        &exchange_pda,
        &pair_pda,
        &pair_state.base_mint,
        &user.pubkey(),
        &pair_state.c_base_vault,
        amount,
    );

    let recent_blockhash = banks_client.get_recent_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &user],
        recent_blockhash,
    );

    banks_client.process_transaction(tx).await.unwrap();

    // Verify user balance updated
    let (user_balance_pda, _) = Pubkey::find_program_address(
        &[
            UserConfidentialBalance::SEED,
            user.pubkey().as_ref(),
            pair_state.base_mint.as_ref(),
        ],
        &confidex_dex::ID,
    );

    let balance_account = banks_client
        .get_account(user_balance_pda)
        .await
        .unwrap()
        .unwrap();

    let balance: UserConfidentialBalance = UserConfidentialBalance::try_deserialize(
        &mut balance_account.data.as_ref()
    ).unwrap();

    assert_eq!(balance.get_balance(), amount);
}

// Helper functions

async fn setup_exchange() -> (BanksClient, Keypair, Pubkey, Pubkey) {
    // ... setup code
}

async fn place_test_order(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    exchange_pda: &Pubkey,
    pair_pda: &Pubkey,
) -> (Keypair, Pubkey) {
    // ... place order helper
}

async fn airdrop(banks_client: &mut BanksClient, to: &Pubkey, lamports: u64) {
    // ... airdrop helper
}
```

---

### Task 5: Coverage Configuration

**Step 5.1: Frontend Coverage Config**

```typescript
// frontend/vitest.config.ts

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/__tests__/**',
        'src/**/index.ts',
        'src/app/api/**', // API routes tested separately
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },
  },
});
```

**Step 5.2: Backend Coverage Config**

```typescript
// backend/vitest.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/__tests__/**',
        'src/**/index.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});
```

---

## Acceptance Criteria

- [ ] **Frontend Tests**
  - [ ] TradingPanel component >80% coverage
  - [ ] OrderBook component >80% coverage
  - [ ] BalanceDisplay component >80% coverage
  - [ ] All hooks >70% coverage
  - [ ] Total frontend coverage >70%

- [ ] **Backend Tests**
  - [ ] MatchExecutor >90% coverage
  - [ ] SettlementExecutor >90% coverage
  - [ ] OrderMonitor >80% coverage
  - [ ] Retry utilities 100% coverage
  - [ ] Total backend coverage >80%

- [ ] **E2E Tests**
  - [ ] Place buy order flow passes
  - [ ] Place sell order flow passes
  - [ ] Order matching flow passes
  - [ ] Order cancellation flow passes
  - [ ] Settlement flow passes

- [ ] **On-Chain Tests**
  - [ ] Initialize exchange test passes
  - [ ] Place order test passes
  - [ ] Cancel order test passes
  - [ ] Wrap tokens test passes
  - [ ] Unauthorized access tests pass

- [ ] **CI Integration**
  - [ ] Coverage thresholds block failing PRs
  - [ ] Test results visible in PR checks
  - [ ] Coverage reports generated

---

## Test Commands

```bash
# Frontend
cd frontend
pnpm test                    # Run all tests
pnpm test:coverage           # Run with coverage
pnpm test:watch              # Watch mode

# Backend
cd backend
pnpm test                    # Run all tests
pnpm test:coverage           # Run with coverage

# E2E
cd tests/e2e
pnpm test                    # Run E2E tests (requires devnet)

# On-chain
anchor test                  # Run Anchor tests
anchor test --skip-local-validator  # Against devnet
```

---

## References

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Anchor Testing Guide](https://www.anchor-lang.com/docs/testing)
- [Solana Program Test](https://docs.rs/solana-program-test/latest/)
