'use client';

/**
 * Exchange Config Hook
 *
 * Reads on-chain ExchangeState and provides pause/unpause mutations.
 */

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { useCallback, useEffect, useState } from 'react';
import { deriveExchangePda } from '@/lib/confidex-client';
import { CONFIDEX_PROGRAM_ID } from '@/lib/constants';

// Anchor instruction discriminators (sha256("global:<name>")[0..8])
const PAUSE_DISCRIMINATOR = new Uint8Array([0xd3, 0x16, 0xdd, 0xfb, 0x4a, 0x79, 0xc1, 0x2f]);
const UNPAUSE_DISCRIMINATOR = new Uint8Array([0xa9, 0x90, 0x04, 0x26, 0x0a, 0x8d, 0xbc, 0xff]);

export interface ExchangeConfig {
  authority: string;
  feeRecipient: string;
  makerFeeBps: number;
  takerFeeBps: number;
  isPaused: boolean;
  blacklistRoot: string;
  arciumCluster: string;
  pairCount: bigint;
  orderCount: bigint;
}

export function useExchangeConfig(pollInterval = 30000) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [config, setConfig] = useState<ExchangeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txPending, setTxPending] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const [exchangePda] = deriveExchangePda();
      const accountInfo = await connection.getAccountInfo(exchangePda);

      if (!accountInfo) {
        setError('Exchange not initialized');
        setConfig(null);
        return;
      }

      // ExchangeState layout:
      // 8 bytes discriminator
      // 32 bytes authority
      // 32 bytes fee_recipient
      // 2 bytes maker_fee_bps
      // 2 bytes taker_fee_bps
      // 1 byte paused
      // 32 bytes blacklist_root
      // 32 bytes arcium_cluster
      // 8 bytes pair_count
      // 8 bytes order_count
      // 1 byte bump

      const data = accountInfo.data;
      let offset = 8; // Skip discriminator

      const authority = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const feeRecipient = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const makerFeeBps = data.readUInt16LE(offset);
      offset += 2;

      const takerFeeBps = data.readUInt16LE(offset);
      offset += 2;

      const isPaused = data[offset] === 1;
      offset += 1;

      const blacklistRoot = Buffer.from(data.subarray(offset, offset + 32)).toString('hex');
      offset += 32;

      const arciumCluster = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const pairCount = data.readBigUInt64LE(offset);
      offset += 8;

      const orderCount = data.readBigUInt64LE(offset);

      setConfig({
        authority,
        feeRecipient,
        makerFeeBps,
        takerFeeBps,
        isPaused,
        blacklistRoot,
        arciumCluster,
        pairCount,
        orderCount,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch exchange config');
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, pollInterval);
    return () => clearInterval(interval);
  }, [fetchConfig, pollInterval]);

  const isAdmin = publicKey && config && publicKey.toBase58() === config.authority;

  const pause = useCallback(async () => {
    if (!publicKey || !signTransaction || !config) {
      throw new Error('Wallet not connected');
    }

    if (publicKey.toBase58() !== config.authority) {
      throw new Error('Connected wallet is not the admin authority');
    }

    setTxPending(true);
    try {
      const [exchangePda] = deriveExchangePda();

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: exchangePda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: false },
        ],
        programId: CONFIDEX_PROGRAM_ID,
        data: Buffer.from(PAUSE_DISCRIMINATOR),
      });

      const transaction = new Transaction().add(instruction);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      await fetchConfig();
      return signature;
    } catch (err) {
      // Log full error details for debugging
      console.error('[useExchangeConfig] pause() failed:', err);
      if (err && typeof err === 'object' && 'logs' in err) {
        console.error('[useExchangeConfig] Transaction logs:', (err as { logs: string[] }).logs);
      }
      throw err;
    } finally {
      setTxPending(false);
    }
  }, [publicKey, signTransaction, config, connection, fetchConfig]);

  const unpause = useCallback(async () => {
    if (!publicKey || !signTransaction || !config) {
      throw new Error('Wallet not connected');
    }

    if (publicKey.toBase58() !== config.authority) {
      throw new Error('Connected wallet is not the admin authority');
    }

    setTxPending(true);
    try {
      const [exchangePda] = deriveExchangePda();

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: exchangePda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: false },
        ],
        programId: CONFIDEX_PROGRAM_ID,
        data: Buffer.from(UNPAUSE_DISCRIMINATOR),
      });

      const transaction = new Transaction().add(instruction);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      await fetchConfig();
      return signature;
    } catch (err) {
      // Log full error details for debugging
      console.error('[useExchangeConfig] unpause() failed:', err);
      if (err && typeof err === 'object' && 'logs' in err) {
        console.error('[useExchangeConfig] Transaction logs:', (err as { logs: string[] }).logs);
      }
      throw err;
    } finally {
      setTxPending(false);
    }
  }, [publicKey, signTransaction, config, connection, fetchConfig]);

  return {
    config,
    isLoading,
    error,
    refetch: fetchConfig,
    isAdmin,
    txPending,
    pause,
    unpause,
  };
}
