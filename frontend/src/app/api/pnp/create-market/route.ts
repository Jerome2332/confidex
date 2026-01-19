/**
 * PNP Market Creation API - Devnet Compatible
 *
 * Server-side endpoint for creating prediction markets on devnet using pnp-sdk 0.2.4.
 *
 * Workflow (from PNP docs):
 * 1. Create Market
 * 2. Set Market Resolvable (required for devnet before trading)
 * 3. Trade
 * 4. Redeem
 *
 * Devnet USDC: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
 * Devnet Program: pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz
 */

import { NextRequest, NextResponse } from 'next/server';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { createLogger } from '@/lib/logger';

const log = createLogger('api:pnp:create-market');

// PNP Network Configuration
const PNP_NETWORK = process.env.NEXT_PUBLIC_PNP_NETWORK || 'devnet';
const RPC_URL =
  PNP_NETWORK === 'mainnet'
    ? process.env.NEXT_PUBLIC_PNP_MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
    : process.env.NEXT_PUBLIC_PNP_DEVNET_RPC || process.env.NEXT_PUBLIC_RPC_ENDPOINT || 'https://api.devnet.solana.com';

// Devnet USDC for PNP markets
const DEVNET_COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_PNP_DEVNET_COLLATERAL || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
);

// Server wallet for creating markets (devnet only!)
const SERVER_WALLET_SECRET = process.env.PNP_SERVER_WALLET_SECRET;

// SDK loading state
let sdkLoadAttempted = false;
let sdkLoadError: string | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PNPClientClass: any = null;

function loadSDK(): boolean {
  if (sdkLoadAttempted) {
    return PNPClientClass !== null;
  }

  sdkLoadAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('pnp-sdk');
    PNPClientClass = sdk.PNPClient;
    log.info('SDK loaded successfully');
    return true;
  } catch (error) {
    sdkLoadError = error instanceof Error ? error.message : 'Unknown error';
    log.error('SDK load failed', { error: sdkLoadError });
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const sdkAvailable = loadSDK();

    // Parse request body
    const body = await request.json();
    const { question, endTime, initialLiquidity, enableTrading = true } = body;

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

    log.info('Creating market', {
      question: question.substring(0, 50) + '...',
      endTime: parsedEndTime.toISOString(),
      initialLiquidity: parsedLiquidity,
      network: PNP_NETWORK,
    });

    // Check if SDK and wallet are available
    if (!sdkAvailable || !PNPClientClass) {
      log.warn('SDK not available, returning simulated market');

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
          creator: 'simulated_creator',
          initialLiquidity: String(parsedLiquidity * 1e6),
          marketReserves: String(parsedLiquidity * 1e6),
          yesTokenSupply: String(parsedLiquidity * 1e6),
          noTokenSupply: String(parsedLiquidity * 1e6),
          endTime: Math.floor(parsedEndTime.getTime() / 1000),
          resolved: false,
          resolvable: false,
        },
        note: 'Simulated response - SDK not available',
      });
    }

    if (!SERVER_WALLET_SECRET) {
      return NextResponse.json(
        {
          error: 'Server wallet not configured',
          details: 'Set PNP_SERVER_WALLET_SECRET environment variable',
        },
        { status: 503 }
      );
    }

    // Parse server wallet
    let serverWallet: Keypair;
    try {
      // Try base58 first
      if (SERVER_WALLET_SECRET.startsWith('[')) {
        // JSON array format
        const secretArray = JSON.parse(SERVER_WALLET_SECRET);
        serverWallet = Keypair.fromSecretKey(Uint8Array.from(secretArray));
      } else {
        // Base58 format
        serverWallet = Keypair.fromSecretKey(bs58.decode(SERVER_WALLET_SECRET));
      }
    } catch (e) {
      return NextResponse.json(
        { error: 'Invalid server wallet secret key format' },
        { status: 500 }
      );
    }

    log.info('Creating market with SDK', {
      creator: serverWallet.publicKey.toBase58(),
      rpc: RPC_URL.slice(0, 50) + '...',
    });

    // Create PNP client with server wallet
    const client = new PNPClientClass(RPC_URL, serverWallet.secretKey);

    // Create market using SDK
    // Per PNP docs: client.market.createMarket()
    const endTimeUnix = BigInt(Math.floor(parsedEndTime.getTime() / 1000));
    const liquidityRaw = BigInt(Math.floor(parsedLiquidity * 1e6)); // 6 decimals

    const createResult = await client.market.createMarket({
      question: question.trim(),
      initialLiquidity: liquidityRaw,
      endTime: endTimeUnix,
      baseMint: DEVNET_COLLATERAL_MINT,
    });

    log.info('Market created', {
      market: createResult.market?.toBase58?.() || createResult.market,
      signature: createResult.signature,
    });

    const marketPubkey = new PublicKey(createResult.market);

    // On devnet, enable trading by calling setMarketResolvable(true)
    // This is required before any trades can occur
    if (enableTrading && PNP_NETWORK === 'devnet') {
      try {
        log.info('Setting market resolvable for trading...');
        await client.setMarketResolvable(marketPubkey, true);
        log.info('Market resolvable set to true - trading enabled');
      } catch (resolvableError) {
        log.warn('Failed to set market resolvable', {
          error: resolvableError instanceof Error ? resolvableError.message : String(resolvableError),
        });
        // Continue - market is created, just can't trade yet
      }
    }

    // Extract token mints safely - may not always be returned by SDK
    const yesTokenMint = createResult.yesTokenMint?.toBase58?.()
      || (typeof createResult.yesTokenMint === 'string' ? createResult.yesTokenMint : null);
    const noTokenMint = createResult.noTokenMint?.toBase58?.()
      || (typeof createResult.noTokenMint === 'string' ? createResult.noTokenMint : null);

    return NextResponse.json({
      success: true,
      simulated: false,
      market: marketPubkey.toBase58(),
      yesTokenMint,
      noTokenMint,
      signature: createResult.signature,
      marketDetails: {
        id: marketPubkey.toBase58(),
        question: question.trim(),
        creator: serverWallet.publicKey.toBase58(),
        initialLiquidity: String(liquidityRaw),
        yesTokenSupply: String(liquidityRaw),
        noTokenSupply: String(liquidityRaw),
        endTime: Number(endTimeUnix),
        resolved: false,
        resolvable: enableTrading,
      },
      network: PNP_NETWORK,
      collateralMint: DEVNET_COLLATERAL_MINT.toBase58(),
    });
  } catch (error) {
    log.error('Market creation failed', { error: error instanceof Error ? error.message : String(error) });

    const errorMessage = error instanceof Error ? error.message : 'Failed to create market';

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Health check for the API
export async function GET() {
  const sdkAvailable = loadSDK();
  const isConfigured = !!SERVER_WALLET_SECRET;

  let walletInfo = null;
  if (isConfigured && SERVER_WALLET_SECRET) {
    try {
      let wallet: Keypair;
      if (SERVER_WALLET_SECRET.startsWith('[')) {
        const secretArray = JSON.parse(SERVER_WALLET_SECRET);
        wallet = Keypair.fromSecretKey(Uint8Array.from(secretArray));
      } else {
        wallet = Keypair.fromSecretKey(bs58.decode(SERVER_WALLET_SECRET));
      }
      walletInfo = {
        address: wallet.publicKey.toBase58(),
        network: PNP_NETWORK,
      };
    } catch {
      walletInfo = { error: 'Invalid secret key format' };
    }
  }

  return NextResponse.json({
    service: 'pnp-market-creation',
    status: sdkAvailable && isConfigured ? 'ready' : sdkAvailable ? 'wallet_not_configured' : 'sdk_unavailable',
    sdkAvailable,
    sdkError: sdkLoadError,
    walletConfigured: isConfigured,
    walletInfo,
    network: PNP_NETWORK,
    rpcUrl: RPC_URL.slice(0, 50) + '...',
    collateralMint: DEVNET_COLLATERAL_MINT.toBase58(),
    note: PNP_NETWORK === 'devnet'
      ? 'Devnet mode: Markets require setMarketResolvable(true) before trading'
      : 'Mainnet mode: AI oracle handles resolvability',
  });
}
