/**
 * Admin Store
 *
 * Zustand store for admin session state.
 * Persists API key to localStorage for convenience.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminState {
  apiKey: string;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      apiKey: '',
      setApiKey: (key: string) => set({ apiKey: key }),
      clearApiKey: () => set({ apiKey: '' }),
    }),
    {
      name: 'confidex-admin',
    }
  )
);
