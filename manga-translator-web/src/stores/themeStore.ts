'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setThemeCookie } from '@/lib/themeCookie';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  /** P2 A11y: High contrast mode for low-vision users (WCAG 2.1 §1.4.3) */
  highContrast: boolean;
  setMode: (mode: ThemeMode) => void;
  setHighContrast: (enabled: boolean) => void;
  applyTheme: () => void;
}

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemPreference();
  return mode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      resolved: 'light',
      highContrast: false,

      setMode: (mode: ThemeMode) => {
        set({ mode, resolved: resolveTheme(mode) });
        get().applyTheme();
      },

      setHighContrast: (enabled: boolean) => {
        set({ highContrast: enabled });
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('high-contrast', enabled);
        }
      },

      applyTheme: () => {
        const { mode, highContrast } = get();
        const resolved = resolveTheme(mode);
        set({ resolved });
        if (typeof document !== 'undefined') {
          const root = document.documentElement;
          if (resolved === 'dark') {
            root.classList.add('dark');
          } else {
            root.classList.remove('dark');
          }
          root.classList.toggle('high-contrast', highContrast);
          setThemeCookie(resolved);
        }
      },
    }),
    {
      name: 'manga-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.applyTheme();
        }
      },
    }
  )
);

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const store = useThemeStore.getState();
    if (store.mode === 'system') {
      store.applyTheme();
    }
  });
  // P2 A11y: Listen for OS-level high contrast preference
  window.matchMedia('(forced-colors: active)').addEventListener('change', (e) => {
    if (e.matches && !useThemeStore.getState().highContrast) {
      useThemeStore.getState().setHighContrast(true);
    }
  });
}
