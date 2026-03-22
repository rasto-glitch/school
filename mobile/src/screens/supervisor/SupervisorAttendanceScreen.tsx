import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, Edit2 } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string; gradeLevel?: string }
interface AttendanceRecord {
  id: string;
  status: 'present' | 'absent' | 'late';
  notes?: string;
  students?: { id: string; fullName: string };
  teachers?: { fullName: string };
}

const STATUS_COLOR = { present: '#10B981', absent: '#EF4444', late: '#F59E0B' };
const STATUS_ICON = { present: CheckCircle, absent: XCircle, late: Clock };

export default function SupervisorAttendanceScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [calViewDate, setCalViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [showCal, setShowCal] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Override modal
  const [overrideRecord, setOverrideRecord] = useState<AttendanceRecord | null>(null);
  const [newStatus, setNewStatus] = useState<'present' | 'absent' | 'late'>('present');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supervisorApi.getClasses().then(r => {
      const list: ClassItem[] = r.data || [];
      setClasses(list);
      if (list.length > 0) setSelectedClass(list[0]);
    }).catch(() => {});
  }, []);

  const fetchAttendance = useCallback(() => {
    if (!selectedClass) return;
    setLoading(true);
    supervisorApi.getAttendance(selectedClass.id, selectedDate)
      .then(r => setRecords(r.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [selectedClass, selectedDate]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  const handleOverride = async () => {
    if (!overrideRecord) return;
    setSaving(true);
    try {
      await supervisorApi.updateAttendance(overrideRecord.id, newStatus);
      setOverrideRecord(null);
      fetchAttendance();
    } catch {
      Alert.alert('Error', 'Could not update attendance record.');
    } finally {
      setSaving(false);
    }
  };

  const openOverride = (r: AttendanceRecord) => {
    setNewStatus(r.status);
    setOverrideRecord(r);
  };

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const late = records.filter(r => r.status === 'late').length;

  // Calendar helpers
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calCells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calMonthLabel = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Attendance</Text>

      {/* Class selector */}
      <Text style={styles.sectionLabel}>Class</Text>
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
      <Text style={styles.sectionLabel}>Date</Text>
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
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <Text key={d} style={styles.calDayLabel}>{d}</Text>
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
                    style={[styles.calCell, selected && styles.calCellSelected, future && styles.calCellPast]}
                    onPress={() => { if (!future) { setSelectedDate(iso); setShowCal(false); } }}
                    disabled={future}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.calDayNum, selected && styles.calDayNumSelected, future && styles.calDayNumPast]}>{day}</Text>
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
            <Text style={[styles.statText, { color: colors.success }]}>{present} present</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: colors.dangerLight }]}>
            <Text style={[styles.statText, { color: colors.danger }]}>{absent} absent</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: colors.warningLight }]}>
            <Text style={[styles.statText, { color: colors.warning }]}>{late} late</Text>
          </View>
        </View>
      )}

      {/* Records */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Records</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : records.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No attendance records for this class and date.</Text>
        </View>
      ) : (
        records.map(r => {
          const Icon = STATUS_ICON[r.status] ?? Clock;
          const color = STATUS_COLOR[r.status] ?? colors.textMuted;
          return (
            <View key={r.id} style={styles.recordCard}>
              <Icon size={18} color={color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.recordName}>{r.students?.fullName ?? '—'}</Text>
                {r.notes && <Text style={styles.recordNote}>{r.notes}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
                <Text style={[styles.statusBadgeText, { color }]}>
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => openOverride(r)} style={styles.editBtn}>
                <Edit2 size={14} color={colors.primary} />
              </TouchableOpacity>
            </View>
          );
        })
      )}

      {/* Override Modal */}
      <Modal visible={!!overrideRecord} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card, paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.modalTitle}>Override Attendance</Text>
            <Text style={styles.modalSubtitle}>{overrideRecord?.students?.fullName}</Text>
            <View style={styles.statusRow}>
              {(['present', 'absent', 'late'] as const).map(s => {
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
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleOverride} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setOverrideRecord(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
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
  calCellPast: { opacity: 0.3 },
  calDayNum: { fontSize: font.sm, color: colors.text },
  calDayNumSelected: { color: '#fff', fontWeight: '700' },
  calDayNumPast: { color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  statPill: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  statText: { fontSize: font.xs, fontWeight: '700' },
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
  modalSubtitle: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statusOption: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 2, alignItems: 'center' },
  statusOptionText: { fontSize: font.sm, fontWeight: '700' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  cancelBtn: { padding: spacing.sm, alignItems: 'center' },
  cancelBtnText: { fontSize: font.sm, color: colors.textMuted },
});
