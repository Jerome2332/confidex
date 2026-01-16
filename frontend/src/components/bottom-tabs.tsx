'use client';

import { FC, useState } from 'react';
import { OpenOrders } from './open-orders';
import { TradeHistory } from './trade-history';
import { ChevronUp, ChevronDown, ChevronDownIcon, Wallet, BarChart3, Clock, History, Filter } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';

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

          {/* Hide Small Balances Checkbox */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={hideSmallBalances}
              onChange={(e) => setHideSmallBalances(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border bg-background accent-primary cursor-pointer"
            />
            <span className="hidden sm:inline">Hide Small</span>
          </label>

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
  // Mock balance data
  const balances = [
    { coin: 'SOL', total: 0, available: 0, usdcValue: 0, pnl: 0, pnlPercent: 0 },
    { coin: 'USDC', total: 0, available: 0, usdcValue: 0, pnl: 0, pnlPercent: 0 },
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
      <div className="grid grid-cols-6 gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/30 bg-secondary/20">
        <span>Coin</span>
        <span className="text-right">Total Balance</span>
        <span className="text-right">Available</span>
        <span className="text-right">USDC Value</span>
        <span className="text-right">PNL (ROE %)</span>
        <span className="text-right">Contract</span>
      </div>

      {/* Table Body */}
      {filteredBalances.length > 0 ? (
        filteredBalances.map(balance => (
          <div
            key={balance.coin}
            className="grid grid-cols-6 gap-4 px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors"
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
            <span
              className={`text-right font-mono ${
                balance.pnl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {balance.pnl >= 0 ? '+' : ''}${balance.pnl.toFixed(2)} ({balance.pnlPercent.toFixed(2)}%)
            </span>
            <span className="text-right text-muted-foreground">—</span>
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
  if (!connected) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Connect wallet to view positions
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Table Header */}
      <div className="grid grid-cols-7 gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/30 bg-secondary/20">
        <span>Market</span>
        <span className="text-right">Side</span>
        <span className="text-right">Size</span>
        <span className="text-right">Entry Price</span>
        <span className="text-right">Mark Price</span>
        <span className="text-right">PNL</span>
        <span className="text-right">Actions</span>
      </div>

      {/* Empty State */}
      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
        No open positions
      </div>
    </div>
  );
};
