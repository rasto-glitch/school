import { create } from 'zustand';

interface NotificationState {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  pendingAppointmentCount: number;
  setPendingAppointmentCount: (count: number) => void;
  incrementPendingAppointmentCount: () => void;
  teacherUnreadCount: number;
  setTeacherUnreadCount: (count: number) => void;
  incrementTeacherUnreadCount: () => void;
  adminNotificationCount: number;
  setAdminNotificationCount: (count: number) => void;
  incrementAdminNotificationCount: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  pendingAppointmentCount: 0,
  setPendingAppointmentCount: (pendingAppointmentCount) => set({ pendingAppointmentCount }),
  incrementPendingAppointmentCount: () => set({ pendingAppointmentCount: get().pendingAppointmentCount + 1 }),
  teacherUnreadCount: 0,
  setTeacherUnreadCount: (teacherUnreadCount) => set({ teacherUnreadCount }),
  incrementTeacherUnreadCount: () => set({ teacherUnreadCount: get().teacherUnreadCount + 1 }),
  adminNotificationCount: 0,
  setAdminNotificationCount: (adminNotificationCount) => set({ adminNotificationCount }),
  incrementAdminNotificationCount: () => set({ adminNotificationCount: get().adminNotificationCount + 1 }),
}));
