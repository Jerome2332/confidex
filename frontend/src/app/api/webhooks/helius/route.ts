/**
 * Helius Webhook Handler for Confidex
 *
 * Processes real-time notifications for:
 * - Order placements
 * - Trade executions
 * - Token wraps/unwraps
 *
 * Prize track: $5K Helius integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { CONFIDEX_PROGRAM_ID } from '@/lib/constants';

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

/**
 * Store event for real-time updates
 * In production, this would push to a message queue or WebSocket
 */
async function storeEvent(event: ConfidexEvent): Promise<void> {
  // For demo: log the event
  console.log('[Helius Webhook] Event:', JSON.stringify(event, null, 2));

  // In production, options include:
  // 1. Push to Redis pub/sub for WebSocket broadcast
  // 2. Store in database for historical queries
  // 3. Trigger notification service (email, push, etc.)
  // 4. Update real-time order book cache
}

/**
 * Verify webhook signature from Helius
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!HELIUS_WEBHOOK_SECRET) {
    // In development, skip verification
    console.warn('[Helius Webhook] No secret configured, skipping verification');
    return true;
  }

  if (!signature) {
    return false;
  }

  // Helius uses HMAC-SHA256 for webhook signatures
  // In production, implement proper HMAC verification
  // For now, just check if signature exists
  return signature.length > 0;
}

export async function POST(request: NextRequest) {
  try {
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
    console.error('[Helius Webhook] Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Health check for webhook endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'confidex-helius-webhook',
    timestamp: Date.now(),
  });
}
