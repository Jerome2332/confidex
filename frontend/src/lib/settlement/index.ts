/**
 * Settlement Layer Module
 *
 * Provides a unified interface for settlement providers
 * (ShadowWire, C-SPL, etc.)
 */

// Types
export type {
  SettlementMethod,
  SettlementToken,
  TransferType,
  PrivacyLevel,
  SettlementCapabilities,
  SettlementTransferParams,
  SettlementTransferResult,
  SettlementBalance,
  ISettlementProvider,
  SettlementConfig,
  SettlementStateChange,
} from './types';

// Manager
export { settlementManager } from './settlement-manager';

// Providers (for direct access if needed)
export { shadowWireProvider } from './providers/shadowwire-provider';
export { csplProvider, isCSPLAvailable } from './providers/cspl-provider';
