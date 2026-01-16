import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  getEffectiveTheme: () => 'dark' | 'light';
}

/**
 * Get the system's preferred color scheme
 */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply theme to the document
 */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
  const root = document.documentElement;

  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      getEffectiveTheme: () => {
        const { theme } = get();
        return theme === 'system' ? getSystemTheme() : theme;
      },
    }),
    {
      name: 'confidex-theme',
      onRehydrateStorage: () => (state) => {
        // Apply theme on rehydration (page load)
        if (state) {
          applyTheme(state.theme);
        }
      },
    }
  )
);

// Listen for system theme changes when using 'system' preference
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useThemeStore.getState();
    if (theme === 'system') {
      applyTheme('system');
    }
  });
}
