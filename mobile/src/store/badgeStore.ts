import { create } from 'zustand';

interface BadgeState {
  unreadCount: number;
  reportCount: number;
  bookingCount: number;
  homeworkCount: number;
  assignmentCount: number;
  postCount: number;
  gradeCount: number;
  setUnreadCount: (count: number) => void;
  setReportCount: (count: number) => void;
  setBookingCount: (count: number) => void;
  setHomeworkCount: (count: number) => void;
  setAssignmentCount: (count: number) => void;
  setPostCount: (count: number) => void;
  setGradeCount: (count: number) => void;
  clearReport: () => void;
  clearBooking: () => void;
  clearHomework: () => void;
  clearAssignment: () => void;
  clearPost: () => void;
  clearGrade: () => void;
}

export const useBadgeStore = create<BadgeState>((set) => ({
  unreadCount: 0,
  reportCount: 0,
  bookingCount: 0,
  homeworkCount: 0,
  assignmentCount: 0,
  postCount: 0,
  gradeCount: 0,
  setUnreadCount: (count) => set({ unreadCount: count }),
  setReportCount: (count) => set({ reportCount: count }),
  setBookingCount: (count) => set({ bookingCount: count }),
  setHomeworkCount: (count) => set({ homeworkCount: count }),
  setAssignmentCount: (count) => set({ assignmentCount: count }),
  setPostCount: (count) => set({ postCount: count }),
  setGradeCount: (count) => set({ gradeCount: count }),
  clearReport: () => set({ reportCount: 0 }),
  clearBooking: () => set({ bookingCount: 0 }),
  clearHomework: () => set({ homeworkCount: 0 }),
  clearAssignment: () => set({ assignmentCount: 0 }),
  clearPost: () => set({ postCount: 0 }),
  clearGrade: () => set({ gradeCount: 0 }),
}));
