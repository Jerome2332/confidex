import { create } from 'zustand';

export interface BalanceState {
  // Wrapped balances (in smallest units)
  wrappedSol: bigint;
  wrappedUsdc: bigint;

  // UI-friendly formatted amounts
  wrappedSolUi: string;
  wrappedUsdcUi: string;

  // Amounts locked in open orders
  solInOrders: bigint;
  usdcInOrders: bigint;

  // Loading state
  isLoading: boolean;
  lastUpdated: Date | null;

  // Actions
  setWrappedBalances: (sol: bigint, usdc: bigint) => void;
  setInOrdersAmounts: (sol: bigint, usdc: bigint) => void;
  setLoading: (loading: boolean) => void;

  // Computed helpers
  getAvailableSol: () => bigint;
  getAvailableUsdc: () => bigint;
}

/**
 * Format balance to UI-friendly string
 */
function formatBalance(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  const fractionStr = remainder.toString().padStart(decimals, '0');

  if (decimals === 9) {
    // SOL: show up to 4 decimal places
    return `${whole}.${fractionStr.slice(0, 4)}`;
  } else {
    // USDC: show 2 decimal places
    return `${whole}.${fractionStr.slice(0, 2)}`;
  }
}

export const useBalanceStore = create<BalanceState>((set, get) => ({
  // Initial state
  wrappedSol: BigInt(0),
  wrappedUsdc: BigInt(0),
  wrappedSolUi: '0',
  wrappedUsdcUi: '0.00',
  solInOrders: BigInt(0),
  usdcInOrders: BigInt(0),
  isLoading: false,
  lastUpdated: null,

  // Set wrapped balances
  setWrappedBalances: (sol, usdc) =>
    set({
      wrappedSol: sol,
      wrappedUsdc: usdc,
      wrappedSolUi: formatBalance(sol, 9),
      wrappedUsdcUi: formatBalance(usdc, 6),
      lastUpdated: new Date(),
    }),

  // Set amounts locked in orders
  setInOrdersAmounts: (sol, usdc) =>
    set({
      solInOrders: sol,
      usdcInOrders: usdc,
    }),

  // Set loading state
  setLoading: (isLoading) => set({ isLoading }),

  // Get available SOL (wrapped - in orders)
  getAvailableSol: () => {
    const state = get();
    const available = state.wrappedSol - state.solInOrders;
    return available > BigInt(0) ? available : BigInt(0);
  },

  // Get available USDC (wrapped - in orders)
  getAvailableUsdc: () => {
    const state = get();
    const available = state.wrappedUsdc - state.usdcInOrders;
    return available > BigInt(0) ? available : BigInt(0);
  },
}));

/**
 * Helper to check if user has sufficient balance for an order
 */
export function hasSufficientBalance(
  side: 'buy' | 'sell',
  amount: bigint,
  price: bigint
): { sufficient: boolean; required: bigint; available: bigint; token: string } {
  const state = useBalanceStore.getState();

  if (side === 'sell') {
    // Selling SOL: need SOL balance
    const available = state.getAvailableSol();
    return {
      sufficient: available >= amount,
      required: amount,
      available,
      token: 'SOL',
    };
  } else {
    // Buying SOL: need USDC balance (amount * price)
    // Note: amount is in lamports (9 decimals), price is in USDC cents (6 decimals)
    // Total USDC needed = (amount / 1e9) * (price / 1e6) * 1e6 = amount * price / 1e9
    const totalUsdc = (amount * price) / BigInt(1e9);
    const available = state.getAvailableUsdc();
    return {
      sufficient: available >= totalUsdc,
      required: totalUsdc,
      available,
      token: 'USDC',
    };
  }
}
