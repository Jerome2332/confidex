'use client';

import { FC, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { OpenOrders } from './open-orders';
import { TradeHistory } from './trade-history';
import { PositionRow, NoPositions } from './position-row';
import { Funnel, ArrowsClockwise, Lock, X, CaretUp, CaretDown, TrendUp, TrendDown, SpinnerGap, Eye, EyeSlash } from '@phosphor-icons/react';
import { TokenIcon } from './token-selector';
import { ToggleSwitch } from './ui/toggle-switch';
import { useTokenBalance } from '@/hooks/use-token-balance';
import { useSolPrice } from '@/hooks/use-pyth-price';
import { usePositions } from '@/hooks/use-positions';
import { usePerpetualStore, PerpPosition } from '@/stores/perpetuals-store';
import {
  buildClosePositionTransaction,
  createHybridEncryptedValue,
  derivePerpMarketPda,
  fetchPerpMarketData,
} from '@/lib/confidex-client';
import { PYTH_SOL_USD_FEED, ARCIUM_PROGRAM_ID } from '@/lib/constants';
import { toast } from 'sonner';

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
  // Sync with global store for auto-switching after position open
  const { bottomTab, setBottomTab } = usePerpetualStore();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hideSmallBalances, setHideSmallBalances] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const { connected } = useWallet();

  // Use store tab as the active tab
  const activeTab = bottomTab;
  const setActiveTab = setBottomTab;

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
              <Funnel size={12} />
              <span>{filterOptions.find(f => f.value === filter)?.label}</span>
              <CaretDown size={12} />
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
              <CaretUp size={16} />
            ) : (
              <CaretDown size={16} />
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
            <ArrowsClockwise size={12} />
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
              <TokenIcon symbol={balance.coin} size={20} />
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

/**
 * Check if an encrypted field contains plaintext in the first 8 bytes.
 * V2 encryption uses pure ciphertext format: [nonce(16) | ciphertext(32) | ephemeral_pubkey(16)]
 * Some fields (like collateral) may still use hybrid format with plaintext prefix.
 *
 * Heuristic: If last 4 bytes of first 8 are all zeros, likely has plaintext (small number).
 * True encrypted data would have random-looking bytes throughout.
 */
function hasPlaintextPrefix(encrypted: Uint8Array): boolean {
  if (encrypted.length < 8) return false;
  // Check if bytes 4-7 are all zeros (typical for small numbers in little-endian)
  // A small value like 64316342 (0x03d563b6) in LE: b6 63 d5 03 00 00 00 00
  const bytes = encrypted.slice(0, 8);
  const highBytes = bytes.slice(4, 8);
  const allZeros = highBytes.every(b => b === 0);
  // Also check that not ALL bytes are zero (empty value)
  const lowBytes = bytes.slice(0, 4);
  const hasValue = lowBytes.some(b => b !== 0);
  return allZeros && hasValue;
}

/**
 * Extract plaintext value from encrypted field (only works for hybrid format)
 * Format: [plaintext(8) | nonce(8) | ciphertext(32) | ephemeral_pubkey(16)]
 */
function getPlaintextFromEncrypted(encrypted: Uint8Array): bigint | null {
  if (!hasPlaintextPrefix(encrypted)) return null;
  const bytes = encrypted.slice(0, 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return view.getBigUint64(0, true); // little-endian
}

/**
 * Format collateral (in USDC with 6 decimals) to USD
 * This is the only field that reliably has plaintext in current V2 format
 */
function formatCollateral(encrypted: Uint8Array): string | null {
  const microUsdc = getPlaintextFromEncrypted(encrypted);
  if (microUsdc === null) return null;
  const usdc = Number(microUsdc) / 1e6;
  return `$${usdc.toFixed(2)}`;
}

// Positions Tab Component
const PositionsTab: FC<{ connected: boolean }> = ({ connected }) => {
  const { positions, isClosingPosition, setIsClosingPosition, removePosition } = usePerpetualStore();
  const { isLoading: isLoadingPositions, refresh: refreshPositions } = usePositions();
  const { price: solPrice } = useSolPrice();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  // Track which positions have decrypted values visible
  const [decryptedPositions, setDecryptedPositions] = useState<Set<string>>(new Set());

  const toggleDecryption = (positionId: string) => {
    setDecryptedPositions(prev => {
      const next = new Set(prev);
      if (next.has(positionId)) {
        next.delete(positionId);
      } else {
        next.add(positionId);
      }
      return next;
    });
  };

  // Debug logging for position updates
  log.debug('PositionsTab render', {
    positionCount: positions.length,
    positionIds: positions.map(p => p.id),
    connected,
    isLoadingPositions,
  });

  const handleClosePosition = async (positionId: string) => {
    if (!publicKey) {
      toast.error('Please connect your wallet');
      return;
    }

    setIsClosingPosition(positionId);
    try {
      const position = positions.find(p => p.id === positionId);
      if (!position) {
        throw new Error('Position not found');
      }

      // Derive perp market PDA from underlying mint (SOL)
      const underlyingMint = new PublicKey('So11111111111111111111111111111111111111112');
      const [perpMarketPda] = derivePerpMarketPda(underlyingMint);

      // Fetch market data to get correct collateralVault and feeRecipient
      const marketData = await fetchPerpMarketData(connection, underlyingMint);
      if (!marketData) {
        throw new Error('Failed to fetch perpetual market data');
      }

      // Get current oracle price for exit (convert to micro-dollars: 6 decimals)
      const exitPrice = solPrice ? BigInt(Math.floor(solPrice * 1_000_000)) : BigInt(0);

      // Use position's encrypted size directly, create encrypted exit price
      const encryptedCloseSize = position.encryptedSize;
      const encryptedExitPrice = createHybridEncryptedValue(exitPrice);

      // Extract collateral amount from encrypted_collateral (plaintext in first 8 bytes - fallback mode)
      // In production with MPC, this would be computed from encrypted payout
      const collateralBuffer = Buffer.from(position.encryptedCollateral.slice(0, 8));
      const payoutAmount = collateralBuffer.readBigUInt64LE(0);
      log.debug('Extracted payout amount from encrypted collateral', {
        payoutAmount: payoutAmount.toString(),
        rawBytes: Array.from(position.encryptedCollateral.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '),
      });

      // Validate position.id is a valid base58 string before creating PublicKey
      log.debug('Creating PublicKey from position.id', {
        positionId: position.id,
        positionIdLength: position.id.length,
        positionIdType: typeof position.id,
      });

      let positionPda: PublicKey;
      try {
        positionPda = new PublicKey(position.id);
      } catch (pubkeyError) {
        log.error('Invalid position.id - not a valid base58 string', {
          positionId: position.id,
          error: pubkeyError instanceof Error ? pubkeyError.message : String(pubkeyError),
        });
        throw new Error(`Invalid position ID format: ${position.id}`);
      }

      // Build close position transaction with actual market data
      const transaction = await buildClosePositionTransaction({
        connection,
        trader: publicKey,
        perpMarketPda,
        positionPda, // Position PDA validated above
        encryptedCloseSize,
        encryptedExitPrice,
        fullClose: true,
        payoutAmount,
        oraclePriceFeed: marketData.oraclePriceFeed,
        collateralVault: marketData.collateralVault,
        feeRecipient: marketData.feeRecipient,
        arciumProgram: ARCIUM_PROGRAM_ID,
      });

      // Log transaction details for debugging
      log.debug('Close position transaction details', {
        positionPda: position.id,
        perpMarket: perpMarketPda.toBase58(),
        oracle: marketData.oraclePriceFeed.toBase58(),
        collateralVault: marketData.collateralVault.toBase58(),
        feeRecipient: marketData.feeRecipient.toBase58(),
      });

      // Simulate first to get better error messages
      try {
        const simulation = await connection.simulateTransaction(transaction);
        if (simulation.value.err) {
          log.error('Transaction simulation failed:', {
            err: simulation.value.err,
            logs: simulation.value.logs,
          });
          throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${simulation.value.logs?.join('\n')}`);
        }
        log.debug('Simulation succeeded', { logs: simulation.value.logs });
      } catch (simError) {
        log.error('Simulation error:', { error: simError instanceof Error ? simError.message : String(simError) });
        throw simError;
      }

      // Send transaction
      const signature = await sendTransaction(transaction, connection);
      log.info('Close position transaction sent', { signature });

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      // Remove from local state
      removePosition(positionId);
      toast.success('Position closed successfully');

      log.info('Position closed', { positionId, signature });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to close position:', { error: errorMessage });
      // Show more detailed error to user
      if (errorMessage.includes('Simulation failed')) {
        toast.error('Transaction simulation failed - check console for details');
      } else {
        toast.error(`Failed to close position: ${errorMessage.slice(0, 100)}`);
      }
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
          <span className="flex items-center gap-2">
            Market
            <button
              onClick={() => refreshPositions()}
              className={`p-0.5 hover:text-foreground transition-colors ${isLoadingPositions ? 'animate-spin' : ''}`}
              title="Refresh positions"
            >
              <ArrowsClockwise size={12} />
            </button>
          </span>
          <span className="text-right">Side / Leverage</span>
          <span className="text-right">Size</span>
          <span className="text-right">Entry Price</span>
          <span className="text-right">Liq. Price</span>
          <span className="text-right">Collateral</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          {isLoadingPositions ? 'Loading positions...' : 'No open positions'}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Table Header */}
      <div className="grid grid-cols-7 gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/30 bg-secondary/20">
        <span className="flex items-center gap-2">
          Market
          <button
            onClick={() => refreshPositions()}
            className={`p-0.5 hover:text-foreground transition-colors ${isLoadingPositions ? 'animate-spin' : ''}`}
            title="Refresh positions"
          >
            <ArrowsClockwise size={12} />
          </button>
        </span>
        <span className="text-right">Side / Leverage</span>
        <span className="text-right">Size</span>
        <span className="text-right">Entry Price</span>
        <span className="text-right">Liq. Price</span>
        <span className="text-right">Collateral</span>
        <span className="text-right">Actions</span>
      </div>

      {/* Position Rows */}
      {positions.map(position => {
        const isLong = position.side === 'long';
        const isClosing = isClosingPosition === position.id;
        const showDetails = decryptedPositions.has(position.id);

        // V2: Risk level is determined by MPC batch liquidation checks
        // We no longer calculate from public thresholds
        const riskLevel = position.riskLevel || 'unknown';
        const isAtRisk = riskLevel === 'warning' || riskLevel === 'critical';

        // V2 encryption: Only collateral has plaintext prefix, other fields are truly encrypted
        // Size, entry price, and liquidation thresholds require MPC decryption
        const collateralValue = formatCollateral(position.encryptedCollateral);

        return (
          <div
            key={position.id}
            className={`grid grid-cols-7 gap-4 px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors ${
              isAtRisk ? 'bg-rose-500/10' : ''
            }`}
          >
            {/* Market */}
            <span className="font-medium flex items-center gap-2">
              <TokenIcon symbol="SOL" size={20} />
              {position.marketSymbol}
            </span>

            {/* Side / Leverage */}
            <span className="text-right flex items-center justify-end gap-1.5">
              {isLong ? (
                <TrendUp size={12} className="text-emerald-400/80" />
              ) : (
                <TrendDown size={12} className="text-rose-400/80" />
              )}
              <span className={isLong ? 'text-emerald-400/80' : 'text-rose-400/80'}>
                {position.leverage}x {isLong ? 'Long' : 'Short'}
              </span>
            </span>

            {/* Size - V2 encrypted, requires MPC */}
            <span className="text-right font-mono flex items-center justify-end gap-1">
              {showDetails ? (
                <span className="text-muted-foreground italic text-[10px]">MPC encrypted</span>
              ) : (
                <>
                  <Lock size={12} className="text-primary" />
                  <span className="text-muted-foreground">••••••</span>
                </>
              )}
            </span>

            {/* Entry Price - V2 encrypted, requires MPC */}
            <span className="text-right font-mono flex items-center justify-end gap-1">
              {showDetails ? (
                <span className="text-muted-foreground italic text-[10px]">MPC encrypted</span>
              ) : (
                <>
                  <Lock size={12} className="text-primary" />
                  <span className="text-muted-foreground">••••••</span>
                </>
              )}
            </span>

            {/* Liquidation Price - V2 encrypted, requires MPC */}
            <span className={`text-right font-mono flex items-center justify-end gap-1 ${isAtRisk ? 'text-rose-400/80' : ''}`}>
              {showDetails ? (
                <span className="text-muted-foreground italic text-[10px]">MPC encrypted</span>
              ) : (
                <>
                  <Lock size={12} className="text-primary" />
                  <span className="text-muted-foreground">••••••</span>
                </>
              )}
            </span>

            {/* Collateral (readable) / Unrealized PnL (requires MPC) */}
            <span className="text-right font-mono flex items-center justify-end gap-1">
              {showDetails ? (
                collateralValue ? (
                  <span className="text-white/80" title="Collateral (margin)">
                    {collateralValue}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic text-[10px]">MPC encrypted</span>
                )
              ) : (
                <>
                  <Lock size={12} className="text-primary" />
                  <span className="text-muted-foreground">••••••</span>
                </>
              )}
            </span>

            {/* Actions */}
            <span className="text-right flex items-center justify-end gap-1">
              <button
                onClick={() => toggleDecryption(position.id)}
                className="p-1 text-muted-foreground hover:text-primary transition-colors"
                title={showDetails ? 'Hide details' : 'Show details'}
              >
                {showDetails ? (
                  <EyeSlash size={16} />
                ) : (
                  <Eye size={16} />
                )}
              </button>
              <button
                onClick={() => handleClosePosition(position.id)}
                disabled={isClosing}
                className="p-1 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                title="Close Position"
              >
                {isClosing ? (
                  <SpinnerGap size={16} className="animate-spin" />
                ) : (
                  <X size={16} />
                )}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
};
