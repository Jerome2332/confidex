'use client';

import { FC, useState } from 'react';
import { OpenOrders } from './open-orders';
import { TradeHistory } from './trade-history';
import { PositionRow, NoPositions } from './position-row';
import { ChevronUp, ChevronDown, ChevronDownIcon, Filter, RefreshCw, Lock, TrendingUp, TrendingDown, X, Loader2 } from 'lucide-react';
import { ToggleSwitch } from './ui/toggle-switch';
import { useWallet } from '@solana/wallet-adapter-react';
import { useTokenBalance } from '@/hooks/use-token-balance';
import { useSolPrice } from '@/hooks/use-pyth-price';
import { usePerpetualStore, PerpPosition } from '@/stores/perpetuals-store';

import { createLogger } from '@/lib/logger';

const log = createLogger('api');

type TabId = 'balances' | 'positions' | 'open-orders' | 'trade-history' | 'order-history';

interface Tab {
  id: TabId;
  label: string;
  icon?: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'balances', label: 'Balances' },
  { id: 'positions', label: 'Positions' },
  { id: 'open-orders', label: 'Open Orders' },
  { id: 'trade-history', label: 'Trade History' },
  { id: 'order-history', label: 'Order History' },
];

type FilterOption = 'all' | 'sol' | 'usdc';

interface BottomTabsProps {
  defaultHeight?: number;
}

export const BottomTabs: FC<BottomTabsProps> = ({ defaultHeight = 224 }) => {
  const [activeTab, setActiveTab] = useState<TabId>('open-orders');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hideSmallBalances, setHideSmallBalances] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const { connected } = useWallet();

  const filterOptions: { value: FilterOption; label: string }[] = [
    { value: 'all', label: 'All Assets' },
    { value: 'sol', label: 'SOL Only' },
    { value: 'usdc', label: 'USDC Only' },
  ];

  return (
    <div
      className="border-t border-border flex flex-col bg-card transition-all duration-200"
      style={{ height: isCollapsed ? 40 : defaultHeight }}
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 shrink-0">
        {/* Left: Tabs */}
        <div className="flex items-center gap-4 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (isCollapsed) setIsCollapsed(false);
              }}
              className={`text-sm whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right: Filter, Checkbox, Collapse */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50 transition-colors"
            >
              <Filter className="h-3 w-3" />
              <span>{filterOptions.find(f => f.value === filter)?.label}</span>
              <ChevronDownIcon className="h-3 w-3" />
            </button>
            {showFilterDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowFilterDropdown(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[120px]">
                  {filterOptions.map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setFilter(option.value);
                        setShowFilterDropdown(false);
                      }}
                      className={`w-full px-3 py-1.5 text-xs text-left hover:bg-secondary/50 transition-colors ${
                        filter === option.value ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Hide Small Balances Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground hidden sm:inline">Hide Small</span>
            <ToggleSwitch
              checked={hideSmallBalances}
              onChange={setHideSmallBalances}
              size="sm"
            />
          </div>

          {/* Collapse Button */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50 transition-colors"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto">
          {activeTab === 'balances' && (
            <BalancesTab hideSmall={hideSmallBalances} filter={filter} connected={connected} />
          )}
          {activeTab === 'positions' && (
            <PositionsTab connected={connected} />
          )}
          {activeTab === 'open-orders' && <OpenOrders variant="table" />}
          {activeTab === 'trade-history' && <TradeHistory variant="table" />}
          {activeTab === 'order-history' && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No order history
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Balances Tab Component
const BalancesTab: FC<{ hideSmall: boolean; filter: FilterOption; connected: boolean }> = ({
  hideSmall,
  filter,
  connected,
}) => {
  const { balances: tokenBalances, isLoading, refresh } = useTokenBalance();
  const { price: solPrice } = useSolPrice();

  // Calculate real balances from wallet
  const solAmount = parseFloat(tokenBalances.solUiAmount) || 0;
  const usdcAmount = parseFloat(tokenBalances.usdcUiAmount) || 0;
  const solUsdcValue = solAmount * (solPrice || 0);

  const balances = [
    {
      coin: 'SOL',
      total: solAmount,
      available: solAmount,
      usdcValue: solUsdcValue,
    },
    {
      coin: 'USDC',
      total: usdcAmount,
      available: usdcAmount,
      usdcValue: usdcAmount,
    },
  ];

  const filteredBalances = balances
    .filter(b => {
      if (filter === 'sol') return b.coin === 'SOL';
      if (filter === 'usdc') return b.coin === 'USDC';
      return true;
    })
    .filter(b => {
      if (hideSmall) return b.usdcValue >= 1;
      return true;
    });

  if (!connected) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Connect wallet to view balances
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Table Header */}
      <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/30 bg-secondary/20">
        <span className="flex items-center gap-2">
          Coin
          <button
            onClick={() => refresh()}
            className={`p-0.5 hover:text-foreground transition-colors ${isLoading ? 'animate-spin' : ''}`}
            title="Refresh balances"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </span>
        <span className="text-right">Total Balance</span>
        <span className="text-right">Available</span>
        <span className="text-right">USDC Value</span>
        <span className="text-right">Price</span>
      </div>

      {/* Table Body */}
      {isLoading && filteredBalances.every(b => b.total === 0) ? (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          Loading balances...
        </div>
      ) : filteredBalances.length > 0 ? (
        filteredBalances.map(balance => (
          <div
            key={balance.coin}
            className="grid grid-cols-5 gap-4 px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors"
          >
            <span className="font-medium flex items-center gap-2">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${
                  balance.coin === 'SOL'
                    ? 'bg-gradient-to-br from-purple-500 to-blue-500'
                    : 'bg-gradient-to-br from-green-500 to-teal-500'
                }`}
              >
                {balance.coin.charAt(0)}
              </div>
              {balance.coin}
            </span>
            <span className="text-right font-mono">{balance.total.toFixed(4)}</span>
            <span className="text-right font-mono">{balance.available.toFixed(4)}</span>
            <span className="text-right font-mono">${balance.usdcValue.toFixed(2)}</span>
            <span className="text-right font-mono text-muted-foreground">
              {balance.coin === 'SOL' ? `$${(solPrice || 0).toFixed(2)}` : '$1.00'}
            </span>
          </div>
        ))
      ) : (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          {hideSmall ? 'No balances above $1' : 'No balances'}
        </div>
      )}
    </div>
  );
};

// Positions Tab Component
const PositionsTab: FC<{ connected: boolean }> = ({ connected }) => {
  const { positions, isClosingPosition, setIsClosingPosition, removePosition } = usePerpetualStore();
  const { price: solPrice } = useSolPrice();

  const handleClosePosition = async (positionId: string) => {
    setIsClosingPosition(positionId);
    try {
      // TODO: Implement actual position close via program
      // For now, simulate closing
      await new Promise(resolve => setTimeout(resolve, 1500));
      removePosition(positionId);
    } catch (error) {
      log.error('Failed to close position:', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsClosingPosition(null);
    }
  };

  if (!connected) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Connect wallet to view positions
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="h-full">
        {/* Table Header */}
        <div className="grid grid-cols-7 gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/30 bg-secondary/20">
          <span>Market</span>
          <span className="text-right">Side / Leverage</span>
          <span className="text-right">Size</span>
          <span className="text-right">Entry Price</span>
          <span className="text-right">Liq. Price</span>
          <span className="text-right">Unrealized PnL</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          No open positions
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Table Header */}
      <div className="grid grid-cols-7 gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/30 bg-secondary/20">
        <span>Market</span>
        <span className="text-right">Side / Leverage</span>
        <span className="text-right">Size</span>
        <span className="text-right">Entry Price</span>
        <span className="text-right">Liq. Price</span>
        <span className="text-right">Unrealized PnL</span>
        <span className="text-right">Actions</span>
      </div>

      {/* Position Rows */}
      {positions.map(position => {
        const isLong = position.side === 'long';
        const liquidationPrice = isLong
          ? position.liquidatableBelowPrice
          : position.liquidatableAbovePrice;
        const isClosing = isClosingPosition === position.id;

        // Calculate distance to liquidation for warning
        const distanceToLiq = solPrice && liquidationPrice
          ? isLong
            ? ((solPrice - liquidationPrice) / solPrice) * 100
            : ((liquidationPrice - solPrice) / solPrice) * 100
          : null;
        const isAtRisk = distanceToLiq !== null && distanceToLiq < 10;

        return (
          <div
            key={position.id}
            className={`grid grid-cols-7 gap-4 px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors ${
              isAtRisk ? 'bg-rose-500/10' : ''
            }`}
          >
            {/* Market */}
            <span className="font-medium flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-[8px] font-bold text-white">
                S
              </div>
              {position.marketSymbol}
            </span>

            {/* Side / Leverage */}
            <span className="text-right flex items-center justify-end gap-1.5">
              {isLong ? (
                <TrendingUp className="h-3 w-3 text-emerald-400/80" />
              ) : (
                <TrendingDown className="h-3 w-3 text-rose-400/80" />
              )}
              <span className={isLong ? 'text-emerald-400/80' : 'text-rose-400/80'}>
                {position.leverage}x {isLong ? 'Long' : 'Short'}
              </span>
            </span>

            {/* Size (Encrypted) */}
            <span className="text-right font-mono flex items-center justify-end gap-1">
              <Lock className="h-3 w-3 text-primary" />
              <span className="text-muted-foreground">••••••</span>
            </span>

            {/* Entry Price (Encrypted) */}
            <span className="text-right font-mono flex items-center justify-end gap-1">
              <Lock className="h-3 w-3 text-primary" />
              <span className="text-muted-foreground">••••••</span>
            </span>

            {/* Liquidation Price (Public) */}
            <span className={`text-right font-mono ${isAtRisk ? 'text-rose-400/80' : ''}`}>
              ${liquidationPrice.toFixed(2)}
            </span>

            {/* Unrealized PnL (Encrypted) */}
            <span className="text-right font-mono flex items-center justify-end gap-1">
              <Lock className="h-3 w-3 text-primary" />
              <span className="text-muted-foreground">••••••</span>
            </span>

            {/* Actions */}
            <span className="text-right">
              <button
                onClick={() => handleClosePosition(position.id)}
                disabled={isClosing}
                className="p-1 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                title="Close Position"
              >
                {isClosing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
};
