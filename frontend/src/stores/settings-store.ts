import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SettlementMethod } from '@/lib/settlement';

/**
 * Preferred encryption provider for runtime switching
 * - 'auto': System selects best available (Arcium prod > Inco > Arcium demo)
 * - 'arcium': Force Arcium MPC (falls back if unavailable and autoFallback enabled)
 * - 'inco': Force Inco TEE (falls back if unavailable and autoFallback enabled)
 */
export type PreferredEncryptionProvider = 'auto' | 'arcium' | 'inco';

interface SettingsState {
  // Trading settings
  slippage: string;
  autoWrap: boolean;
  confirmTx: boolean;

  // Privacy settings
  privacyMode: boolean;

  // Notification settings
  notifications: boolean;

  // Settlement settings
  settlementMethod: SettlementMethod;
  showSettlementFees: boolean;

  // Encryption provider settings (runtime-switchable)
  preferredEncryptionProvider: PreferredEncryptionProvider;
  arciumEnabled: boolean;
  incoEnabled: boolean;
  autoFallbackEnabled: boolean;

  // Actions
  setSlippage: (slippage: string) => void;
  setAutoWrap: (autoWrap: boolean) => void;
  setConfirmTx: (confirmTx: boolean) => void;
  setPrivacyMode: (privacyMode: boolean) => void;
  setNotifications: (notifications: boolean) => void;
  setSettlementMethod: (method: SettlementMethod) => void;
  setShowSettlementFees: (show: boolean) => void;
  setPreferredEncryptionProvider: (provider: PreferredEncryptionProvider) => void;
  setArciumEnabled: (enabled: boolean) => void;
  setIncoEnabled: (enabled: boolean) => void;
  setAutoFallbackEnabled: (enabled: boolean) => void;
}

// Store version for migrations
// v2: Added settlement settings
// v3: Added encryption provider settings
const STORE_VERSION = 3;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      slippage: '0.5',
      autoWrap: true,
      confirmTx: true,
      privacyMode: true,
      notifications: true,

      // Settlement defaults
      settlementMethod: 'auto',
      showSettlementFees: true,

      // Encryption provider defaults
      preferredEncryptionProvider: 'auto',
      arciumEnabled: true,
      incoEnabled: true,
      autoFallbackEnabled: true,

      // Setters
      setSlippage: (slippage) => set({ slippage }),
      setAutoWrap: (autoWrap) => set({ autoWrap }),
      setConfirmTx: (confirmTx) => set({ confirmTx }),
      setPrivacyMode: (privacyMode) => set({ privacyMode }),
      setNotifications: (notifications) => set({ notifications }),
      setSettlementMethod: (settlementMethod) => set({ settlementMethod }),
      setShowSettlementFees: (showSettlementFees) => set({ showSettlementFees }),
      setPreferredEncryptionProvider: (preferredEncryptionProvider) =>
        set({ preferredEncryptionProvider }),
      setArciumEnabled: (arciumEnabled) => set({ arciumEnabled }),
      setIncoEnabled: (incoEnabled) => set({ incoEnabled }),
      setAutoFallbackEnabled: (autoFallbackEnabled) => set({ autoFallbackEnabled }),
    }),
    {
      name: 'confidex-settings',
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        const state = persisted as SettingsState;

        // Migration from version 1 to 2: add settlement settings
        if (version < 2) {
          return {
            ...state,
            settlementMethod: 'auto' as SettlementMethod,
            showSettlementFees: true,
            // Also add v3 fields for users upgrading from v1
            preferredEncryptionProvider: 'auto' as PreferredEncryptionProvider,
            arciumEnabled: true,
            incoEnabled: true,
            autoFallbackEnabled: true,
          };
        }

        // Migration from version 2 to 3: add encryption provider settings
        if (version < 3) {
          return {
            ...state,
            preferredEncryptionProvider: 'auto' as PreferredEncryptionProvider,
            arciumEnabled: true,
            incoEnabled: true,
            autoFallbackEnabled: true,
          };
        }

        return state;
      },
    }
  )
);
