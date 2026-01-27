/**
 * ShadowWire Integration Module
 *
 * Provides backend services for ShadowWire private settlement:
 * - Relayer client for executing transfers
 * - Settlement orchestration
 * - Balance management
 */

export {
  ShadowWireRelayerClient,
  createRelayerClientFromEnv,
  SHADOWWIRE_FEE_BPS,
  SHADOWWIRE_TOKENS,
  type ShadowWireConfig,
  type ShadowWireToken,
  type TransferParams,
  type TransferResult,
  type PoolBalance,
} from './relayer-client.js';
