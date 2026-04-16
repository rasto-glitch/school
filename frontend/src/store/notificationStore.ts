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
  adminResetRequestCount: number;
  setAdminResetRequestCount: (count: number) => void;
  incrementAdminResetRequestCount: () => void;
  chatUnreadCount: number;
  setChatUnreadCount: (count: number) => void;
  incrementChatUnreadCount: () => void;
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
  adminResetRequestCount: 0,
  setAdminResetRequestCount: (adminResetRequestCount) => set({ adminResetRequestCount }),
  incrementAdminResetRequestCount: () => set({ adminResetRequestCount: get().adminResetRequestCount + 1 }),
  chatUnreadCount: 0,
  setChatUnreadCount: (chatUnreadCount) => set({ chatUnreadCount }),
  incrementChatUnreadCount: () => set({ chatUnreadCount: get().chatUnreadCount + 1 }),
}));
