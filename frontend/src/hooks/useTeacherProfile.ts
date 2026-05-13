import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

type SubjectOpt = { id: string; name: string };

interface TeacherProfile {
  id: string;
  subject: string | null;
  subjects: SubjectOpt[];
  teaching: { classId: string; subjects: SubjectOpt[] }[];
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
          subject: data.subject || null,
          subjects: Array.isArray(data.subjects) ? data.subjects : [],
          teaching: Array.isArray(data.teaching) ? data.teaching : [],
          fullName: data.fullName || data.full_name || '',
          teacherClasses: data.teacherClasses || [],
        });
      })
      .catch(() => {
        // Silent fail — teacher might not have a record yet
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  // Subjects this teacher teaches in a given class. Falls back to all their subjects when the
  // class has no curriculum rows yet (matches the lenient server-side check).
  const subjectsForClass = useCallback((classId: string | undefined | null): SubjectOpt[] => {
    if (!profile) return [];
    if (classId) {
      const entry = profile.teaching.find(t => t.classId === classId);
      if (entry && entry.subjects.length) return entry.subjects;
    }
    return profile.subjects;
  }, [profile]);

  return {
    profile,
    subject: profile?.subject || '',
    subjects: profile?.subjects || [],
    teaching: profile?.teaching || [],
    subjectsForClass,
    loading,
  };
}
