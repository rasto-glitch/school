import { create } from 'zustand';

interface NotificationState {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  pendingAppointmentCount: number;
  setPendingAppointmentCount: (count: number) => void;
  incrementPendingAppointmentCount: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  pendingAppointmentCount: 0,
  setPendingAppointmentCount: (pendingAppointmentCount) => set({ pendingAppointmentCount }),
  incrementPendingAppointmentCount: () => set({ pendingAppointmentCount: get().pendingAppointmentCount + 1 }),
}));
