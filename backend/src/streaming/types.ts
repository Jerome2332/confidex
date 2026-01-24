/**
 * Streaming module types
 *
 * PRIVACY RULE: All event types MUST only contain publicly visible on-chain data.
 * NEVER include encrypted fields (encrypted_amount, encrypted_price, etc.)
 */

// =============================================================================
// WebSocket Event Types
// =============================================================================

/**
 * Order event - broadcast when orders are placed, cancelled, or matched
 * Contains ONLY public data visible on-chain
 */
export interface OrderEvent {
  readonly type: 'order_placed' | 'order_cancelled' | 'order_matched';
  readonly orderId: string;
  readonly pairPda: string;
  readonly side: 'buy' | 'sell';
  readonly maker: string;
  readonly timestamp: number;
  readonly slot?: number;
  // NEVER include: encrypted_amount, encrypted_price
}

/**
 * Trade event - broadcast when a trade is executed
 * Contains ONLY public data visible on-chain
 */
export interface TradeEvent {
  readonly type: 'trade_executed';
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly pairPda: string;
  readonly buyer: string;
  readonly seller: string;
  readonly timestamp: number;
  readonly slot?: number;
  readonly signature?: string;
  // NEVER include: fill_amount, price, encrypted fields
}

/**
 * Liquidation event - broadcast when liquidations are detected or executed
 * Contains ONLY public data visible on-chain
 */
export interface LiquidationEvent {
  readonly type: 'liquidation_detected' | 'liquidation_executed' | 'liquidation_failed';
  readonly positionPda: string;
  readonly marketPda: string;
  readonly side: 'long' | 'short';
  readonly owner: string;
  readonly timestamp: number;
  readonly slot?: number;
  readonly liquidator?: string;
  readonly signature?: string;
  // NEVER include: encrypted_size, encrypted_collateral, encrypted_pnl
}

/**
 * Position event - broadcast when positions are opened/closed
 * Contains ONLY public data visible on-chain
 */
export interface PositionEvent {
  readonly type: 'position_opened' | 'position_closed' | 'position_updated';
  readonly positionPda: string;
  readonly marketPda: string;
  readonly side: 'long' | 'short';
  readonly owner: string;
  readonly timestamp: number;
  readonly slot?: number;
  // NEVER include: encrypted_size, encrypted_entry_price, encrypted_collateral
}

/**
 * Global stats update - periodic broadcast of exchange-wide metrics
 * Contains aggregated public counts only
 */
export interface GlobalStatsUpdate {
  readonly type: 'global_stats';
  readonly orderCount: number;
  readonly pairCount: number;
  readonly positionCount: number;
  readonly liquidationCount24h: number;
  readonly timestamp: number;
}

/**
 * Market stats update - per-market metrics
 */
export interface MarketStatsUpdate {
  readonly type: 'market_stats';
  readonly marketPda: string;
  readonly longPositionCount: number;
  readonly shortPositionCount: number;
  readonly totalLongOi: number; // Public aggregate OI
  readonly totalShortOi: number; // Public aggregate OI
  readonly fundingRateBps: number;
  readonly timestamp: number;
}

/**
 * Price update event - from Pyth oracle
 * This is public oracle data, safe to broadcast
 */
export interface PriceUpdateEvent {
  readonly type: 'price_update';
  readonly feedId: string;
  readonly symbol: string;
  readonly price: string; // Decimal string for precision
  readonly confidence: string;
  readonly publishTime: number;
  readonly timestamp: number;
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Channels that clients can subscribe to
 */
export type SubscriptionChannel =
  | 'orders' // All order events
  | `orders:${string}` // Order events for specific pair
  | 'trades' // All trade events
  | `trades:${string}` // Trade events for specific pair
  | 'liquidations' // All liquidation events
  | `liquidations:${string}` // Liquidations for specific market
  | 'positions' // All position events
  | `positions:${string}` // Positions for specific market
  | 'global' // Global stats updates
  | `market:${string}` // Market-specific stats
  | 'prices'; // Price updates from Pyth

/**
 * Client subscription request
 */
export interface SubscribeRequest {
  readonly channels: SubscriptionChannel[];
}

/**
 * Client unsubscribe request
 */
export interface UnsubscribeRequest {
  readonly channels: SubscriptionChannel[];
}

// =============================================================================
// WebSocket Connection Types
// =============================================================================

/**
 * Client connection metadata
 */
export interface ClientMetadata {
  readonly clientId: string;
  readonly connectedAt: number;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly subscriptions: Set<SubscriptionChannel>;
  // Message rate limiting fields
  messageCount: number;
  messageWindowStart: number;
  rateLimitWarnings: number;
}

/**
 * Connection stats for monitoring
 */
export interface ConnectionStats {
  readonly totalConnections: number;
  readonly activeConnections: number;
  readonly totalSubscriptions: number;
  readonly connectionsByChannel: Record<string, number>;
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * All possible streaming events
 */
export type StreamingEvent =
  | OrderEvent
  | TradeEvent
  | LiquidationEvent
  | PositionEvent
  | GlobalStatsUpdate
  | MarketStatsUpdate
  | PriceUpdateEvent;

/**
 * Event type discriminator
 */
export type StreamingEventType = StreamingEvent['type'];

// =============================================================================
// Type Guards
// =============================================================================

export function isOrderEvent(event: StreamingEvent): event is OrderEvent {
  return ['order_placed', 'order_cancelled', 'order_matched'].includes(event.type);
}

export function isTradeEvent(event: StreamingEvent): event is TradeEvent {
  return event.type === 'trade_executed';
}

export function isLiquidationEvent(event: StreamingEvent): event is LiquidationEvent {
  return ['liquidation_detected', 'liquidation_executed', 'liquidation_failed'].includes(
    event.type
  );
}

export function isPositionEvent(event: StreamingEvent): event is PositionEvent {
  return ['position_opened', 'position_closed', 'position_updated'].includes(event.type);
}

export function isGlobalStatsUpdate(event: StreamingEvent): event is GlobalStatsUpdate {
  return event.type === 'global_stats';
}

export function isPriceUpdateEvent(event: StreamingEvent): event is PriceUpdateEvent {
  return event.type === 'price_update';
}
