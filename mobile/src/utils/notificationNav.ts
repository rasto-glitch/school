import { navigationRef } from '../navigation';
import { parentApi, supervisorApi, chatApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { Role } from '../types';

export interface NotifDispatch {
  type?: string;
  relatedId?: string;
  conversationId?: string;
}

const TYPE_META: Record<string, { emoji: string }> = {
  chat: { emoji: '💬' },
  homework: { emoji: '📚' },
  assignment: { emoji: '📝' },
  announcement: { emoji: '📢' },
  report: { emoji: '📊' },
  appointment: { emoji: '📅' },
  grade: { emoji: '💯' },
  post: { emoji: '📰' },
  bus: { emoji: '🚌' },
  payment_recorded: { emoji: '💵' },
  fees_reminder: { emoji: '💵' },
  salary_due_soon: { emoji: '💰' },
  salary_paid: { emoji: '💰' },
  system: { emoji: '⚙️' },
  general: { emoji: '🔔' },
};

export function getNotifEmoji(type?: string): string {
  if (!type) return '🔔';
  return TYPE_META[type]?.emoji ?? '🔔';
}

function tabScreenForRole(role?: Role): string {
  if (role === 'supervisor') return 'SupervisorTabs';
  if (role === 'teacher') return 'TeacherTabs';
  if (role === 'driver') return 'DriverTabs';
  return 'ParentTabs';
}

export async function openNotificationTarget(d: NotifDispatch): Promise<void> {
  if (!navigationRef.isReady()) return;
  const role = useAuthStore.getState().user?.role;
  const tab = tabScreenForRole(role);

  const goTab = (screen: string) => {
    try { (navigationRef as any).navigate(tab, { screen }); } catch {}
  };

  try {
    if (d.type === 'chat') {
      const id = d.conversationId || d.relatedId;
      if (id) {
        try {
          const res = await chatApi.getConversations();
          const match = (res.data || []).find((c: any) => c.id === id);
          if (match) { (navigationRef as any).navigate('Chat', { conversation: match }); return; }
        } catch {}
      }
      goTab('ChatList');
      return;
    }

    if (role === 'supervisor') {
      switch (d.type) {
        case 'homework': {
          if (!d.relatedId) break;
          const res = await supervisorApi.getHomeworkById(d.relatedId);
          (navigationRef as any).navigate('HomeworkDetail', { homework: res.data });
          return;
        }
        case 'assignment': {
          if (!d.relatedId) break;
          const res = await supervisorApi.getAssignmentById(d.relatedId);
          (navigationRef as any).navigate('AssignmentDetail', { assignment: res.data });
          return;
        }
        case 'announcement': {
          if (!d.relatedId) break;
          const res = await supervisorApi.getAnnouncementById(d.relatedId);
          (navigationRef as any).navigate('AnnouncementDetail', { announcement: res.data });
          return;
        }
      }
      try { (navigationRef as any).navigate('SupervisorNotifications'); } catch {}
      return;
    }

    if (role !== 'parent') {
      if (role === 'teacher' && (d.type === 'salary_due_soon' || d.type === 'salary_paid')) {
        (navigationRef as any).navigate('TeacherSalary');
        return;
      }
      if (role === 'teacher' && d.type === 'announcement' && d.relatedId) {
        (navigationRef as any).navigate('AnnouncementDetail', { announcementId: d.relatedId });
        return;
      }
      if (role === 'teacher' && d.type === 'post' && d.relatedId) {
        (navigationRef as any).navigate('PostDetail', { postId: d.relatedId });
        return;
      }
      const notifScreen = role === 'teacher' ? 'TeacherNotifications' : 'Notifications';
      try { (navigationRef as any).navigate(notifScreen); } catch { goTab('Feed'); }
      return;
    }

    switch (d.type) {
      case 'homework': {
        if (!d.relatedId) return goTab('Feed');
        const res = await parentApi.getHomeworkById(d.relatedId);
        (navigationRef as any).navigate('HomeworkDetail', { homework: res.data });
        return;
      }
      case 'assignment': {
        if (!d.relatedId) return goTab('Feed');
        const res = await parentApi.getAssignmentById(d.relatedId);
        (navigationRef as any).navigate('AssignmentDetail', { assignment: res.data });
        return;
      }
      case 'announcement': {
        if (!d.relatedId) return goTab('Feed');
        const res = await parentApi.getAnnouncementById(d.relatedId);
        (navigationRef as any).navigate('AnnouncementDetail', { announcement: res.data });
        return;
      }
      case 'report': {
        if (!d.relatedId) return (navigationRef as any).navigate('Reports');
        const res = await parentApi.getReportById(d.relatedId);
        (navigationRef as any).navigate('ReportDetail', { report: res.data });
        return;
      }
      case 'appointment':
        (navigationRef as any).navigate('Appointments');
        return;
      case 'grade':
        (navigationRef as any).navigate('Grades');
        return;
      case 'post':
        if (!d.relatedId) return goTab('Learn');
        (navigationRef as any).navigate('PostDetail', { postId: d.relatedId });
        return;
      case 'bus':
        goTab('BusTracking');
        return;
      case 'payment_recorded':
      case 'fees_reminder':
        (navigationRef as any).navigate('Tuition');
        return;
      default:
        (navigationRef as any).navigate('Notifications');
        return;
    }
  } catch {
    (navigationRef as any).navigate('Notifications');
  }
}
