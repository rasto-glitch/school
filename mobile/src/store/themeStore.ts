import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ThemeState {
  isDark: boolean;
  toggleTheme: () => void;
  setDark: (v: boolean) => void;
  reset: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      toggleTheme: () => set(s => ({ isDark: !s.isDark })),
      setDark: (v) => set({ isDark: v }),
      // Called from logout so the next person to sign in on this device
      // starts with the default (light) theme instead of inheriting the
      // previous user's preference.
      reset: () => set({ isDark: false }),
    }),
    { name: 'school-theme', storage: createJSONStorage(() => AsyncStorage) }
  )
);

export const lightColors = {
  primary: '#4F46E5',
  primaryLight: '#EEF2FF',
  primaryDark: '#3730A3',
  success: '#10B981',
  successLight: '#D1FAE5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  bg: '#F2F2F7',
  card: '#FFFFFF',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',
};

export const darkColors = {
  primary: '#6366F1',
  primaryLight: '#1E1B4B',
  primaryDark: '#4338CA',
  success: '#10B981',
  successLight: '#064E3B',
  warning: '#F59E0B',
  warningLight: '#451A03',
  danger: '#EF4444',
  dangerLight: '#450A0A',
  bg: '#0F172A',
  card: '#1E293B',
  border: '#334155',
  borderLight: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textInverse: '#0F172A',
};

export function useColors() {
  const isDark = useThemeStore(s => s.isDark);
  return isDark ? darkColors : lightColors;
}

export function useIsDark() {
  return useThemeStore(s => s.isDark);
}
