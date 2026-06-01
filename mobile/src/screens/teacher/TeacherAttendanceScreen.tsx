import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, Save, Lock } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string }
interface StudentItem { id: string; fullName: string }
type AttStatus = 'present' | 'absent' | 'late';

const STATUS_COLORS: Record<AttStatus, string> = {
  present: '#10B981',
  absent: '#EF4444',
  late: '#F59E0B',
};

function todayInTz(tz: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'Asia/Baghdad',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export default function TeacherAttendanceScreen() {
  const { t } = useTranslation();
  const calDays = t('teacher.weekday_short', { returnObjects: true }) as string[];
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const tz = useAuthStore(s => s.school?.timezone);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => todayInTz(tz));
  const [showCal, setShowCal] = useState(false);
  const [calViewDate, setCalViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const [students, setStudents] = useState<StudentItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AttStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    teacherApi.getClasses().then(r => {
      const list: ClassItem[] = r.data || [];
      setClasses(list);
      if (list.length > 0) setSelectedClass(list[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass.id })
      .then(r => setStudents(r.data || []))
      .catch(() => setStudents([]));
  }, [selectedClass]);

  const loadAttendance = useCallback(() => {
    if (!selectedClass) return;
    setLoading(true);
    teacherApi.getAttendance(selectedClass.id, selectedDate).then(r => {
      const records: any[] = r.data || [];
      const st: Record<string, AttStatus> = {};
      const nt: Record<string, string> = {};
      records.forEach((rec: any) => {
        if (rec.studentId) {
          st[rec.studentId] = rec.status;
          if (rec.notes) nt[rec.studentId] = rec.notes;
        }
      });
      setStatuses(st);
      setNotes(nt);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [selectedClass, selectedDate]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  const setAllStatus = (s: AttStatus) => {
    const next: Record<string, AttStatus> = {};
    students.forEach(st => { next[st.id] = s; });
    setStatuses(next);
  };

  const setStudentStatus = (studentId: string, status: AttStatus) => {
    setStatuses(prev => ({ ...prev, [studentId]: status }));
  };

  const handleSave = async () => {
    if (!selectedClass) return;
    setSaving(true);
    try {
      const records = students.map(s => ({
        studentId: s.id,
        status: statuses[s.id] ?? 'present',
        notes: notes[s.id] || undefined,
      }));
      await teacherApi.markAttendance({ classId: selectedClass.id, date: selectedDate, records });
      Alert.alert(t('teacher.saved'), t('teacher.attendance_saved'));
    } catch {
      Alert.alert(t('common.error'), t('teacher.attendance_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  // Calendar helpers
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calCells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calMonthLabel = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  const present = students.filter(s => (statuses[s.id] ?? 'present') === 'present').length;
  const absent = students.filter(s => statuses[s.id] === 'absent').length;
  const late = students.filter(s => statuses[s.id] === 'late').length;

  // Past days are locked at midnight in the school's TZ (backend enforces).
  const today = todayInTz(tz);
  const locked = selectedDate < today;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>{t('nav.attendance')}</Text>

      {/* Class selector */}
      <Text style={styles.sectionLabel}>{t('teacher.class')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {classes.map(c => (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, selectedClass?.id === c.id && styles.chipActive]}
            onPress={() => setSelectedClass(c)}
          >
            <Text style={[styles.chipText, selectedClass?.id === c.id && styles.chipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Date picker */}
      <Text style={styles.sectionLabel}>{t('teacher.date')}</Text>
      <TouchableOpacity style={styles.dateBtn} onPress={() => setShowCal(v => !v)} activeOpacity={0.7}>
        <Text style={styles.dateBtnText}>{displayDate}</Text>
        <ChevronRight size={14} color={colors.textMuted} style={{ transform: [{ rotate: showCal ? '90deg' : '0deg' }] }} />
      </TouchableOpacity>

      {showCal && (
        <View style={styles.calendar}>
          <View style={styles.calHeader}>
            <TouchableOpacity onPress={() => setCalViewDate(new Date(year, month - 1, 1))} style={styles.calNav}>
              <ChevronLeft size={16} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.calMonth}>{calMonthLabel}</Text>
            <TouchableOpacity onPress={() => setCalViewDate(new Date(year, month + 1, 1))} style={styles.calNav}>
              <ChevronRight size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.calDayRow}>
            {calDays.map((d, di) => (
              <Text key={di} style={styles.calDayLabel}>{d}</Text>
            ))}
          </View>
          {Array.from({ length: calCells.length / 7 }, (_, row) => (
            <View key={row} style={styles.calWeekRow}>
              {calCells.slice(row * 7, row * 7 + 7).map((day, col) => {
                if (!day) return <View key={col} style={styles.calCell} />;
                const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const selected = selectedDate === iso;
                const future = new Date(iso) > new Date();
                return (
                  <TouchableOpacity
                    key={col}
                    style={[styles.calCell, selected && styles.calCellSelected, future && styles.calCellFuture]}
                    onPress={() => { if (!future) { setSelectedDate(iso); setShowCal(false); } }}
                    disabled={future}
                  >
                    <Text style={[styles.calDayNum, selected && styles.calDayNumSelected, future && { color: colors.textMuted }]}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {/* Stats */}
      {students.length > 0 && (
        <View style={styles.statsRow}>
          <View style={[styles.statPill, { backgroundColor: colors.successLight }]}>
            <Text style={[styles.statText, { color: colors.success }]}>{t('teacher.n_present', { count: present })}</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: colors.dangerLight }]}>
            <Text style={[styles.statText, { color: colors.danger }]}>{t('teacher.n_absent', { count: absent })}</Text>
          </View>
          {late > 0 && (
            <View style={[styles.statPill, { backgroundColor: colors.warningLight }]}>
              <Text style={[styles.statText, { color: colors.warning }]}>{t('teacher.n_late', { count: late })}</Text>
            </View>
          )}
        </View>
      )}

      {/* Mark all buttons */}
      {students.length > 0 && !locked && (
        <View style={styles.markAllRow}>
          <TouchableOpacity style={[styles.markAllBtn, { borderColor: colors.success }]} onPress={() => setAllStatus('present')}>
            <CheckCircle size={14} color={colors.success} />
            <Text style={[styles.markAllText, { color: colors.success }]}>{t('teacher.all_present')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.markAllBtn, { borderColor: colors.danger }]} onPress={() => setAllStatus('absent')}>
            <XCircle size={14} color={colors.danger} />
            <Text style={[styles.markAllText, { color: colors.danger }]}>{t('teacher.all_absent')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Locked banner — shown in place of save and edit controls */}
      {locked && students.length > 0 && (
        <View style={styles.lockedBanner}>
          <Lock size={14} color={colors.textMuted} />
          <Text style={styles.lockedBannerText}>{t('teacher.attendance_locked_hint', 'This day is locked. Ask a supervisor to make any changes.')}</Text>
        </View>
      )}

      {/* Student list */}
      <Text style={styles.sectionLabel}>{t('nav.students')}</Text>
      {loading ? (
        <CardListSkeleton count={5} />
      ) : students.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t('teacher.no_students_in_class')}</Text>
        </View>
      ) : (
        students.map(student => {
          const status: AttStatus = statuses[student.id] ?? 'present';
          return (
            <View key={student.id} style={styles.studentCard}>
              <Text style={styles.studentName}>{student.fullName}</Text>
              <View style={styles.statusBtns}>
                {(['present', 'absent', 'late'] as AttStatus[]).map(s => {
                  const active = status === s;
                  const color = STATUS_COLORS[s];
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.statusBtn,
                        { borderColor: color },
                        active && { backgroundColor: color },
                        locked && { opacity: 0.6 },
                      ]}
                      onPress={() => !locked && setStudentStatus(student.id, s)}
                      disabled={locked}
                    >
                      <Text style={[styles.statusBtnText, active && { color: '#fff' }]}>
                        {t(`teacher.att_${s}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })
      )}

      {/* Save button */}
      {students.length > 0 && !locked && (
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Save size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{t('teacher.save_attendance')}</Text>
              </>
          }
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  chip: {
    borderWidth: 1.5,
    borderColor: isDark ? '#FFFFFF' : colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm,
    backgroundColor: isDark ? 'transparent' : colors.card,
  },
  chipActive: {
    borderColor: isDark ? '#FFFFFF' : colors.primary,
    backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight,
  },
  chipText: { fontSize: font.sm, color: isDark ? '#FFFFFF' : colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: isDark ? '#000000' : colors.primary, fontWeight: '700' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  dateBtnText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  calendar: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.md },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  calNav: { padding: 6 },
  calMonth: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  calDayRow: { flexDirection: 'row', marginBottom: 4 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  calWeekRow: { flexDirection: 'row' },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  calCellSelected: { backgroundColor: colors.primary },
  calCellFuture: { opacity: 0.3 },
  calDayNum: { fontSize: font.sm, color: colors.text },
  calDayNumSelected: { color: '#fff', fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  statPill: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  statText: { fontSize: font.xs, fontWeight: '700' },
  markAllRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  markAllBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: 10 },
  markAllText: { fontSize: font.sm, fontWeight: '700' },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', ...shadow.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted },
  studentCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  studentName: { fontSize: font.sm, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  statusBtns: { flexDirection: 'row', gap: spacing.sm },
  statusBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  statusBtnText: { fontSize: font.xs, fontWeight: '700', color: colors.text },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  lockedBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  lockedBannerText: { flex: 1, fontSize: font.xs, color: colors.textMuted, fontWeight: '600' },
});
