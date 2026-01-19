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

import { createLogger } from '@/lib/logger';

const log = createLogger('api');
import {
  PublicKey,
  Connection,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  Keypair,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// PNP Network Configuration
// Set NEXT_PUBLIC_PNP_NETWORK=devnet for testing, mainnet for production
const PNP_NETWORK = process.env.NEXT_PUBLIC_PNP_NETWORK || 'devnet';
const RPC_URL =
  PNP_NETWORK === 'mainnet'
    ? process.env.NEXT_PUBLIC_PNP_MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
    : process.env.NEXT_PUBLIC_PNP_DEVNET_RPC || process.env.NEXT_PUBLIC_RPC_ENDPOINT || 'https://api.devnet.solana.com';

// PNP Program IDs
const PNP_MAINNET_PROGRAM_ID = new PublicKey('6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb');
const PNP_DEVNET_PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PNP_DEVNET_PROGRAM || 'pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz');
const PNP_PROGRAM_ID = PNP_NETWORK === 'mainnet' ? PNP_MAINNET_PROGRAM_ID : PNP_DEVNET_PROGRAM_ID;

// Devnet USDC for PNP markets
const DEVNET_COLLATERAL_MINT = process.env.NEXT_PUBLIC_PNP_DEVNET_COLLATERAL || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

log.info(`PNP Build TX API initialized - Network: ${PNP_NETWORK}, Program: ${PNP_PROGRAM_ID.toBase58()}, RPC: ${RPC_URL.slice(0, 50)}...`);

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
    log.debug('SDK loaded successfully');
    return true;
  } catch (error) {
    sdkLoadError = error instanceof Error ? error.message : 'Unknown error';
    log.error('SDK load failed', { error: sdkLoadError });
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
  action: 'buy' | 'sell' | 'redeem';
  marketId: string;
  isYes?: boolean; // Optional for redeem (redeems both)
  amount?: number; // USDC amount for buy/sell (will be converted to base units)
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
  resolved: boolean;
  winningOutcome: 'YES' | 'NO' | null;
}

/**
 * Fetch market data using SDK's fetchMarket for raw on-chain data
 *
 * IMPORTANT: We use fetchMarket() instead of trading.getMarketInfo() because:
 * - getMarketInfo() tries to derive PDAs but returns System Program for some markets
 * - fetchMarket() returns the actual on-chain token mint addresses
 * - The raw account data has yes_token_mint and no_token_mint fields with real addresses
 */
async function fetchMarketData(
  connection: Connection,
  marketPubkey: PublicKey
): Promise<MarketData> {
  const accountInfo = await connection.getAccountInfo(marketPubkey, 'confirmed');
  if (!accountInfo) {
    throw new Error('Market account not found');
  }

  // Use fetchMarket to get raw on-chain data with actual token mints
  const client = new PNPClientClass(RPC_URL);
  const marketResponse = await client.fetchMarket(marketPubkey);
  const rawMarket = marketResponse.account;

  log.debug('Raw market data from SDK', {
    id: rawMarket.id,
    yes_token_mint: rawMarket.yes_token_mint,
    no_token_mint: rawMarket.no_token_mint,
    collateral_token: rawMarket.collateral_token,
    resolvable: rawMarket.resolvable,
  });

  // Extract token mints - handle both string and PublicKey formats
  const extractPubkey = (value: unknown, fieldName: string): PublicKey => {
    if (!value) {
      throw new Error(`Missing required field: ${fieldName}`);
    }
    if (typeof value === 'string') {
      return new PublicKey(value);
    }
    if (typeof value === 'object' && value !== null) {
      if ('toBase58' in value) {
        return new PublicKey((value as { toBase58: () => string }).toBase58());
      }
      if ('toString' in value) {
        return new PublicKey((value as { toString: () => string }).toString());
      }
    }
    throw new Error(`Invalid value for ${fieldName}: ${typeof value}`);
  };

  // Use raw market data fields (snake_case from on-chain account)
  const yesTokenMint = extractPubkey(
    rawMarket.yes_token_mint || rawMarket.yesTokenMint,
    'yesTokenMint'
  );
  const noTokenMint = extractPubkey(
    rawMarket.no_token_mint || rawMarket.noTokenMint,
    'noTokenMint'
  );
  const collateralMint = extractPubkey(
    rawMarket.collateral_token || rawMarket.collateralToken,
    'collateralMint'
  );
  const creator = extractPubkey(rawMarket.creator, 'creator');
  const creatorFeeTreasury = extractPubkey(
    rawMarket.creator_fee_treasury || rawMarket.creatorFeeTreasury,
    'creatorFeeTreasury'
  );

  // Validate token mints are not System Program (market not fully initialized)
  const SYSTEM_PROGRAM = '11111111111111111111111111111111';
  if (yesTokenMint.toBase58() === SYSTEM_PROGRAM || noTokenMint.toBase58() === SYSTEM_PROGRAM) {
    throw new Error(
      `Market token mints are not initialized. This market needs setMarketResolvable(true) called. ` +
      `Market: ${marketPubkey.toBase58()}`
    );
  }

  // Check if market is resolvable (required for trading)
  if (!rawMarket.resolvable) {
    throw new Error(
      `Market is not resolvable yet. On devnet, call setMarketResolvable(true) to enable trading. ` +
      `Market: ${marketPubkey.toBase58()}`
    );
  }

  // Parse hex string values from raw market data
  const parseHexValue = (v: unknown): bigint => {
    if (v === undefined || v === null) return BigInt(0);
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    if (typeof v === 'string') {
      // Handle hex strings (e.g., "05f5e100")
      if (/^[0-9a-fA-F]+$/.test(v)) {
        return BigInt('0x' + v);
      }
      return BigInt(v);
    }
    if (typeof v === 'object' && 'toNumber' in v) {
      return BigInt((v as { toNumber: () => number }).toNumber());
    }
    return BigInt(0);
  };

  // Determine winning outcome
  let winningOutcome: 'YES' | 'NO' | null = null;
  const winningTokenId = rawMarket.winning_token_id || rawMarket.winningTokenId;
  if (winningTokenId && typeof winningTokenId === 'object') {
    if ('Yes' in winningTokenId) {
      winningOutcome = 'YES';
    } else if ('No' in winningTokenId) {
      winningOutcome = 'NO';
    }
  }

  return {
    yesTokenMint,
    noTokenMint,
    collateralMint,
    creator,
    creatorFeeTreasury,
    marketReserves: parseHexValue(rawMarket.market_reserves || rawMarket.marketReserves),
    yesSupply: parseHexValue(rawMarket.yes_token_supply_minted || rawMarket.yesTokenSupplyMinted),
    noSupply: parseHexValue(rawMarket.no_token_supply_minted || rawMarket.noTokenSupplyMinted),
    resolved: Boolean(rawMarket.resolved),
    winningOutcome,
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

/**
 * Build redeem_winnings instruction data
 * Layout: [discriminator(8)]
 */
function buildRedeemInstructionData(): Buffer {
  // Discriminator for redeem_winnings: [149, 95, 181, 242, 94, 90, 158, 162]
  // Calculated from: sha256("global:redeem_winnings")[0..8]
  const discriminator = Buffer.from([149, 95, 181, 242, 94, 90, 158, 162]);
  return discriminator;
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
    if (!action || !['buy', 'sell', 'redeem'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "buy", "sell", or "redeem"' },
        { status: 400 }
      );
    }

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    // Buy/sell require isYes and amount, redeem doesn't
    if (action !== 'redeem') {
      if (typeof isYes !== 'boolean') {
        return NextResponse.json({ error: 'isYes must be a boolean' }, { status: 400 });
      }

      if (typeof amount !== 'number' || amount <= 0) {
        return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
      }
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

    // Determine token program for each mint (collateral vs outcome tokens may differ)
    // YES/NO tokens on PNP devnet use Token-2022, collateral may use standard Token Program
    const [yesAccountInfo, noAccountInfo, collateralAccountInfo] = await Promise.all([
      connection.getAccountInfo(marketData.yesTokenMint),
      connection.getAccountInfo(marketData.noTokenMint),
      connection.getAccountInfo(marketData.collateralMint),
    ]);

    if (!yesAccountInfo) {
      return NextResponse.json(
        { error: 'Yes token mint not found' },
        { status: 400 }
      );
    }
    if (!noAccountInfo) {
      return NextResponse.json(
        { error: 'No token mint not found' },
        { status: 400 }
      );
    }
    if (!collateralAccountInfo) {
      return NextResponse.json(
        { error: 'Collateral mint not found' },
        { status: 400 }
      );
    }

    // Determine program ID for each token type
    const yesTokenProgramId = yesAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const noTokenProgramId = noAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const collateralProgramId = collateralAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    console.log('[PNP Build TX API] Token program detection:', {
      yesMint: marketData.yesTokenMint.toBase58(),
      yesOwner: yesAccountInfo.owner.toBase58(),
      yesProgram: yesTokenProgramId.toBase58(),
      noMint: marketData.noTokenMint.toBase58(),
      noOwner: noAccountInfo.owner.toBase58(),
      noProgram: noTokenProgramId.toBase58(),
      collateralMint: marketData.collateralMint.toBase58(),
      collateralOwner: collateralAccountInfo.owner.toBase58(),
      collateralProgram: collateralProgramId.toBase58(),
    });

    // Derive all ATAs with correct token programs
    const buyerCollateralAta = getAta(buyerPubkey, marketData.collateralMint, false, collateralProgramId);
    const adminCollateralAta = getAta(globalConfig.admin, marketData.collateralMint, false, collateralProgramId);
    const marketReserveVault = getAta(marketPubkey, marketData.collateralMint, true, collateralProgramId);
    const buyerYesAta = getAta(buyerPubkey, marketData.yesTokenMint, false, yesTokenProgramId);
    const buyerNoAta = getAta(buyerPubkey, marketData.noTokenMint, false, noTokenProgramId);

    // Build pre-instructions to create ATAs if needed
    const preInstructions: ReturnType<typeof createAssociatedTokenAccountInstruction>[] = [];

    const checkAndCreateAta = async (
      owner: PublicKey,
      mint: PublicKey,
      ata: PublicKey,
      tokenProgram: PublicKey,
      label: string
    ) => {
      const info = await connection.getAccountInfo(ata);
      if (!info) {
        console.log(`[PNP Build TX API] Creating ATA for ${label}:`, {
          owner: owner.toBase58(),
          mint: mint.toBase58(),
          ata: ata.toBase58(),
          tokenProgram: tokenProgram.toBase58(),
        });
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            buyerPubkey, // payer
            ata,
            owner,
            mint,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      } else {
        console.log(`[PNP Build TX API] ATA exists for ${label}:`, ata.toBase58());
      }
    };

    // Check and create necessary ATAs with correct token programs
    await Promise.all([
      checkAndCreateAta(buyerPubkey, marketData.collateralMint, buyerCollateralAta, collateralProgramId, 'buyerCollateral'),
      checkAndCreateAta(globalConfig.admin, marketData.collateralMint, adminCollateralAta, collateralProgramId, 'adminCollateral'),
      checkAndCreateAta(marketPubkey, marketData.collateralMint, marketReserveVault, collateralProgramId, 'marketReserveVault'),
      checkAndCreateAta(buyerPubkey, marketData.yesTokenMint, buyerYesAta, yesTokenProgramId, 'buyerYes'),
      checkAndCreateAta(buyerPubkey, marketData.noTokenMint, buyerNoAta, noTokenProgramId, 'buyerNo'),
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
        log.warn('User has no collateral ATA for market collateral mint');
      }
    }

    // Handle redeem action separately
    if (action === 'redeem') {
      // Validate market is resolved
      if (!marketData.resolved) {
        return NextResponse.json(
          { error: 'Market is not yet resolved' },
          { status: 400 }
        );
      }

      if (!marketData.winningOutcome) {
        return NextResponse.json(
          { error: 'Market has no winning outcome set' },
          { status: 400 }
        );
      }

      // For redeem, we need the winning token ATA
      const winningMint = marketData.winningOutcome === 'YES'
        ? marketData.yesTokenMint
        : marketData.noTokenMint;
      const winningTokenProgramId = marketData.winningOutcome === 'YES'
        ? yesTokenProgramId
        : noTokenProgramId;
      const userWinningAta = getAta(buyerPubkey, winningMint, false, winningTokenProgramId);

      // Check user has winning tokens
      const winningBalance = await connection.getTokenAccountBalance(userWinningAta).catch(() => null);
      if (!winningBalance || BigInt(winningBalance.value.amount) === BigInt(0)) {
        return NextResponse.json(
          {
            error: 'No winning tokens to redeem',
            details: {
              winningOutcome: marketData.winningOutcome,
              userBalance: '0',
            }
          },
          { status: 400 }
        );
      }

      // Account keys for redeem instruction
      const redeemAccountKeys = [
        { pubkey: buyerPubkey, isSigner: true, isWritable: true },
        { pubkey: marketPubkey, isSigner: false, isWritable: true },
        { pubkey: globalConfigPda, isSigner: false, isWritable: false },
        { pubkey: winningMint, isSigner: false, isWritable: true },
        { pubkey: userWinningAta, isSigner: false, isWritable: true },
        { pubkey: marketReserveVault, isSigner: false, isWritable: true },
        { pubkey: buyerCollateralAta, isSigner: false, isWritable: true },
        { pubkey: marketData.collateralMint, isSigner: false, isWritable: false },
        { pubkey: winningTokenProgramId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      ];

      const redeemInstruction = {
        programId: PNP_PROGRAM_ID,
        keys: redeemAccountKeys,
        data: buildRedeemInstructionData(),
      };

      // Add compute budget
      const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

      // Build versioned transaction
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');

      const messageV0 = new TransactionMessage({
        payerKey: buyerPubkey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [computeIx, ...preInstructions, redeemInstruction],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      const serializedTx = Buffer.from(transaction.serialize()).toString('base64');

      console.log('[PNP Build TX API] Redeem transaction built successfully:', {
        market: marketId,
        winningOutcome: marketData.winningOutcome,
        userBalance: winningBalance.value.uiAmountString,
      });

      return NextResponse.json({
        success: true,
        transaction: serializedTx,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        message: `Redeem ${marketData.winningOutcome} tokens`,
        details: {
          market: marketId,
          winningOutcome: marketData.winningOutcome,
          tokenBalance: winningBalance.value.uiAmountString,
        },
      });
    }

    // Build the main instruction for buy/sell
    const amountBaseUnits = BigInt(Math.floor((amount ?? 0) * 1e6));
    const minOut = BigInt(minimumOut ?? 0); // Default to 0 (no slippage protection)

    // Account keys in order per IDL
    // Note: PNP may need both token programs if collateral differs from outcome tokens
    // The program expects the outcome token program for minting YES/NO tokens
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
      { pubkey: yesTokenProgramId, isSigner: false, isWritable: false }, // Use YES token program for outcome tokens
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System program
    ];

    let instructionData: Buffer;
    if (action === 'buy') {
      instructionData = buildMintInstructionData(amountBaseUnits, isYes ?? true, minOut);
    } else {
      instructionData = buildBurnInstructionData(amountBaseUnits, isYes ?? true);
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
    log.error('Error', { error: error instanceof Error ? error.message : String(error) });

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
    capabilities: sdkAvailable ? ['build_buy_tx', 'build_sell_tx', 'build_redeem_tx', 'balance_check'] : [],
  });
}
