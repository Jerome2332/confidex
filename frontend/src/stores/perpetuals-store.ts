import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PublicKey } from '@solana/web3.js';

export type PositionSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closing' | 'closed' | 'liquidated' | 'auto_deleveraged';
export type MarginMode = 'cross' | 'isolated';

export interface PerpPosition {
  id: string;
  positionId: number;
  market: PublicKey;
  marketSymbol: string;
  trader: PublicKey;
  side: PositionSide;
  leverage: number;
  // Encrypted values - displayed as status indicators
  encryptedSize: Uint8Array;
  encryptedEntryPrice: Uint8Array;
  encryptedCollateral: Uint8Array;
  encryptedRealizedPnl: Uint8Array;
  // Public liquidation thresholds
  liquidatableBelowPrice: number;
  liquidatableAbovePrice: number;
  thresholdVerified: boolean;
  // Funding
  entryCumulativeFunding: bigint;
  pendingFunding: bigint;
  // Status
  status: PositionStatus;
  createdAt: Date;
  lastUpdated: Date;
  partialCloseCount: number;
  autoDeleveragePriority: number;
}

export interface PerpMarket {
  address: PublicKey;
  symbol: string;
  underlyingMint: PublicKey;
  quoteMint: PublicKey;
  maxLeverage: number;
  maintenanceMarginBps: number;
  initialMarginBps: number;
  takerFeeBps: number;
  makerFeeBps: number;
  liquidationFeeBps: number;
  minPositionSize: number;
  tickSize: number;
  totalLongOpenInterest: bigint;
  totalShortOpenInterest: bigint;
  oraclePriceFeed: PublicKey;
  collateralVault: PublicKey;
  insuranceFund: PublicKey;
  cumulativeFundingLong: bigint;
  cumulativeFundingShort: bigint;
  lastFundingTime: Date;
  active: boolean;
}

export interface FundingRateInfo {
  market: PublicKey;
  currentRateBps: number;
  fundingIntervalSeconds: number;
  maxFundingRateBps: number;
  hourlyRates: number[];
  lastCalculationTime: Date;
  nextFundingTime: Date;
}

export interface OpenPositionInput {
  market: string;
  side: PositionSide;
  leverage: number;
  size: string;
  collateral: string;
}

interface PerpetualState {
  // Current position form
  currentInput: OpenPositionInput;
  setCurrentInput: (input: Partial<OpenPositionInput>) => void;
  resetCurrentInput: () => void;

  // Settings
  defaultLeverage: number;
  maxLeverage: number;
  marginMode: MarginMode;
  setDefaultLeverage: (leverage: number) => void;
  setMaxLeverage: (leverage: number) => void;
  setMarginMode: (mode: MarginMode) => void;

  // Open positions
  positions: PerpPosition[];
  setPositions: (positions: PerpPosition[]) => void;
  addPosition: (position: PerpPosition) => void;
  updatePosition: (id: string, updates: Partial<PerpPosition>) => void;
  removePosition: (id: string) => void;

  // Markets
  markets: PerpMarket[];
  setMarkets: (markets: PerpMarket[]) => void;
  selectedMarket: string;
  setSelectedMarket: (market: string) => void;

  // Funding rates
  fundingRates: Map<string, FundingRateInfo>;
  setFundingRate: (market: string, info: FundingRateInfo) => void;

  // Loading states
  isOpeningPosition: boolean;
  isClosingPosition: string | null;
  isAddingMargin: string | null;
  isRemovingMargin: string | null;
  isSettlingFunding: string | null;
  setIsOpeningPosition: (value: boolean) => void;
  setIsClosingPosition: (id: string | null) => void;
  setIsAddingMargin: (id: string | null) => void;
  setIsRemovingMargin: (id: string | null) => void;
  setIsSettlingFunding: (id: string | null) => void;

  // Position history
  positionHistory: PerpPosition[];

  // Estimated liquidation price calculation
  estimateLiquidationPrice: (
    side: PositionSide,
    entryPrice: number,
    leverage: number,
    maintenanceMarginBps: number
  ) => number;
}

const defaultInput: OpenPositionInput = {
  market: 'SOL-PERP',
  side: 'long',
  leverage: 1,
  size: '',
  collateral: '',
};

export const usePerpetualStore = create<PerpetualState>()(
  persist(
    (set, get) => ({
      // Current position form
      currentInput: defaultInput,
      setCurrentInput: (input) =>
        set((state) => ({
          currentInput: { ...state.currentInput, ...input },
        })),
      resetCurrentInput: () =>
        set((state) => ({
          currentInput: { ...defaultInput, leverage: state.defaultLeverage },
        })),

      // Settings
      defaultLeverage: 1,
      maxLeverage: 20,
      marginMode: 'isolated',
      setDefaultLeverage: (defaultLeverage) => set({ defaultLeverage }),
      setMaxLeverage: (maxLeverage) => set({ maxLeverage }),
      setMarginMode: (marginMode) => set({ marginMode }),

      // Open positions
      positions: [],
      setPositions: (positions) => set({ positions }),
      addPosition: (position) =>
        set((state) => ({
          positions: [position, ...state.positions],
        })),
      updatePosition: (id, updates) =>
        set((state) => ({
          positions: state.positions.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),
      removePosition: (id) =>
        set((state) => {
          const position = state.positions.find((p) => p.id === id);
          return {
            positions: state.positions.filter((p) => p.id !== id),
            positionHistory: position
              ? [{ ...position, status: 'closed' as PositionStatus }, ...state.positionHistory]
              : state.positionHistory,
          };
        }),

      // Markets
      markets: [],
      setMarkets: (markets) => set({ markets }),
      selectedMarket: 'SOL-PERP',
      setSelectedMarket: (selectedMarket) => set({ selectedMarket }),

      // Funding rates
      fundingRates: new Map(),
      setFundingRate: (market, info) =>
        set((state) => {
          const newRates = new Map(state.fundingRates);
          newRates.set(market, info);
          return { fundingRates: newRates };
        }),

      // Loading states
      isOpeningPosition: false,
      isClosingPosition: null,
      isAddingMargin: null,
      isRemovingMargin: null,
      isSettlingFunding: null,
      setIsOpeningPosition: (isOpeningPosition) => set({ isOpeningPosition }),
      setIsClosingPosition: (isClosingPosition) => set({ isClosingPosition }),
      setIsAddingMargin: (isAddingMargin) => set({ isAddingMargin }),
      setIsRemovingMargin: (isRemovingMargin) => set({ isRemovingMargin }),
      setIsSettlingFunding: (isSettlingFunding) => set({ isSettlingFunding }),

      // Position history
      positionHistory: [],

      // Estimated liquidation price calculation
      // For longs: liq_price = entry_price * (1 - 1/leverage + maintenance_margin)
      // For shorts: liq_price = entry_price * (1 + 1/leverage - maintenance_margin)
      estimateLiquidationPrice: (side, entryPrice, leverage, maintenanceMarginBps) => {
        const maintenanceMargin = maintenanceMarginBps / 10000;
        if (side === 'long') {
          return entryPrice * (1 - 1 / leverage + maintenanceMargin);
        } else {
          return entryPrice * (1 + 1 / leverage - maintenanceMargin);
        }
      },
    }),
    {
      name: 'confidex-perpetuals',
      partialize: (state) => ({
        defaultLeverage: state.defaultLeverage,
        maxLeverage: state.maxLeverage,
        marginMode: state.marginMode,
        selectedMarket: state.selectedMarket,
      }),
    }
  )
);
