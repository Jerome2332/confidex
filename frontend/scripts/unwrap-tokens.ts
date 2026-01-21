/**
 * Unwrap Tokens (Withdraw from Confidential Balance)
 *
 * Withdraws tokens from your confidential balance back to your wallet.
 * Run with: pnpm tsx scripts/unwrap-tokens.ts [sol|usdc] [amount]
 *
 * Examples:
 *   pnpm tsx scripts/unwrap-tokens.ts sol 4.5    # Withdraw 4.5 SOL
 *   pnpm tsx scripts/unwrap-tokens.ts usdc 13   # Withdraw 13 USDC
 *   pnpm tsx scripts/unwrap-tokens.ts sol       # Withdraw ALL SOL
 *   pnpm tsx scripts/unwrap-tokens.ts usdc      # Withdraw ALL USDC
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Constants
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');
const USER_BALANCE_SEED = Buffer.from('user_balance');

function computeDiscriminator(instructionName: string): Buffer {
  const hash = crypto.createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return Buffer.from(hash.subarray(0, 8));
}

const UNWRAP_TOKENS_DISCRIMINATOR = computeDiscriminator('unwrap_tokens');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], CONFIDEX_PROGRAM_ID);
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

function deriveUserBalancePda(user: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_BALANCE_SEED, user.toBuffer(), mint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

async function main() {
  console.log('============================================================');
  console.log('   Unwrap Tokens (Withdraw from Confidential Balance)');
  console.log('============================================================\n');

  // Parse args
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: pnpm tsx scripts/unwrap-tokens.ts [sol|usdc] [amount]');
    console.log('');
    console.log('Examples:');
    console.log('  pnpm tsx scripts/unwrap-tokens.ts sol 4.5    # Withdraw 4.5 SOL');
    console.log('  pnpm tsx scripts/unwrap-tokens.ts usdc 13   # Withdraw 13 USDC');
    console.log('  pnpm tsx scripts/unwrap-tokens.ts sol       # Withdraw ALL SOL');
    return;
  }

  const tokenArg = args[0].toLowerCase();
  const amountArg = args[1] ? parseFloat(args[1]) : null;

  if (tokenArg !== 'sol' && tokenArg !== 'usdc') {
    console.error('Token must be "sol" or "usdc"');
    return;
  }

  const isSol = tokenArg === 'sol';
  const tokenMint = isSol ? WSOL_MINT : USDC_MINT;
  const decimals = isSol ? 9 : 6;
  const tokenName = isSol ? 'SOL' : 'USDC';

  // Load keypair from default location (~/.config/solana/id.json)
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');
  let user: Keypair;

  try {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    user = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`Wallet: ${user.publicKey.toString()}`);
  } catch (e) {
    console.error(`Could not read keypair from ${keypairPath}`);
    console.error('Make sure you have a Solana keypair at ~/.config/solana/id.json');
    return;
  }

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check current confidential balance
  const [userBalancePda] = deriveUserBalancePda(user.publicKey, tokenMint);
  const balanceInfo = await connection.getAccountInfo(userBalancePda);

  if (!balanceInfo) {
    console.error(`No confidential ${tokenName} balance account found`);
    return;
  }

  // Read balance from offset 72 (8 disc + 32 owner + 32 mint)
  const currentBalance = balanceInfo.data.readBigUInt64LE(72);
  const currentBalanceDisplay = Number(currentBalance) / Math.pow(10, decimals);
  console.log(`Current confidential ${tokenName} balance: ${currentBalanceDisplay.toFixed(isSol ? 4 : 2)} ${tokenName}`);

  if (currentBalance === BigInt(0)) {
    console.log('Nothing to withdraw');
    return;
  }

  // Determine amount to unwrap
  let unwrapAmount: bigint;
  if (amountArg === null) {
    // Withdraw all
    unwrapAmount = currentBalance;
    console.log(`\nWithdrawing ALL: ${currentBalanceDisplay.toFixed(isSol ? 4 : 2)} ${tokenName}`);
  } else {
    unwrapAmount = BigInt(Math.floor(amountArg * Math.pow(10, decimals)));
    if (unwrapAmount > currentBalance) {
      console.error(`Cannot withdraw ${amountArg} ${tokenName}, only have ${currentBalanceDisplay.toFixed(isSol ? 4 : 2)}`);
      return;
    }
    console.log(`\nWithdrawing: ${amountArg} ${tokenName}`);
  }

  // Get PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);

  // Get vault address from trading pair
  const pairInfo = await connection.getAccountInfo(pairPda);
  if (!pairInfo) {
    console.error('Trading pair not found');
    return;
  }

  // TradingPair layout offsets:
  // 8 (discriminator) + 32 (base_mint) + 32 (quote_mint) + 32 (c_base_mint) + 32 (c_quote_mint) = 136
  // c_base_vault at 136, c_quote_vault at 168
  const vaultOffset = isSol ? 136 : 168;
  const vault = new PublicKey(pairInfo.data.slice(vaultOffset, vaultOffset + 32));
  console.log(`Vault: ${vault.toString()}`);

  // Get user's token account
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, user.publicKey);
  console.log(`User token account: ${userTokenAccount.toString()}`);

  // Build transaction
  const tx = new Transaction();

  // Add compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));

  // For SOL, ensure WSOL ATA exists
  if (isSol) {
    const ataInfo = await connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      console.log('Creating WSOL ATA...');
      tx.add(
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          userTokenAccount,
          user.publicKey,
          NATIVE_MINT
        )
      );
    }
  }

  // Build unwrap instruction data: discriminator (8) + amount (8)
  const instructionData = Buffer.alloc(16);
  Buffer.from(UNWRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(unwrapAmount, 8);

  // Build unwrap instruction
  // Accounts from unwrap_tokens.rs:
  // 1. exchange - ExchangeState
  // 2. pair - TradingPair
  // 3. token_mint - The mint being unwrapped
  // 4. user_token_account - User's token account to receive
  // 5. vault - Pair's vault to withdraw from
  // 6. user_balance - User's confidential balance PDA
  // 7. pair_authority - Same as pair PDA (signs vault transfer)
  // 8. user - Signer
  // 9. token_program
  tx.add({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: false }, // pair_authority
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  // For SOL, close WSOL ATA to convert back to native SOL
  if (isSol) {
    tx.add(
      createCloseAccountInstruction(
        userTokenAccount,
        user.publicKey,
        user.publicKey
      )
    );
  }

  // Send transaction
  try {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = user.publicKey;

    console.log('\nSending unwrap transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [user], {
      commitment: 'confirmed',
    });

    console.log(`\n✅ Withdrawal successful!`);
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Check new balances
    const newBalanceInfo = await connection.getAccountInfo(userBalancePda);
    if (newBalanceInfo) {
      const newBalance = newBalanceInfo.data.readBigUInt64LE(72);
      const newBalanceDisplay = Number(newBalance) / Math.pow(10, decimals);
      console.log(`\n   Remaining confidential ${tokenName}: ${newBalanceDisplay.toFixed(isSol ? 4 : 2)} ${tokenName}`);
    }

    if (isSol) {
      const nativeBalance = await connection.getBalance(user.publicKey);
      console.log(`   Native SOL balance: ${(nativeBalance / 1e9).toFixed(4)} SOL`);
    } else {
      try {
        const usdcAccount = await connection.getTokenAccountBalance(userTokenAccount);
        console.log(`   USDC token balance: ${usdcAccount.value.uiAmountString} USDC`);
      } catch {
        console.log(`   USDC token account does not exist yet`);
      }
    }

  } catch (e) {
    console.error('Withdrawal failed:', e);
    if (e instanceof Error && e.message.includes('0x1')) {
      console.error('\nThis might be an insufficient funds error in the vault.');
    }
  }
}

main().catch(console.error);
