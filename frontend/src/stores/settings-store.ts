import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  // Trading settings
  slippage: string;
  autoWrap: boolean;
  confirmTx: boolean;

  // Privacy settings
  privacyMode: boolean;

  // Notification settings
  notifications: boolean;

  // Actions
  setSlippage: (slippage: string) => void;
  setAutoWrap: (autoWrap: boolean) => void;
  setConfirmTx: (confirmTx: boolean) => void;
  setPrivacyMode: (privacyMode: boolean) => void;
  setNotifications: (notifications: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      slippage: '0.5',
      autoWrap: true,
      confirmTx: true,
      privacyMode: true,
      notifications: true,

      // Setters
      setSlippage: (slippage) => set({ slippage }),
      setAutoWrap: (autoWrap) => set({ autoWrap }),
      setConfirmTx: (confirmTx) => set({ confirmTx }),
      setPrivacyMode: (privacyMode) => set({ privacyMode }),
      setNotifications: (notifications) => set({ notifications }),
    }),
    {
      name: 'confidex-settings',
    }
  )
);
