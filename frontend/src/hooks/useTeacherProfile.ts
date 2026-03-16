import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

interface TeacherProfile {
  id: string;
  subject: string | null;
  fullName: string;
  teacherClasses: { classId: string; classes: { name: string } }[];
}

export function useTeacherProfile() {
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    api.get('/teacher/profile-data')
      .then(r => {
        const data = r.data;
        setProfile({
          id: data.id,
          // Backend now merges subjects-table assignment + teachers.subject field
          subject: data.subject || null,
          fullName: data.fullName || data.full_name || '',
          teacherClasses: data.teacherClasses || [],
        });
      })
      .catch(() => {
        // Silent fail — teacher might not have a record yet
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  return { profile, subject: profile?.subject || '', loading };
}
