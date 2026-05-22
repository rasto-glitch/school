import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert, Modal, TextInput,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, Edit2, CalendarOff } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string; gradeLevel?: string }

interface StudentItem { id: string; fullName: string }

interface AttendanceRecord {
  id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  notes?: string;
  students?: { id: string; fullName: string };
  teachers?: { fullName: string };
}

type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: '#10B981',
  absent: '#EF4444',
  late: '#F59E0B',
  excused: '#8B5CF6',
};
const STATUS_ICON: Record<AttendanceStatus, any> = {
  present: CheckCircle,
  absent: XCircle,
  late: Clock,
  excused: CalendarOff,
};

export default function SupervisorAttendanceScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const calDays = t('teacher.weekday_short', { returnObjects: true }) as string[];
  const attLabel = (s: AttendanceStatus) => s === 'excused' ? t('supervisor.excused') : t(`common.${s}`);
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [calViewDate, setCalViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [showCal, setShowCal] = useState(false);

  const [allStudents, setAllStudents] = useState<StudentItem[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state — works for both create and update
  const [modalStudent, setModalStudent] = useState<StudentItem | null>(null);
  const [modalRecord, setModalRecord] = useState<AttendanceRecord | null>(null); // null = create mode
  const [newStatus, setNewStatus] = useState<AttendanceStatus>('absent');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supervisorApi.getClasses().then(r => {
      const list: ClassItem[] = r.data || [];
      setClasses(list);
      if (list.length > 0) setSelectedClass(list[0]);
    }).catch(() => {});
  }, []);

  // Fetch students when class changes
  useEffect(() => {
    if (!selectedClass) return;
    supervisorApi.getStudentsByClass(selectedClass.id)
      .then(r => setAllStudents(r.data || []))
      .catch(() => setAllStudents([]));
  }, [selectedClass]);

  // Fetch attendance records when class+date changes
  const fetchAttendance = useCallback(() => {
    if (!selectedClass) return;
    setLoading(true);
    supervisorApi.getAttendance(selectedClass.id, selectedDate)
      .then(r => setRecords(r.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [selectedClass, selectedDate]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  const openModal = (student: StudentItem, record?: AttendanceRecord) => {
    setModalStudent(student);
    setModalRecord(record ?? null);
    setNewStatus(record?.status ?? 'absent');
    setNewNotes(record?.notes ?? '');
  };

  const handleSave = async () => {
    if (!modalStudent || !selectedClass) return;
    if (newStatus === 'excused' && !newNotes.trim()) {
      Alert.alert(t('supervisor.reason_required_title'), t('supervisor.reason_required_body'));
      return;
    }
    setSaving(true);
    try {
      if (modalRecord) {
        await supervisorApi.updateAttendance(modalRecord.id, newStatus, newNotes.trim() || undefined);
      } else {
        await supervisorApi.createAttendance(modalStudent.id, selectedClass.id, selectedDate, newStatus, newNotes.trim() || undefined);
      }
      setModalStudent(null);
      setModalRecord(null);
      fetchAttendance();
    } catch {
      Alert.alert(t('common.error'), t('supervisor.attendance_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const late = records.filter(r => r.status === 'late').length;
  const excused = records.filter(r => r.status === 'excused').length;

  // Calendar helpers
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calCells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calMonthLabel = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  // Merge students with their records
  const studentRows = allStudents.map(s => ({
    student: s,
    record: records.find(r => r.students?.id === s.id),
  }));

  const recordedCount = studentRows.filter(r => r.record).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>{t('nav.attendance', 'Attendance')}</Text>

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
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.calDayNum, selected && styles.calDayNumSelected, future && styles.calDayNumFuture]}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {/* Stats */}
      {records.length > 0 && (
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
          {excused > 0 && (
            <View style={[styles.statPill, { backgroundColor: '#F3E8FF' }]}>
              <Text style={[styles.statText, { color: '#8B5CF6' }]}>{t('supervisor.n_excused', { count: excused })}</Text>
            </View>
          )}
        </View>
      )}

      {/* Records */}
      <View style={styles.recordsHeader}>
        <Text style={styles.sectionLabel}>{t('nav.students')}</Text>
        {allStudents.length > 0 && (
          <Text style={styles.recordedCount}>{t('supervisor.n_recorded', { recorded: recordedCount, total: allStudents.length })}</Text>
        )}
      </View>

      {loading ? (
        <CardListSkeleton count={5} />
      ) : allStudents.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t('teacher.no_students_in_class')}</Text>
        </View>
      ) : (
        studentRows.map(({ student, record }) => {
          // No record = implicitly present
          const displayStatus: AttendanceStatus = record?.status ?? 'present';
          const Icon = STATUS_ICON[displayStatus] ?? CheckCircle;
          const color = STATUS_COLOR[displayStatus];
          return (
            <View key={student.id} style={styles.recordCard}>
              <Icon size={18} color={color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.recordName}>{student.fullName}</Text>
                {record?.notes && <Text style={styles.recordNote}>{record.notes}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
                <Text style={[styles.statusBadgeText, { color }]}>
                  {attLabel(displayStatus)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => openModal(student, record)}
                style={styles.editBtn}
              >
                <Edit2 size={14} color={colors.primary} />
              </TouchableOpacity>
            </View>
          );
        })
      )}

      {/* Attendance Modal */}
      <Modal visible={!!modalStudent} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card, paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.modalTitle}>
              {modalRecord ? t('supervisor.override_attendance') : t('supervisor.mark_attendance')}
            </Text>
            <Text style={styles.modalSubtitle}>{modalStudent?.fullName}</Text>

            <View style={styles.statusRow}>
              {(['present', 'absent', 'late', 'excused'] as AttendanceStatus[]).map(s => {
                const col = STATUS_COLOR[s];
                const selected = newStatus === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusOption, { borderColor: selected ? col : colors.border, backgroundColor: selected ? col + '20' : colors.bg }]}
                    onPress={() => setNewStatus(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.statusOptionText, { color: selected ? col : colors.textMuted }]}>
                      {attLabel(s)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.notesLabel}>
              {newStatus === 'excused' ? t('supervisor.reason_required_label') : t('supervisor.notes_optional')}
            </Text>
            <TextInput
              style={[styles.notesInput, newStatus === 'excused' && styles.notesInputRequired]}
              placeholder={newStatus === 'excused' ? t('supervisor.reason_ph') : t('supervisor.notes_ph')}
              placeholderTextColor={colors.textMuted}
              value={newNotes}
              onChangeText={setNewNotes}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>{t('common.save')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalStudent(null)}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  calDayNumFuture: { color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  statPill: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  statText: { fontSize: font.xs, fontWeight: '700' },
  recordsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  recordedCount: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600', marginBottom: spacing.sm },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', ...shadow.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },
  recordCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  recordName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  recordNote: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  statusBadge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  editBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  modalTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.md },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statusOption: { flex: 1, minWidth: '40%', paddingVertical: 12, borderRadius: radius.md, borderWidth: 2, alignItems: 'center' },
  statusOptionText: { fontSize: font.sm, fontWeight: '700' },
  notesLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  notesInput: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, fontSize: font.sm, color: colors.text, borderWidth: 1, borderColor: colors.border, minHeight: 72, textAlignVertical: 'top', marginBottom: spacing.md },
  notesInputRequired: { borderColor: '#8B5CF6' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  cancelBtn: { padding: spacing.sm, alignItems: 'center' },
  cancelBtnText: { fontSize: font.sm, color: colors.textMuted },
});
