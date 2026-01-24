/**
 * Streaming Module
 *
 * Provides real-time WebSocket streaming for the Confidex DEX.
 * Exports all streaming-related components for use throughout the backend.
 */

// Configuration
export { loadStreamingConfig, isValidChannel, getBaseChannel, getChannelIdentifier } from './config.js';
export type { StreamingConfig } from './config.js';

// WebSocket Server
export { WebSocketServer } from './websocket-server.js';

// Event Broadcaster
export { EventBroadcaster } from './event-broadcaster.js';

// Types
export type {
  // Event types
  OrderEvent,
  TradeEvent,
  LiquidationEvent,
  PositionEvent,
  GlobalStatsUpdate,
  MarketStatsUpdate,
  PriceUpdateEvent,
  StreamingEvent,
  StreamingEventType,

  // Subscription types
  SubscriptionChannel,
  SubscribeRequest,
  UnsubscribeRequest,

  // Connection types
  ClientMetadata,
  ConnectionStats,
} from './types.js';

// Type guards
export {
  isOrderEvent,
  isTradeEvent,
  isLiquidationEvent,
  isPositionEvent,
  isGlobalStatsUpdate,
  isPriceUpdateEvent,
} from './types.js';
