/**
 * Streaming Hooks Module
 *
 * Real-time WebSocket hooks for Confidex frontend.
 * All data is PUBLIC - no encrypted fields are exposed.
 */

// Core WebSocket
export {
  useWebSocket,
  useSharedWebSocket,
  WebSocketProvider,
} from './use-websocket';

// Order Stream
export {
  useOrderStream,
  useOrderPlacements,
  useOrderFills,
  useOrderCancellations,
} from './use-order-stream';

// Trade Stream
export { useTradeStream, useTradeAggregation } from './use-trade-stream';

// Price Stream
export { usePriceStream, usePrice } from './use-price-stream';
export type { ParsedPrice } from './use-price-stream';

// Global Stats
export {
  useGlobalStats,
  useMarketStats,
  useLiquidationStats,
} from './use-global-stats';
export type { GlobalStats, MarketStats, LiquidationStats } from './use-global-stats';

// Types
export type {
  // Connection
  ConnectionStatus,
  ConnectionState,
  // Channels
  ChannelType,
  ChannelSubscription,
  // Events
  OrderEvent,
  TradeEvent,
  LiquidationEvent,
  PositionEvent,
  MarketStatsEvent,
  PriceEvent,
  GlobalStatsEvent,
  StreamEvent,
  // Options
  UseWebSocketOptions,
  UseStreamOptions,
} from './types';
