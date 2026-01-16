import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SettlementMethod } from '@/lib/settlement';

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

  // Actions
  setSlippage: (slippage: string) => void;
  setAutoWrap: (autoWrap: boolean) => void;
  setConfirmTx: (confirmTx: boolean) => void;
  setPrivacyMode: (privacyMode: boolean) => void;
  setNotifications: (notifications: boolean) => void;
  setSettlementMethod: (method: SettlementMethod) => void;
  setShowSettlementFees: (show: boolean) => void;
}

// Store version for migrations
const STORE_VERSION = 2;

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

      // Setters
      setSlippage: (slippage) => set({ slippage }),
      setAutoWrap: (autoWrap) => set({ autoWrap }),
      setConfirmTx: (confirmTx) => set({ confirmTx }),
      setPrivacyMode: (privacyMode) => set({ privacyMode }),
      setNotifications: (notifications) => set({ notifications }),
      setSettlementMethod: (settlementMethod) => set({ settlementMethod }),
      setShowSettlementFees: (showSettlementFees) => set({ showSettlementFees }),
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
          };
        }

        return state;
      },
    }
  )
);
