/**
 * PNP Transaction Building API
 *
 * Server-side endpoint for building unsigned PNP transactions.
 * The SDK loads server-side, builds the transaction with all accounts,
 * then returns serialized unsigned transaction for client-side signing.
 *
 * Flow:
 * 1. Client sends market ID, action, amount, user pubkey
 * 2. Server uses SDK to fetch market data and derive all PDAs
 * 3. Server builds transaction instructions
 * 4. Server returns serialized unsigned transaction
 * 5. Client signs with wallet adapter and sends to network
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  PublicKey,
  Connection,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// PNP uses mainnet by default (has 862+ markets with real USDC)
// Set NEXT_PUBLIC_PNP_NETWORK=devnet to use devnet instead
const PNP_NETWORK = process.env.NEXT_PUBLIC_PNP_NETWORK || 'mainnet';
const RPC_URL =
  PNP_NETWORK === 'mainnet'
    ? process.env.NEXT_PUBLIC_PNP_MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
    : process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const PNP_PROGRAM_ID = new PublicKey('6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb');

// SDK and IDL loading state
let sdkLoadAttempted = false;
let sdkLoadError: string | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PNPClientClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdasModule: any = null;

/**
 * Load pnp-sdk at runtime using require()
 */
function loadSDK(): boolean {
  if (sdkLoadAttempted) {
    return PNPClientClass !== null;
  }

  sdkLoadAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('pnp-sdk');
    PNPClientClass = sdk.PNPClient;
    pdasModule = sdk.pdas;
    console.log('[PNP Build TX API] SDK loaded successfully');
    return true;
  } catch (error) {
    sdkLoadError = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PNP Build TX API] SDK load failed:', sdkLoadError);
    return false;
  }
}

/**
 * Derive global config PDA
 */
function deriveGlobalConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global_config')],
    PNP_PROGRAM_ID
  );
}

/**
 * Get ATA address
 */
function getAta(
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false,
  tokenProgram = TOKEN_PROGRAM_ID
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

interface BuildTxRequest {
  action: 'buy' | 'sell';
  marketId: string;
  isYes: boolean;
  amount: number; // USDC amount (will be converted to base units)
  userPubkey: string;
  minimumOut?: number; // Minimum tokens to receive (slippage protection)
}

interface MarketData {
  yesTokenMint: PublicKey;
  noTokenMint: PublicKey;
  collateralMint: PublicKey;
  creator: PublicKey;
  creatorFeeTreasury: PublicKey;
  marketReserves: bigint;
  yesSupply: bigint;
  noSupply: bigint;
}

/**
 * Fetch market data from on-chain account
 */
async function fetchMarketData(
  connection: Connection,
  marketPubkey: PublicKey
): Promise<MarketData> {
  const accountInfo = await connection.getAccountInfo(marketPubkey, 'confirmed');
  if (!accountInfo) {
    throw new Error('Market account not found');
  }

  // Decode market account using SDK's pattern
  // Market account layout (simplified):
  // - 8 bytes: discriminator
  // - Variable: market data including mints, creator, reserves, etc.

  // For now, use the read-only client to fetch market
  const client = new PNPClientClass(RPC_URL);
  const marketResponse = await client.fetchMarket(marketPubkey);
  const market = marketResponse.account;

  const yesTokenMint = new PublicKey(market.yes_token_mint || market.yesTokenMint);
  const noTokenMint = new PublicKey(market.no_token_mint || market.noTokenMint);
  const collateralMint = new PublicKey(market.collateral_token || market.collateralToken);
  const creator = new PublicKey(market.creator);
  const creatorFeeTreasury = new PublicKey(market.creator_fee_treasury || market.creatorFeeTreasury);

  // Parse reserves and supplies
  const parseValue = (v: unknown): bigint => {
    if (v === undefined || v === null) return BigInt(0);
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    if (typeof v === 'string') return BigInt(v);
    // BN object
    if (typeof v === 'object' && 'toNumber' in v) {
      return BigInt((v as { toNumber: () => number }).toNumber());
    }
    return BigInt(0);
  };

  return {
    yesTokenMint,
    noTokenMint,
    collateralMint,
    creator,
    creatorFeeTreasury,
    marketReserves: parseValue(market.market_reserves || market.marketReserves),
    yesSupply: parseValue(market.yes_token_supply_minted || market.yesTokenSupplyMinted),
    noSupply: parseValue(market.no_token_supply_minted || market.noTokenSupplyMinted),
  };
}

/**
 * Fetch global config to get admin address
 */
async function fetchGlobalConfig(
  connection: Connection
): Promise<{ admin: PublicKey }> {
  const client = new PNPClientClass(RPC_URL);
  const configResponse = await client.fetchGlobalConfig();
  const config = configResponse.account;
  return {
    admin: new PublicKey(config.admin),
  };
}

/**
 * Build mint_decision_tokens instruction data
 * Layout: [discriminator(8)] [amount(8)] [buy_yes_token(1)] [minimum_out(8)]
 */
function buildMintInstructionData(
  amount: bigint,
  buyYesToken: boolean,
  minimumOut: bigint
): Buffer {
  // Discriminator for mint_decision_tokens: [226, 180, 53, 125, 168, 69, 114, 25]
  const discriminator = Buffer.from([226, 180, 53, 125, 168, 69, 114, 25]);

  const data = Buffer.alloc(8 + 8 + 1 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeUInt8(buyYesToken ? 1 : 0, 16);
  data.writeBigUInt64LE(minimumOut, 17);

  return data;
}

/**
 * Build burn_decision_tokens instruction data
 * Layout: [discriminator(8)] [amount(8)] [burn_yes_token(1)]
 */
function buildBurnInstructionData(
  amount: bigint,
  burnYesToken: boolean
): Buffer {
  // Discriminator for burn_decision_tokens: [18, 198, 214, 1, 236, 94, 63, 29]
  const discriminator = Buffer.from([18, 198, 214, 1, 236, 94, 63, 29]);

  const data = Buffer.alloc(8 + 8 + 1);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeUInt8(burnYesToken ? 1 : 0, 16);

  return data;
}

export async function POST(request: NextRequest) {
  try {
    const sdkAvailable = loadSDK();

    if (!sdkAvailable || !PNPClientClass) {
      return NextResponse.json(
        {
          error: 'SDK not available',
          details: sdkLoadError || 'Failed to load pnp-sdk',
          fallback: 'simulation',
        },
        { status: 503 }
      );
    }

    // Parse request
    const body: BuildTxRequest = await request.json();
    const { action, marketId, isYes, amount, userPubkey, minimumOut } = body;

    // Validate inputs
    if (!action || !['buy', 'sell'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "buy" or "sell"' },
        { status: 400 }
      );
    }

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    if (typeof isYes !== 'boolean') {
      return NextResponse.json({ error: 'isYes must be a boolean' }, { status: 400 });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    if (!userPubkey) {
      return NextResponse.json({ error: 'userPubkey is required' }, { status: 400 });
    }

    // Validate pubkeys
    let marketPubkey: PublicKey;
    let buyerPubkey: PublicKey;
    try {
      marketPubkey = new PublicKey(marketId);
      buyerPubkey = new PublicKey(userPubkey);
    } catch {
      return NextResponse.json({ error: 'Invalid public key format' }, { status: 400 });
    }

    console.log('[PNP Build TX API] Building transaction:', {
      action,
      market: marketId,
      isYes,
      amount,
      user: userPubkey,
    });

    const connection = new Connection(RPC_URL, 'confirmed');

    // Fetch market data
    const marketData = await fetchMarketData(connection, marketPubkey);

    // Validate market has liquidity
    if (marketData.marketReserves === BigInt(0)) {
      return NextResponse.json(
        { error: 'Market has zero reserves' },
        { status: 400 }
      );
    }

    // Fetch global config for admin
    const globalConfig = await fetchGlobalConfig(connection);
    const [globalConfigPda] = deriveGlobalConfigPda();

    // Determine token program (check if Token-2022 or standard)
    const yesAccountInfo = await connection.getAccountInfo(marketData.yesTokenMint);
    if (!yesAccountInfo) {
      return NextResponse.json(
        { error: 'Yes token mint not found' },
        { status: 400 }
      );
    }
    const tokenProgramId = yesAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    // Derive all ATAs
    const buyerCollateralAta = getAta(buyerPubkey, marketData.collateralMint, false, tokenProgramId);
    const adminCollateralAta = getAta(globalConfig.admin, marketData.collateralMint, false, tokenProgramId);
    const marketReserveVault = getAta(marketPubkey, marketData.collateralMint, true, tokenProgramId);
    const buyerYesAta = getAta(buyerPubkey, marketData.yesTokenMint, false, tokenProgramId);
    const buyerNoAta = getAta(buyerPubkey, marketData.noTokenMint, false, tokenProgramId);

    // Build pre-instructions to create ATAs if needed
    const preInstructions: ReturnType<typeof createAssociatedTokenAccountInstruction>[] = [];

    const checkAndCreateAta = async (owner: PublicKey, mint: PublicKey, ata: PublicKey, allowOffCurve = false) => {
      const info = await connection.getAccountInfo(ata);
      if (!info) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            buyerPubkey, // payer
            ata,
            owner,
            mint,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
    };

    // Check and create necessary ATAs
    await Promise.all([
      checkAndCreateAta(buyerPubkey, marketData.collateralMint, buyerCollateralAta),
      checkAndCreateAta(globalConfig.admin, marketData.collateralMint, adminCollateralAta),
      checkAndCreateAta(marketPubkey, marketData.collateralMint, marketReserveVault, true),
      checkAndCreateAta(buyerPubkey, marketData.yesTokenMint, buyerYesAta),
      checkAndCreateAta(buyerPubkey, marketData.noTokenMint, buyerNoAta),
    ]);

    // For buy action, log balance info but don't block transaction building
    // The on-chain program will enforce balance requirements
    // This allows testing with any collateral token on devnet
    if (action === 'buy') {
      const collateralInfo = await connection.getTokenAccountBalance(buyerCollateralAta).catch(() => null);
      console.log('[PNP Build TX API] Collateral check:', {
        collateralMint: marketData.collateralMint.toBase58(),
        buyerAta: buyerCollateralAta.toBase58(),
        userBalance: collateralInfo?.value.uiAmountString || '0',
        requiredAmount: amount,
        hasAccount: !!collateralInfo,
      });

      // Warn but don't block - let the transaction attempt proceed
      if (!collateralInfo) {
        console.warn('[PNP Build TX API] User has no collateral ATA for market collateral mint');
      }
    }

    // Build the main instruction
    const amountBaseUnits = BigInt(Math.floor(amount * 1e6));
    const minOut = BigInt(minimumOut ?? 0); // Default to 0 (no slippage protection)

    // Account keys in order per IDL
    const accountKeys = [
      { pubkey: buyerPubkey, isSigner: true, isWritable: true },
      { pubkey: globalConfig.admin, isSigner: false, isWritable: true },
      { pubkey: marketData.creator, isSigner: false, isWritable: false },
      { pubkey: marketPubkey, isSigner: false, isWritable: true },
      { pubkey: globalConfigPda, isSigner: false, isWritable: false },
      { pubkey: marketData.yesTokenMint, isSigner: false, isWritable: true },
      { pubkey: marketData.noTokenMint, isSigner: false, isWritable: true },
      { pubkey: buyerYesAta, isSigner: false, isWritable: true },
      { pubkey: buyerNoAta, isSigner: false, isWritable: true },
      { pubkey: marketReserveVault, isSigner: false, isWritable: true },
      { pubkey: marketData.collateralMint, isSigner: false, isWritable: true },
      { pubkey: buyerCollateralAta, isSigner: false, isWritable: true },
      { pubkey: adminCollateralAta, isSigner: false, isWritable: true },
      { pubkey: marketData.creatorFeeTreasury, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System program
    ];

    let instructionData: Buffer;
    if (action === 'buy') {
      instructionData = buildMintInstructionData(amountBaseUnits, isYes, minOut);
    } else {
      instructionData = buildBurnInstructionData(amountBaseUnits, isYes);
    }

    // Create the main instruction
    const mainInstruction = {
      programId: PNP_PROGRAM_ID,
      keys: accountKeys,
      data: instructionData,
    };

    // Add compute budget
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

    // Build versioned transaction
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');

    const messageV0 = new TransactionMessage({
      payerKey: buyerPubkey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [computeIx, ...preInstructions, mainInstruction],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    // Serialize transaction for client
    const serializedTx = Buffer.from(transaction.serialize()).toString('base64');

    console.log('[PNP Build TX API] Transaction built successfully:', {
      preInstructions: preInstructions.length,
      action,
      amount: amountBaseUnits.toString(),
      isYes,
    });

    return NextResponse.json({
      success: true,
      transaction: serializedTx,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      message: `${action === 'buy' ? 'Buy' : 'Sell'} ${isYes ? 'YES' : 'NO'} tokens`,
      details: {
        market: marketId,
        amount: amount,
        amountBaseUnits: amountBaseUnits.toString(),
        isYes,
        preInstructionsCount: preInstructions.length,
      },
    });
  } catch (error) {
    console.error('[PNP Build TX API] Error:', error);

    return NextResponse.json(
      {
        error: 'Transaction build failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Health check - reports SDK status
export async function GET() {
  const sdkAvailable = loadSDK();

  let clientInfo = null;
  if (sdkAvailable && PNPClientClass) {
    try {
      const client = new PNPClientClass(RPC_URL);
      clientInfo = {
        hasTrading: !!client.trading,
        hasMarket: !!client.market,
        hasPdas: !!pdasModule,
        programId: PNP_PROGRAM_ID.toBase58(),
      };
    } catch (e) {
      clientInfo = { error: e instanceof Error ? e.message : 'Failed to inspect client' };
    }
  }

  return NextResponse.json({
    service: 'pnp-transaction-builder',
    status: sdkAvailable ? 'ready' : 'sdk_unavailable',
    sdkAvailable,
    sdkError: sdkLoadError,
    clientInfo,
    rpcUrl: RPC_URL,
    capabilities: sdkAvailable ? ['build_buy_tx', 'build_sell_tx', 'balance_check'] : [],
  });
}
