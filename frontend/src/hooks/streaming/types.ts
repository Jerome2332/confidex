/**
 * Frontend streaming types
 *
 * Mirror of backend streaming types for type-safe WebSocket communication.
 * PRIVACY: All types here represent PUBLIC data only - no encrypted fields.
 */

// =============================================================================
// Connection State
// =============================================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ConnectionState {
  readonly status: ConnectionStatus;
  readonly error?: string;
  readonly lastConnected?: Date;
  readonly reconnectAttempts: number;
}

// =============================================================================
// Channel Types
// =============================================================================

export type ChannelType =
  | 'orders'
  | 'trades'
  | 'liquidations'
  | 'positions'
  | 'markets'
  | 'prices'
  | 'global';

export interface ChannelSubscription {
  readonly channel: ChannelType;
  readonly filter?: string; // e.g., pairPda for orders channel
}

// =============================================================================
// Event Types (PUBLIC data only)
// =============================================================================

/**
 * Order event - NO encrypted fields
 */
export interface OrderEvent {
  readonly type: 'order_placed' | 'order_cancelled' | 'order_matched' | 'order_filled';
  readonly orderId: string;
  readonly pairPda: string;
  readonly side: 'buy' | 'sell';
  readonly maker: string;
  readonly timestamp: number;
  readonly signature?: string;
}

/**
 * Trade event - NO encrypted fields
 */
export interface TradeEvent {
  readonly type: 'trade_executed';
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly pairPda: string;
  readonly buyer: string;
  readonly seller: string;
  readonly timestamp: number;
  readonly signature?: string;
}

/**
 * Liquidation event - NO position size or price
 */
export interface LiquidationEvent {
  readonly type: 'liquidation_detected' | 'liquidation_executed' | 'liquidation_failed';
  readonly positionId: string;
  readonly marketPda: string;
  readonly side: 'long' | 'short';
  readonly owner: string;
  readonly liquidator?: string;
  readonly timestamp: number;
  readonly signature?: string;
}

/**
 * Position event - NO size or entry price
 */
export interface PositionEvent {
  readonly type: 'position_opened' | 'position_closed' | 'position_updated';
  readonly positionId: string;
  readonly marketPda: string;
  readonly side: 'long' | 'short';
  readonly owner: string;
  readonly timestamp: number;
}

/**
 * Market stats update - PUBLIC aggregates only
 */
export interface MarketStatsEvent {
  readonly type: 'market_stats_updated';
  readonly marketPda: string;
  readonly openInterestLong: string; // BigInt as string
  readonly openInterestShort: string;
  readonly positionCount: number;
  readonly fundingRateBps?: number;
  readonly timestamp: number;
}

/**
 * Price update from Pyth
 */
export interface PriceEvent {
  readonly type: 'price_updated';
  readonly feedId: string;
  readonly symbol: string;
  readonly price: string; // BigInt as string (scaled by expo)
  readonly confidence: string;
  readonly expo: number;
  readonly publishTime: number;
}

/**
 * Global exchange stats
 */
export interface GlobalStatsEvent {
  readonly type: 'global_stats_updated';
  readonly pairCount: number;
  readonly orderCount: number;
  readonly positionCount: number;
  readonly marketCount: number;
  readonly timestamp: number;
}

// =============================================================================
// Union Types
// =============================================================================

export type StreamEvent =
  | OrderEvent
  | TradeEvent
  | LiquidationEvent
  | PositionEvent
  | MarketStatsEvent
  | PriceEvent
  | GlobalStatsEvent;

// =============================================================================
// Hook Options
// =============================================================================

export interface UseWebSocketOptions {
  /** Auto-connect on mount (default: true) */
  readonly autoConnect?: boolean;
  /** Reconnection attempts before giving up (default: 5) */
  readonly maxReconnectAttempts?: number;
  /** Base delay between reconnection attempts in ms (default: 1000) */
  readonly reconnectDelayMs?: number;
  /** Callback for connection status changes */
  readonly onStatusChange?: (status: ConnectionStatus) => void;
}

export interface UseStreamOptions<T extends StreamEvent> {
  /** Maximum events to keep in buffer (default: 100) */
  readonly maxEvents?: number;
  /** Filter function for events */
  readonly filter?: (event: T) => boolean;
  /** Callback for each new event */
  readonly onEvent?: (event: T) => void;
}
