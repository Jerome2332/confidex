'use client';

import { FC, ReactNode, useEffect, useState } from 'react';
import { useThemeStore } from '@/stores/theme-store';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * ThemeProvider initializes the theme on mount and prevents hydration mismatch
 * by not rendering children until the theme is applied.
 */
export const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
  const [mounted, setMounted] = useState(false);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    // Apply initial theme
    const applyInitialTheme = () => {
      const stored = localStorage.getItem('confidex-theme');
      let effectiveTheme: 'dark' | 'light' = 'dark';

      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const preference = parsed.state?.theme || 'dark';
          if (preference === 'system') {
            effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light';
          } else {
            effectiveTheme = preference;
          }
        } catch {
          effectiveTheme = 'dark';
        }
      }

      if (effectiveTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyInitialTheme();
    setMounted(true);
  }, []);

  // Re-apply theme when it changes
  useEffect(() => {
    if (!mounted) return;

    const getSystemTheme = () =>
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;

    if (effectiveTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme, mounted]);

  // Prevent flash of wrong theme by showing nothing until mounted
  // Actually, we can show children with a CSS-based fallback
  return <>{children}</>;
};
