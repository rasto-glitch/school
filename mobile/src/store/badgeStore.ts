import { create } from 'zustand';

interface BadgeState {
  unreadCount: number;
  reportCount: number;
  bookingCount: number;
  setUnreadCount: (count: number) => void;
  setReportCount: (count: number) => void;
  setBookingCount: (count: number) => void;
  clearReport: () => void;
  clearBooking: () => void;
}

export const useBadgeStore = create<BadgeState>((set) => ({
  unreadCount: 0,
  reportCount: 0,
  bookingCount: 0,
  setUnreadCount: (count) => set({ unreadCount: count }),
  setReportCount: (count) => set({ reportCount: count }),
  setBookingCount: (count) => set({ bookingCount: count }),
  clearReport: () => set({ reportCount: 0 }),
  clearBooking: () => set({ bookingCount: 0 }),
}));
