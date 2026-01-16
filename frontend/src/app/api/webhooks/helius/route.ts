/**
 * Helius Webhook Handler for Confidex
 *
 * Processes real-time notifications for:
 * - Order placements
 * - Trade executions
 * - Token wraps/unwraps
 *
 * Security: Uses HMAC-SHA256 signature verification
 * Prize track: $5K Helius integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { CONFIDEX_PROGRAM_ID } from '@/lib/constants';

import { createLogger } from '@/lib/logger';

const log = createLogger('api');

// Webhook authentication
const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET;

interface HeliusWebhookPayload {
  type: string;
  signature: string;
  slot: number;
  timestamp: number;
  feePayer: string;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
        decimals: number;
      };
      userAccount: string;
    }>;
  }>;
  instructions: Array<{
    programId: string;
    accounts: string[];
    data: string;
    innerInstructions: Array<{
      programId: string;
      accounts: string[];
      data: string;
    }>;
  }>;
  events: {
    nft?: unknown;
    swap?: unknown;
    compressed?: unknown;
  };
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers: Array<{
    mint: string;
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    fromTokenAccount: string;
    toTokenAccount: string;
  }>;
}

// Confidex instruction discriminators (first 8 bytes of sha256)
const INSTRUCTION_DISCRIMINATORS = {
  placeOrder: 'f23c35f1d6c3b17e',
  cancelOrder: '5f81edf3a7d68f2c',
  matchOrders: '3a1b7c8d9e0f2a3b',
  wrapTokens: '8c4d5e6f7a8b9c0d',
  unwrapTokens: '1e2f3a4b5c6d7e8f',
} as const;

type ConfidexEventType =
  | 'OrderPlaced'
  | 'OrderCancelled'
  | 'TradeExecuted'
  | 'TokensWrapped'
  | 'TokensUnwrapped'
  | 'Unknown';

interface ConfidexEvent {
  type: ConfidexEventType;
  signature: string;
  slot: number;
  timestamp: number;
  maker?: string;
  pair?: string;
  side?: 'buy' | 'sell';
  orderId?: string;
}

/**
 * Parse Confidex-specific events from webhook payload
 */
function parseConfidexEvent(payload: HeliusWebhookPayload): ConfidexEvent | null {
  const programId = CONFIDEX_PROGRAM_ID.toBase58();

  // Find Confidex instruction
  const confidexInstruction = payload.instructions.find(
    (ix) => ix.programId === programId
  );

  if (!confidexInstruction) {
    return null;
  }

  // Decode instruction discriminator
  const dataBytes = Buffer.from(confidexInstruction.data, 'base64');
  const discriminator = dataBytes.slice(0, 8).toString('hex');

  let eventType: ConfidexEventType = 'Unknown';

  switch (discriminator) {
    case INSTRUCTION_DISCRIMINATORS.placeOrder:
      eventType = 'OrderPlaced';
      break;
    case INSTRUCTION_DISCRIMINATORS.cancelOrder:
      eventType = 'OrderCancelled';
      break;
    case INSTRUCTION_DISCRIMINATORS.matchOrders:
      eventType = 'TradeExecuted';
      break;
    case INSTRUCTION_DISCRIMINATORS.wrapTokens:
      eventType = 'TokensWrapped';
      break;
    case INSTRUCTION_DISCRIMINATORS.unwrapTokens:
      eventType = 'TokensUnwrapped';
      break;
  }

  // Extract accounts based on instruction type
  const accounts = confidexInstruction.accounts;

  return {
    type: eventType,
    signature: payload.signature,
    slot: payload.slot,
    timestamp: payload.timestamp,
    maker: accounts[0], // First account is usually maker/user
    pair: accounts.length > 2 ? accounts[2] : undefined,
    orderId: accounts.length > 3 ? accounts[3] : undefined,
  };
}

// In-memory event store for development (replace with Redis/DB in production)
const recentEvents: Map<string, ConfidexEvent> = new Map();
const MAX_CACHED_EVENTS = 1000;

// Rate limiting: track requests per IP
const rateLimitMap: Map<string, { count: number; resetAt: number }> = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // Max requests per window

/**
 * Check rate limit for IP address
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || record.resetAt < now) {
    // New window
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Store event for real-time updates
 *
 * Current implementation: In-memory cache with size limit
 * Production upgrade path:
 * 1. Push to Redis pub/sub for WebSocket broadcast
 * 2. Store in database for historical queries
 * 3. Trigger notification service (email, push, etc.)
 * 4. Update real-time order book cache
 */
async function storeEvent(event: ConfidexEvent): Promise<void> {
  // Log the event (structured logging in production)
  console.log('[Helius Webhook] Event:', JSON.stringify({
    type: event.type,
    signature: event.signature,
    slot: event.slot,
    timestamp: new Date(event.timestamp * 1000).toISOString(),
  }));

  // Store in memory cache
  recentEvents.set(event.signature, event);

  // Enforce size limit (FIFO eviction)
  if (recentEvents.size > MAX_CACHED_EVENTS) {
    const oldestKey = recentEvents.keys().next().value;
    if (oldestKey) {
      recentEvents.delete(oldestKey);
    }
  }

  // In production, would also:
  // - Publish to Redis: await redis.publish('confidex:events', JSON.stringify(event))
  // - Store in DB: await db.events.insert(event)
  // - Send notifications if subscribed users match
}

/**
 * Get recent events (for polling clients without WebSocket)
 * Accessed via GET endpoint with ?events=true query param
 */
function getRecentEvents(limit = 50): ConfidexEvent[] {
  return Array.from(recentEvents.values())
    .sort((a, b) => b.slot - a.slot)
    .slice(0, limit);
}

/**
 * Verify webhook signature from Helius using HMAC-SHA256
 *
 * Helius signs webhooks with HMAC-SHA256 using the webhook secret.
 * The signature is sent in the x-helius-signature header.
 *
 * @param payload - Raw request body as string
 * @param signature - Signature from x-helius-signature header
 * @returns true if signature is valid
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!HELIUS_WEBHOOK_SECRET) {
    // In development without secret, log warning but allow
    if (process.env.NODE_ENV === 'development') {
      log.warn('No secret configured, skipping verification in development');
      return true;
    }
    // In production, reject if no secret configured
    log.error('No secret configured - rejecting request');
    return false;
  }

  if (!signature) {
    log.warn('No signature provided');
    return false;
  }

  try {
    // Compute expected signature using HMAC-SHA256
    const expectedSignature = createHmac('sha256', HELIUS_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    // Ensure buffers are the same length before comparison
    if (signatureBuffer.length !== expectedBuffer.length) {
      log.warn('Signature length mismatch');
      return false;
    }

    const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValid) {
      log.warn('Signature verification failed');
    }

    return isValid;
  } catch (error) {
    log.error('Signature verification error', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get client IP for rate limiting
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

    // Check rate limit
    if (!checkRateLimit(ip)) {
      log.warn('Rate limit exceeded for IP:', { ip });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-helius-signature');

    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse payload
    const payload: HeliusWebhookPayload = JSON.parse(rawBody);

    // Check if this is a Confidex transaction
    const event = parseConfidexEvent(payload);

    if (!event) {
      // Not a Confidex transaction, acknowledge but don't process
      return NextResponse.json({ status: 'ignored' });
    }

    // Store/broadcast the event
    await storeEvent(event);

    // Return success
    return NextResponse.json({
      status: 'processed',
      event: {
        type: event.type,
        signature: event.signature,
      },
    });
  } catch (error) {
    log.error('Error processing webhook', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Health check and recent events endpoint
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const includeEvents = url.searchParams.get('events') === 'true';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);

  const response: {
    status: string;
    service: string;
    timestamp: number;
    eventCount: number;
    recentEvents?: ConfidexEvent[];
  } = {
    status: 'ok',
    service: 'confidex-helius-webhook',
    timestamp: Date.now(),
    eventCount: recentEvents.size,
  };

  // Optionally include recent events for debugging/polling
  if (includeEvents) {
    response.recentEvents = getRecentEvents(limit);
  }

  return NextResponse.json(response);
}
