/**
 * Event Broadcaster Service
 *
 * Central service for broadcasting events to WebSocket clients.
 * Provides type-safe methods for each event type and handles
 * channel routing automatically.
 *
 * PRIVACY: All methods enforce that only public on-chain data is broadcast.
 */

import { createLogger } from '../lib/logger.js';
import { WebSocketServer } from './websocket-server.js';
import type {
  OrderEvent,
  TradeEvent,
  LiquidationEvent,
  PositionEvent,
  GlobalStatsUpdate,
  MarketStatsUpdate,
  PriceUpdateEvent,
  StreamingEvent,
} from './types.js';

const log = createLogger('broadcaster');

// =============================================================================
// Event Broadcaster Class
// =============================================================================

export class EventBroadcaster {
  private eventQueue: StreamingEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private batchDelayMs: number;

  constructor(
    private wsServer: WebSocketServer,
    options: { batchDelayMs?: number } = {}
  ) {
    this.batchDelayMs = options.batchDelayMs ?? 50;
  }

  // ===========================================================================
  // Order Events
  // ===========================================================================

  /**
   * Broadcast an order event (placed, cancelled, or matched)
   */
  broadcastOrderEvent(event: OrderEvent): void {
    // Privacy check: ensure no encrypted fields
    this.assertNoEncryptedFields(event, ['encrypted_amount', 'encrypted_price']);

    // Broadcast to specific pair channel
    const pairChannel = `orders:${event.pairPda}`;
    this.wsServer.broadcast(pairChannel, 'order_update', event);

    // Also broadcast to general orders channel
    this.wsServer.broadcast('orders', 'order_update', event);

    log.debug(
      {
        type: event.type,
        pair: event.pairPda.slice(0, 12),
        side: event.side,
      },
      'Broadcast order event'
    );
  }

  /**
   * Create and broadcast an order placed event
   */
  orderPlaced(params: {
    orderId: string;
    pairPda: string;
    side: 'buy' | 'sell';
    maker: string;
    slot?: number;
  }): void {
    this.broadcastOrderEvent({
      type: 'order_placed',
      orderId: params.orderId,
      pairPda: params.pairPda,
      side: params.side,
      maker: params.maker,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  /**
   * Create and broadcast an order cancelled event
   */
  orderCancelled(params: {
    orderId: string;
    pairPda: string;
    side: 'buy' | 'sell';
    maker: string;
    slot?: number;
  }): void {
    this.broadcastOrderEvent({
      type: 'order_cancelled',
      orderId: params.orderId,
      pairPda: params.pairPda,
      side: params.side,
      maker: params.maker,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  /**
   * Create and broadcast an order matched event
   */
  orderMatched(params: {
    orderId: string;
    pairPda: string;
    side: 'buy' | 'sell';
    maker: string;
    slot?: number;
  }): void {
    this.broadcastOrderEvent({
      type: 'order_matched',
      orderId: params.orderId,
      pairPda: params.pairPda,
      side: params.side,
      maker: params.maker,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  // ===========================================================================
  // Trade Events
  // ===========================================================================

  /**
   * Broadcast a trade execution event
   */
  broadcastTradeEvent(event: TradeEvent): void {
    // Privacy check: ensure no fill amounts or prices
    this.assertNoEncryptedFields(event, ['fill_amount', 'price', 'encrypted']);

    // Broadcast to specific pair channel
    const pairChannel = `trades:${event.pairPda}`;
    this.wsServer.broadcast(pairChannel, 'trade', event);

    // Also broadcast to general trades channel
    this.wsServer.broadcast('trades', 'trade', event);

    log.debug(
      {
        pair: event.pairPda.slice(0, 12),
        buyer: event.buyer.slice(0, 12),
        seller: event.seller.slice(0, 12),
      },
      'Broadcast trade event'
    );
  }

  /**
   * Create and broadcast a trade executed event
   */
  tradeExecuted(params: {
    buyOrderId: string;
    sellOrderId: string;
    pairPda: string;
    buyer: string;
    seller: string;
    signature?: string;
    slot?: number;
  }): void {
    this.broadcastTradeEvent({
      type: 'trade_executed',
      buyOrderId: params.buyOrderId,
      sellOrderId: params.sellOrderId,
      pairPda: params.pairPda,
      buyer: params.buyer,
      seller: params.seller,
      timestamp: Date.now(),
      slot: params.slot,
      signature: params.signature,
    });
  }

  // ===========================================================================
  // Liquidation Events
  // ===========================================================================

  /**
   * Broadcast a liquidation event
   */
  broadcastLiquidationEvent(event: LiquidationEvent): void {
    // Privacy check: ensure no position size or collateral
    this.assertNoEncryptedFields(event, [
      'encrypted_size',
      'encrypted_collateral',
      'encrypted_pnl',
      'size',
      'collateral',
    ]);

    // Broadcast to specific market channel
    const marketChannel = `liquidations:${event.marketPda}`;
    this.wsServer.broadcast(marketChannel, 'liquidation', event);

    // Also broadcast to general liquidations channel
    this.wsServer.broadcast('liquidations', 'liquidation', event);

    log.info(
      {
        type: event.type,
        market: event.marketPda.slice(0, 12),
        side: event.side,
        owner: event.owner.slice(0, 12),
      },
      'Broadcast liquidation event'
    );
  }

  /**
   * Create and broadcast a liquidation detected event
   */
  liquidationDetected(params: {
    positionPda: string;
    marketPda: string;
    side: 'long' | 'short';
    owner: string;
    slot?: number;
  }): void {
    this.broadcastLiquidationEvent({
      type: 'liquidation_detected',
      positionPda: params.positionPda,
      marketPda: params.marketPda,
      side: params.side,
      owner: params.owner,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  /**
   * Create and broadcast a liquidation executed event
   */
  liquidationExecuted(params: {
    positionPda: string;
    marketPda: string;
    side: 'long' | 'short';
    owner: string;
    liquidator: string;
    signature?: string;
    slot?: number;
  }): void {
    this.broadcastLiquidationEvent({
      type: 'liquidation_executed',
      positionPda: params.positionPda,
      marketPda: params.marketPda,
      side: params.side,
      owner: params.owner,
      liquidator: params.liquidator,
      signature: params.signature,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  /**
   * Create and broadcast a liquidation failed event
   */
  liquidationFailed(params: {
    positionPda: string;
    marketPda: string;
    side: 'long' | 'short';
    owner: string;
    slot?: number;
  }): void {
    this.broadcastLiquidationEvent({
      type: 'liquidation_failed',
      positionPda: params.positionPda,
      marketPda: params.marketPda,
      side: params.side,
      owner: params.owner,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  // ===========================================================================
  // Position Events
  // ===========================================================================

  /**
   * Broadcast a position event
   */
  broadcastPositionEvent(event: PositionEvent): void {
    // Privacy check: ensure no position details
    this.assertNoEncryptedFields(event, [
      'encrypted_size',
      'encrypted_entry_price',
      'encrypted_collateral',
      'size',
      'entry_price',
    ]);

    // Broadcast to specific market channel
    const marketChannel = `positions:${event.marketPda}`;
    this.wsServer.broadcast(marketChannel, 'position', event);

    // Also broadcast to general positions channel
    this.wsServer.broadcast('positions', 'position', event);

    log.debug(
      {
        type: event.type,
        market: event.marketPda.slice(0, 12),
        side: event.side,
      },
      'Broadcast position event'
    );
  }

  /**
   * Create and broadcast a position opened event
   */
  positionOpened(params: {
    positionPda: string;
    marketPda: string;
    side: 'long' | 'short';
    owner: string;
    slot?: number;
  }): void {
    this.broadcastPositionEvent({
      type: 'position_opened',
      positionPda: params.positionPda,
      marketPda: params.marketPda,
      side: params.side,
      owner: params.owner,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  /**
   * Create and broadcast a position closed event
   */
  positionClosed(params: {
    positionPda: string;
    marketPda: string;
    side: 'long' | 'short';
    owner: string;
    slot?: number;
  }): void {
    this.broadcastPositionEvent({
      type: 'position_closed',
      positionPda: params.positionPda,
      marketPda: params.marketPda,
      side: params.side,
      owner: params.owner,
      timestamp: Date.now(),
      slot: params.slot,
    });
  }

  // ===========================================================================
  // Stats Events
  // ===========================================================================

  /**
   * Broadcast global exchange statistics
   */
  broadcastGlobalStats(stats: GlobalStatsUpdate): void {
    this.wsServer.broadcastAll('global_stats', stats);
    log.trace({ stats }, 'Broadcast global stats');
  }

  /**
   * Create and broadcast global stats update
   */
  globalStatsUpdate(params: {
    orderCount: number;
    pairCount: number;
    positionCount: number;
    liquidationCount24h: number;
  }): void {
    this.broadcastGlobalStats({
      type: 'global_stats',
      orderCount: params.orderCount,
      pairCount: params.pairCount,
      positionCount: params.positionCount,
      liquidationCount24h: params.liquidationCount24h,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast market-specific statistics
   */
  broadcastMarketStats(stats: MarketStatsUpdate): void {
    const channel = `market:${stats.marketPda}`;
    this.wsServer.broadcast(channel, 'market_stats', stats);
    this.wsServer.broadcast('global', 'market_stats', stats);

    log.trace({ market: stats.marketPda.slice(0, 12) }, 'Broadcast market stats');
  }

  /**
   * Create and broadcast market stats update
   */
  marketStatsUpdate(params: {
    marketPda: string;
    longPositionCount: number;
    shortPositionCount: number;
    totalLongOi: number;
    totalShortOi: number;
    fundingRateBps: number;
  }): void {
    this.broadcastMarketStats({
      type: 'market_stats',
      marketPda: params.marketPda,
      longPositionCount: params.longPositionCount,
      shortPositionCount: params.shortPositionCount,
      totalLongOi: params.totalLongOi,
      totalShortOi: params.totalShortOi,
      fundingRateBps: params.fundingRateBps,
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Price Events
  // ===========================================================================

  /**
   * Broadcast a price update from Pyth oracle
   */
  broadcastPriceUpdate(event: PriceUpdateEvent): void {
    this.wsServer.broadcast('prices', 'price_update', event);
    log.trace({ symbol: event.symbol, price: event.price }, 'Broadcast price update');
  }

  /**
   * Create and broadcast a price update event
   */
  priceUpdate(params: {
    feedId: string;
    symbol: string;
    price: string;
    confidence: string;
    publishTime: number;
  }): void {
    this.broadcastPriceUpdate({
      type: 'price_update',
      feedId: params.feedId,
      symbol: params.symbol,
      price: params.price,
      confidence: params.confidence,
      publishTime: params.publishTime,
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Batch Broadcasting
  // ===========================================================================

  /**
   * Queue an event for batched broadcasting
   * Events are flushed after batchDelayMs milliseconds
   */
  queueEvent(event: StreamingEvent): void {
    this.eventQueue.push(event);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushEventQueue();
      }, this.batchDelayMs);
    }
  }

  /**
   * Flush queued events immediately
   */
  flushEventQueue(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Group events by type for efficient broadcasting
    for (const event of events) {
      switch (event.type) {
        case 'order_placed':
        case 'order_cancelled':
        case 'order_matched':
          this.broadcastOrderEvent(event);
          break;
        case 'trade_executed':
          this.broadcastTradeEvent(event);
          break;
        case 'liquidation_detected':
        case 'liquidation_executed':
        case 'liquidation_failed':
          this.broadcastLiquidationEvent(event);
          break;
        case 'position_opened':
        case 'position_closed':
        case 'position_updated':
          this.broadcastPositionEvent(event);
          break;
        case 'global_stats':
          this.broadcastGlobalStats(event);
          break;
        case 'market_stats':
          this.broadcastMarketStats(event);
          break;
        case 'price_update':
          this.broadcastPriceUpdate(event);
          break;
      }
    }

    log.debug({ count: events.length }, 'Flushed event queue');
  }

  // ===========================================================================
  // Privacy Enforcement
  // ===========================================================================

  /**
   * Assert that an event object does not contain encrypted fields
   * This is a runtime privacy check to prevent accidental data leaks
   */
  private assertNoEncryptedFields(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: Record<string, any>,
    forbiddenPatterns: string[]
  ): void {
    const eventKeys = Object.keys(event);

    for (const key of eventKeys) {
      const lowerKey = key.toLowerCase();

      for (const pattern of forbiddenPatterns) {
        if (lowerKey.includes(pattern.toLowerCase())) {
          log.error(
            {
              eventType: event.type,
              forbiddenKey: key,
            },
            'PRIVACY VIOLATION: Attempted to broadcast encrypted field'
          );

          throw new Error(`Privacy violation: Cannot broadcast field "${key}"`);
        }
      }
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Stop the broadcaster and flush remaining events
   */
  stop(): void {
    this.flushEventQueue();
    log.info('Event broadcaster stopped');
  }
}
