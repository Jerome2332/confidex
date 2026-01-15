import { create } from 'zustand';
import { PublicKey } from '@solana/web3.js';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'pending' | 'open' | 'partial' | 'filled' | 'cancelled';
export type ProofStatus = 'idle' | 'generating' | 'ready' | 'failed';

export interface Order {
  id: string;
  maker: PublicKey;
  pair: string;
  side: OrderSide;
  type: OrderType;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  encryptedFilled: Uint8Array;
  status: OrderStatus;
  createdAt: Date;
  filledPercent: number;
}

export interface OrderInput {
  pair: string;
  side: OrderSide;
  type: OrderType;
  amount: string;
  price: string;
}

interface OrderState {
  // Current order form
  currentOrder: OrderInput;
  setCurrentOrder: (order: Partial<OrderInput>) => void;
  resetCurrentOrder: () => void;

  // Proof generation status
  proofStatus: ProofStatus;
  setProofStatus: (status: ProofStatus) => void;

  // Open orders
  openOrders: Order[];
  addOrder: (order: Order) => void;
  removeOrder: (id: string) => void;
  updateOrderStatus: (id: string, status: OrderStatus, filledPercent?: number) => void;

  // Order history
  orderHistory: Order[];

  // Loading states
  isPlacingOrder: boolean;
  isCancellingOrder: string | null;
  setIsPlacingOrder: (value: boolean) => void;
  setIsCancellingOrder: (id: string | null) => void;
}

const defaultOrder: OrderInput = {
  pair: 'SOL/USDC',
  side: 'buy',
  type: 'limit',
  amount: '',
  price: '',
};

export const useOrderStore = create<OrderState>((set) => ({
  // Current order form
  currentOrder: defaultOrder,
  setCurrentOrder: (order) =>
    set((state) => ({
      currentOrder: { ...state.currentOrder, ...order },
    })),
  resetCurrentOrder: () => set({ currentOrder: defaultOrder }),

  // Proof status
  proofStatus: 'idle',
  setProofStatus: (proofStatus) => set({ proofStatus }),

  // Open orders
  openOrders: [],
  addOrder: (order) =>
    set((state) => ({
      openOrders: [order, ...state.openOrders],
    })),
  removeOrder: (id) =>
    set((state) => ({
      openOrders: state.openOrders.filter((o) => o.id !== id),
      orderHistory: [
        ...state.orderHistory,
        ...state.openOrders
          .filter((o) => o.id === id)
          .map((o) => ({ ...o, status: 'cancelled' as OrderStatus })),
      ],
    })),
  updateOrderStatus: (id, status, filledPercent) =>
    set((state) => ({
      openOrders: state.openOrders.map((o) =>
        o.id === id
          ? { ...o, status, filledPercent: filledPercent ?? o.filledPercent }
          : o
      ),
    })),

  // Order history
  orderHistory: [],

  // Loading states
  isPlacingOrder: false,
  isCancellingOrder: null,
  setIsPlacingOrder: (isPlacingOrder) => set({ isPlacingOrder }),
  setIsCancellingOrder: (isCancellingOrder) => set({ isCancellingOrder }),
}));
