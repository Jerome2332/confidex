/**
 * PNP Market Creation API
 *
 * Server-side endpoint for creating prediction markets.
 *
 * Note: pnp-sdk v0.2.3 has compatibility issues with @coral-xyz/anchor 0.32.1.
 * This endpoint currently returns a simulated response.
 * Will be updated when pnp-sdk is compatible with anchor 0.32.1+.
 *
 * WARNING: Server wallet is only for devnet/testing!
 */

import { NextRequest, NextResponse } from 'next/server';
import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const SERVER_WALLET_SECRET = process.env.PNP_SERVER_WALLET_SECRET;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const PNP_API_URL = process.env.NEXT_PUBLIC_PNP_API_URL || 'https://api.pnp.exchange';

// SDK availability flag - disabled due to anchor compatibility
const SDK_AVAILABLE = false;

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { question, endTime, initialLiquidity } = body;

    // Validate inputs
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Question is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (!endTime) {
      return NextResponse.json(
        { error: 'End time is required' },
        { status: 400 }
      );
    }

    const parsedEndTime = new Date(endTime);
    if (isNaN(parsedEndTime.getTime())) {
      return NextResponse.json(
        { error: 'Invalid end time format' },
        { status: 400 }
      );
    }

    if (parsedEndTime <= new Date()) {
      return NextResponse.json(
        { error: 'End time must be in the future' },
        { status: 400 }
      );
    }

    const parsedLiquidity = Number(initialLiquidity);
    if (isNaN(parsedLiquidity) || parsedLiquidity <= 0) {
      return NextResponse.json(
        { error: 'Initial liquidity must be a positive number' },
        { status: 400 }
      );
    }

    console.log('[PNP API] Creating market:', {
      question: question.substring(0, 50) + '...',
      endTime: parsedEndTime.toISOString(),
      initialLiquidity: parsedLiquidity,
    });

    // SDK not available due to anchor compatibility issues
    // Return simulated response for development
    if (!SDK_AVAILABLE || !SERVER_WALLET_SECRET) {
      console.warn('[PNP API] SDK not available, returning simulated market');

      // Generate deterministic but unique addresses
      const marketKeypair = Keypair.generate();
      const yesTokenKeypair = Keypair.generate();
      const noTokenKeypair = Keypair.generate();

      return NextResponse.json({
        success: true,
        simulated: true,
        market: marketKeypair.publicKey.toBase58(),
        yesTokenMint: yesTokenKeypair.publicKey.toBase58(),
        noTokenMint: noTokenKeypair.publicKey.toBase58(),
        marketDetails: {
          id: marketKeypair.publicKey.toBase58(),
          question: question.trim(),
          creator: SERVER_WALLET_SECRET
            ? Keypair.fromSecretKey(bs58.decode(SERVER_WALLET_SECRET)).publicKey.toBase58()
            : 'simulated_creator',
          initialLiquidity: String(parsedLiquidity * 1e6),
          marketReserves: String(parsedLiquidity * 1e6),
          yesTokenSupply: String(parsedLiquidity * 1e6),
          noTokenSupply: String(parsedLiquidity * 1e6),
          endTime: Math.floor(parsedEndTime.getTime() / 1000),
          resolved: false,
        },
      });
    }

    // TODO: When pnp-sdk is updated for anchor 0.32.1+
    // const privateKey = bs58.decode(SERVER_WALLET_SECRET);
    // const client = new PNPClient(RPC_URL, privateKey);
    // const result = await client.markets.createMarket({
    //   question: question.trim(),
    //   endTime: parsedEndTime,
    //   initialLiquidity: parsedLiquidity,
    // });
    // return NextResponse.json({ success: true, ...result });

    return NextResponse.json(
      { error: 'SDK not available - market creation disabled' },
      { status: 503 }
    );
  } catch (error) {
    console.error('[PNP API] Market creation failed:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create market';

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Health check for the API
export async function GET() {
  const isConfigured = !!SERVER_WALLET_SECRET;

  return NextResponse.json({
    service: 'pnp-market-creation',
    status: SDK_AVAILABLE ? (isConfigured ? 'ready' : 'not_configured') : 'sdk_unavailable',
    sdkAvailable: SDK_AVAILABLE,
    note: SDK_AVAILABLE
      ? undefined
      : 'pnp-sdk has compatibility issues with anchor 0.32.1+. Using simulated mode.',
    rpcUrl: RPC_URL,
  });
}
