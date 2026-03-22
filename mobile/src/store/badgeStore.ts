import { create } from 'zustand';

interface BadgeState {
  reportCount: number;
  setReportCount: (count: number) => void;
  clearReport: () => void;
}

export const useBadgeStore = create<BadgeState>((set) => ({
  reportCount: 0,
  setReportCount: (count) => set({ reportCount: count }),
  clearReport: () => set({ reportCount: 0 }),
}));
