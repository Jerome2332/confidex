/**
 * Light Protocol ZK Compression RPC Module
 *
 * Provides a compression-aware RPC connection for Light Protocol operations.
 * Uses Helius RPC which supports compression indexing out of the box.
 *
 * @see https://www.zkcompression.com
 */

import { createRpc, Rpc } from '@lightprotocol/stateless.js';
import { RPC_ENDPOINT, LIGHT_PROTOCOL_ENABLED } from './constants';

// Singleton compression RPC instance
let compressionRpc: Rpc | null = null;

/**
 * Get or create the compression-aware RPC connection.
 * Helius endpoints support Light Protocol compression indexing.
 *
 * @returns Compression-aware RPC instance
 * @throws Error if Light Protocol is not enabled
 */
export function getCompressionRpc(): Rpc {
  if (!LIGHT_PROTOCOL_ENABLED) {
    throw new Error(
      'Light Protocol is not enabled. Set NEXT_PUBLIC_LIGHT_PROTOCOL_ENABLED=true'
    );
  }

  if (!compressionRpc) {
    // createRpc takes (endpoint, compressionEndpoint, proverEndpoint)
    // For Helius, all three can be the same endpoint
    compressionRpc = createRpc(RPC_ENDPOINT, RPC_ENDPOINT);
  }

  return compressionRpc;
}

/**
 * Safely get compression RPC, returning null if not available.
 * Use this for optional compression features.
 */
export function getCompressionRpcSafe(): Rpc | null {
  if (!LIGHT_PROTOCOL_ENABLED) {
    return null;
  }

  try {
    return getCompressionRpc();
  } catch {
    return null;
  }
}

/**
 * Check if Light Protocol compression is available.
 */
export function isCompressionAvailable(): boolean {
  return LIGHT_PROTOCOL_ENABLED && getCompressionRpcSafe() !== null;
}

/**
 * Reset the compression RPC connection.
 * Useful for testing or reconnection scenarios.
 */
export function resetCompressionRpc(): void {
  compressionRpc = null;
}
