/**
 * WebSocket Server using Socket.IO
 *
 * Provides real-time event streaming to connected clients.
 * Supports Redis adapter for horizontal scaling.
 */

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, RedisClientType } from 'redis';
import { createLogger } from '../lib/logger.js';
import { StreamingConfig, isValidChannel } from './config.js';
import type {
  ClientMetadata,
  ConnectionStats,
  SubscribeRequest,
  SubscriptionChannel,
} from './types.js';

const log = createLogger('websocket');

// =============================================================================
// WebSocket Server Class
// =============================================================================

export class WebSocketServer {
  private io: Server;
  private redisClient: RedisClientType | null = null;
  private redisSub: RedisClientType | null = null;
  private clientMetadata: Map<string, ClientMetadata> = new Map();
  private connectionCountByIp: Map<string, number> = new Map();
  private isShuttingDown = false;

  constructor(
    private httpServer: HttpServer,
    private config: StreamingConfig
  ) {
    const allowedOrigins = this.getAllowedOrigins();
    log.info({ allowedOrigins }, 'WebSocket CORS origins configured');

    this.io = new Server(httpServer, {
      path: config.websocket.path,
      pingTimeout: config.websocket.pingTimeout,
      pingInterval: config.websocket.pingInterval,
      maxHttpBufferSize: config.websocket.maxPayloadSize,
      cors: {
        origin: (origin, callback) => {
          log.debug({ origin, allowedOrigins }, 'WebSocket CORS check');
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            log.warn({ origin, allowedOrigins }, 'WebSocket CORS rejected');
            callback(new Error('CORS not allowed'), false);
          }
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Enable both polling and websocket for Render.com compatibility
      // Render lacks sticky sessions, so Socket.IO needs polling for initial handshake
      transports: ['polling', 'websocket'],
    });
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the WebSocket server
   */
  async initialize(): Promise<void> {
    // Setup Redis adapter if enabled
    if (this.config.redis.enabled && this.config.redis.url) {
      await this.setupRedisAdapter();
    }

    // Setup connection handlers
    this.setupConnectionHandlers();

    // Setup middleware
    this.setupMiddleware();

    log.info(
      {
        path: this.config.websocket.path,
        redisEnabled: this.config.redis.enabled,
      },
      'WebSocket server initialized'
    );
  }

  /**
   * Setup Redis adapter for horizontal scaling
   */
  private async setupRedisAdapter(): Promise<void> {
    if (!this.config.redis.url) {
      throw new Error('Redis URL required when Redis is enabled');
    }

    try {
      this.redisClient = createClient({
        url: this.config.redis.url,
        socket: {
          connectTimeout: this.config.redis.connectionTimeout,
        },
      });

      this.redisSub = this.redisClient.duplicate();

      // Setup error handlers before connecting
      this.redisClient.on('error', (err) => {
        log.error({ error: err.message }, 'Redis pub client error');
      });

      this.redisSub.on('error', (err) => {
        log.error({ error: err.message }, 'Redis sub client error');
      });

      await Promise.all([this.redisClient.connect(), this.redisSub.connect()]);

      this.io.adapter(createAdapter(this.redisClient, this.redisSub));

      log.info('Redis adapter configured for WebSocket horizontal scaling');
    } catch (error) {
      log.error({ error }, 'Failed to setup Redis adapter, continuing without');
      // Continue without Redis - single instance mode
    }
  }

  /**
   * Setup connection rate limiting middleware
   */
  private setupMiddleware(): void {
    this.io.use((socket, next) => {
      const ip = this.getClientIp(socket);

      // Check rate limit
      const currentCount = this.connectionCountByIp.get(ip) || 0;
      if (currentCount >= this.config.rateLimit.maxConnectionsPerIp) {
        log.warn({ ip, currentCount }, 'Connection rate limit exceeded');
        return next(new Error('Too many connections from this IP'));
      }

      next();
    });
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      if (this.isShuttingDown) {
        socket.disconnect(true);
        return;
      }

      const ip = this.getClientIp(socket);
      const clientId = socket.id;

      // Track connection count by IP
      const currentCount = this.connectionCountByIp.get(ip) || 0;
      this.connectionCountByIp.set(ip, currentCount + 1);

      // Store client metadata
      const metadata: ClientMetadata = {
        clientId,
        connectedAt: Date.now(),
        ipAddress: ip,
        userAgent: socket.handshake.headers['user-agent'],
        subscriptions: new Set(),
        // Initialize rate limiting fields
        messageCount: 0,
        messageWindowStart: Date.now(),
        rateLimitWarnings: 0,
      };
      this.clientMetadata.set(clientId, metadata);

      log.debug({ clientId, ip }, 'Client connected');

      // Handle subscription requests
      socket.on('subscribe', (request: SubscribeRequest) => {
        this.handleSubscribe(socket, request);
      });

      // Handle unsubscribe requests
      socket.on('unsubscribe', (request: { channels: string[] }) => {
        this.handleUnsubscribe(socket, request.channels);
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket, reason);
      });

      // Handle errors
      socket.on('error', (error) => {
        log.error({ clientId, error }, 'Socket error');
      });
    });
  }

  // ===========================================================================
  // Message Rate Limiting
  // ===========================================================================

  /**
   * Check if client has exceeded message rate limit
   * Returns true if allowed, false if rate limited
   */
  private checkMessageRateLimit(socket: Socket): boolean {
    const metadata = this.clientMetadata.get(socket.id);
    if (!metadata) return false;

    const now = Date.now();
    const windowMs = 60_000; // 1 minute window
    const maxMessages = this.config.rateLimit.messagesPerMinute;

    // Reset window if expired
    if (now - metadata.messageWindowStart >= windowMs) {
      metadata.messageCount = 0;
      metadata.messageWindowStart = now;
    }

    // Increment message count
    metadata.messageCount++;

    // Check if exceeded
    if (metadata.messageCount > maxMessages) {
      metadata.rateLimitWarnings++;

      // Disconnect repeat offenders (3 warnings = disconnect)
      if (metadata.rateLimitWarnings >= 3) {
        log.warn(
          { clientId: socket.id, warnings: metadata.rateLimitWarnings },
          'Client disconnected for repeated rate limit violations'
        );
        socket.emit('error', {
          code: 'RATE_LIMITED_DISCONNECT',
          message: 'Disconnected due to repeated rate limit violations',
        });
        socket.disconnect(true);
        return false;
      }

      log.warn(
        { clientId: socket.id, messageCount: metadata.messageCount, limit: maxMessages },
        'Client exceeded message rate limit'
      );
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Subscription Handlers
  // ===========================================================================

  /**
   * Handle subscription request from client
   */
  private handleSubscribe(socket: Socket, request: SubscribeRequest): void {
    const clientId = socket.id;
    const metadata = this.clientMetadata.get(clientId);

    if (!metadata) {
      log.warn({ clientId }, 'Subscribe request from unknown client');
      return;
    }

    // Check message rate limit
    if (!this.checkMessageRateLimit(socket)) {
      socket.emit('error', {
        code: 'RATE_LIMITED',
        message: `Message rate limit exceeded (${this.config.rateLimit.messagesPerMinute}/min). Please slow down.`,
      });
      return;
    }

    const validChannels: string[] = [];
    const invalidChannels: string[] = [];

    for (const channel of request.channels) {
      // Validate channel name
      if (!isValidChannel(channel)) {
        invalidChannels.push(channel);
        continue;
      }

      // Check subscription limit
      if (metadata.subscriptions.size >= this.config.rateLimit.maxSubscriptionsPerClient) {
        log.warn({ clientId, channel }, 'Subscription limit exceeded');
        socket.emit('error', {
          code: 'SUBSCRIPTION_LIMIT',
          message: `Maximum ${this.config.rateLimit.maxSubscriptionsPerClient} subscriptions allowed`,
        });
        break;
      }

      // Join the room and track subscription
      socket.join(channel);
      metadata.subscriptions.add(channel as SubscriptionChannel);
      validChannels.push(channel);
    }

    if (validChannels.length > 0) {
      log.debug({ clientId, channels: validChannels }, 'Client subscribed');
      socket.emit('subscribed', { channels: validChannels });
    }

    if (invalidChannels.length > 0) {
      log.warn({ clientId, channels: invalidChannels }, 'Invalid channel names');
      socket.emit('error', {
        code: 'INVALID_CHANNEL',
        message: `Invalid channels: ${invalidChannels.join(', ')}`,
      });
    }
  }

  /**
   * Handle unsubscribe request from client
   */
  private handleUnsubscribe(socket: Socket, channels: string[]): void {
    const clientId = socket.id;
    const metadata = this.clientMetadata.get(clientId);

    if (!metadata) return;

    // Check message rate limit
    if (!this.checkMessageRateLimit(socket)) {
      socket.emit('error', {
        code: 'RATE_LIMITED',
        message: `Message rate limit exceeded (${this.config.rateLimit.messagesPerMinute}/min). Please slow down.`,
      });
      return;
    }

    for (const channel of channels) {
      socket.leave(channel);
      metadata.subscriptions.delete(channel as SubscriptionChannel);
    }

    log.debug({ clientId, channels }, 'Client unsubscribed');
    socket.emit('unsubscribed', { channels });
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnect(socket: Socket, reason: string): void {
    const clientId = socket.id;
    const metadata = this.clientMetadata.get(clientId);

    if (metadata) {
      // Decrement connection count for IP
      const ip = metadata.ipAddress;
      if (ip) {
        const currentCount = this.connectionCountByIp.get(ip) || 1;
        if (currentCount <= 1) {
          this.connectionCountByIp.delete(ip);
        } else {
          this.connectionCountByIp.set(ip, currentCount - 1);
        }
      }

      // Remove client metadata
      this.clientMetadata.delete(clientId);
    }

    log.debug({ clientId, reason }, 'Client disconnected');
  }

  // ===========================================================================
  // Broadcasting Methods
  // ===========================================================================

  /**
   * Broadcast event to a specific channel
   */
  broadcast(channel: string, event: string, data: unknown): void {
    if (this.isShuttingDown) return;

    this.io.to(channel).emit(event, data);
    log.trace({ channel, event }, 'Broadcast to channel');
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastAll(event: string, data: unknown): void {
    if (this.isShuttingDown) return;

    this.io.emit(event, data);
    log.trace({ event }, 'Broadcast to all clients');
  }

  /**
   * Broadcast to multiple channels at once
   */
  broadcastToChannels(channels: string[], event: string, data: unknown): void {
    if (this.isShuttingDown) return;

    for (const channel of channels) {
      this.io.to(channel).emit(event, data);
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get client IP address from socket
   */
  private getClientIp(socket: Socket): string {
    // Check for X-Forwarded-For header (behind proxy)
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return ips.trim();
    }
    return socket.handshake.address;
  }

  /**
   * Get allowed CORS origins
   */
  private getAllowedOrigins(): string[] {
    // Hardcoded production origins (same as Express CORS)
    const origins = [
      'https://www.confidex.xyz',
      'https://confidex.xyz',
      'https://staging.confidex.exchange',
    ];

    // Add origins from environment variable
    const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [];
    origins.push(...envOrigins);

    // Always allow localhost in development
    if (process.env.NODE_ENV !== 'production') {
      origins.push('http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000');
    }

    // Add frontend URL if specified
    if (process.env.FRONTEND_URL) {
      origins.push(process.env.FRONTEND_URL);
    }

    return [...new Set(origins)]; // Deduplicate
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    const connectionsByChannel: Record<string, number> = {};

    // Count subscriptions per channel
    for (const metadata of this.clientMetadata.values()) {
      for (const channel of metadata.subscriptions) {
        connectionsByChannel[channel] = (connectionsByChannel[channel] || 0) + 1;
      }
    }

    return {
      totalConnections: this.clientMetadata.size,
      activeConnections: this.io.sockets.sockets.size,
      totalSubscriptions: Array.from(this.clientMetadata.values()).reduce(
        (sum, m) => sum + m.subscriptions.size,
        0
      ),
      connectionsByChannel,
    };
  }

  /**
   * Get the underlying Socket.IO server instance
   */
  getIO(): Server {
    return this.io;
  }

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  /**
   * Gracefully shutdown the WebSocket server
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    log.info('Shutting down WebSocket server...');

    // Notify all clients
    this.io.emit('server_shutdown', { message: 'Server is shutting down' });

    // Disconnect all clients
    const sockets = await this.io.fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }

    // Close Redis connections
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    if (this.redisSub) {
      await this.redisSub.quit();
    }

    // Close Socket.IO server
    await new Promise<void>((resolve) => {
      this.io.close(() => resolve());
    });

    this.clientMetadata.clear();
    this.connectionCountByIp.clear();

    log.info('WebSocket server shut down');
  }
}
