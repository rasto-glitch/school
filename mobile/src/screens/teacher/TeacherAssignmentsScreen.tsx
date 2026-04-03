import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { ClipboardList, Plus, Trash2, Paperclip, X, Send, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string }
interface StudentItem { id: string; fullName: string }
interface AssignmentItem { id: string; title: string; subject?: string; dueDate?: string; classes?: { name: string }; students?: { fullName: string }; submissionStatus?: string }

const STATUS_COLORS: Record<string, string> = { pending: '#F59E0B', submitted: '#6B7280', graded: '#10B981' };

interface Props { subject?: string; classes: ClassItem[] }

export default function TeacherAssignmentsScreen({ subject, classes }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Date picker state
  const [showCal, setShowCal] = useState(false);
  const [calViewDate, setCalViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const load = useCallback(() => {
    teacherApi.getAssignments()
      .then(r => setAssignments(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (classes.length > 0 && !classId) setClassId(classes[0].id);
  }, [classes]);

  useEffect(() => {
    if (!classId) return;
    teacherApi.getStudents({ classId }).then(r => setStudents(r.data || [])).catch(() => setStudents([]));
    setStudentId('');
  }, [classId]);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'image/*'], copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream' });
    }
  };

  const handleSubmit = async () => {
    if (!classId || !title.trim()) { Alert.alert('Required', 'Please select a class and enter a title.'); return; }
    setSubmitting(true);
    try {
      await teacherApi.createAssignment({ classId, studentId: studentId || undefined, title: title.trim(), description: description.trim() || undefined, dueDate: dueDate || undefined, subject: subject || undefined, file: file || undefined });
      setTitle(''); setDescription(''); setDueDate(''); setFile(null); setStudentId('');
      setShowForm(false);
      load();
    } catch {
      Alert.alert('Error', 'Could not create assignment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (item: AssignmentItem) => {
    Alert.alert('Delete Assignment', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeletingId(item.id);
        try { await teacherApi.deleteAssignment(item.id); setAssignments(prev => prev.filter(a => a.id !== item.id)); }
        catch { Alert.alert('Error', 'Could not delete assignment.'); }
        finally { setDeletingId(null); }
      }},
    ]);
  };

  // Calendar helpers
  const calYear = calViewDate.getFullYear();
  const calMonth = calViewDate.getMonth();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calCells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (calCells.length % 7 !== 0) calCells.push(null);
  const calMonthLabel = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const displayDueDate = dueDate
    ? new Date(dueDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)}>
        <Plus size={18} color="#fff" />
        <Text style={styles.addBtnText}>New Assignment</Text>
      </TouchableOpacity>

      {loading ? (
        <CardListSkeleton count={4} />
      ) : assignments.length === 0 ? (
        <View style={styles.empty}>
          <ClipboardList size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>No assignments posted yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 20 }}>
          {assignments.map(a => {
            const statusColor = STATUS_COLORS[a.submissionStatus || 'pending'] || colors.textMuted;
            return (
              <View key={a.id} style={styles.card}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardTitle}>{a.title}</Text>
                  <Text style={styles.cardMeta}>{[a.subject, a.classes?.name].filter(Boolean).join(' · ')}</Text>
                  {a.students && <Text style={styles.cardMeta}>→ {a.students.fullName}</Text>}
                  <View style={styles.cardFooter}>
                    {a.dueDate && <Text style={styles.dueText}>Due {new Date(a.dueDate).toLocaleDateString()}</Text>}
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{a.submissionStatus || 'pending'}</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity onPress={() => handleDelete(a)} disabled={deletingId === a.id} style={styles.deleteBtn}>
                  {deletingId === a.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={18} color={colors.danger} />}
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Assignment</Text>
            <TouchableOpacity onPress={() => setShowForm(false)}><X size={22} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Class</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {classes.map(c => (
                <TouchableOpacity key={c.id} style={[styles.chip, classId === c.id && styles.chipActive]} onPress={() => setClassId(c.id)}>
                  <Text style={[styles.chipText, classId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {students.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Student (optional — leave blank for all)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
                  <TouchableOpacity style={[styles.chip, !studentId && styles.chipActive]} onPress={() => setStudentId('')}>
                    <Text style={[styles.chipText, !studentId && styles.chipTextActive]}>All</Text>
                  </TouchableOpacity>
                  {students.map(s => (
                    <TouchableOpacity key={s.id} style={[styles.chip, studentId === s.id && styles.chipActive]} onPress={() => setStudentId(s.id)}>
                      <Text style={[styles.chipText, studentId === s.id && styles.chipTextActive]}>{s.fullName}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            {subject && (
              <>
                <Text style={styles.fieldLabel}>Subject</Text>
                <View style={styles.subjectBadge}><Text style={styles.subjectText}>{subject}</Text></View>
              </>
            )}
            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput style={styles.input} placeholder="Assignment title" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, styles.textarea]} placeholder="Description (optional)" placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={3} />

            {/* Due Date with inline calendar */}
            <Text style={styles.fieldLabel}>Due Date</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowCal(v => !v)} activeOpacity={0.7}>
              <Text style={[styles.dateBtnText, !dueDate && { color: colors.textMuted }]}>
                {displayDueDate || 'Select due date (optional)'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {dueDate ? (
                  <TouchableOpacity onPress={() => { setDueDate(''); setShowCal(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
                <ChevronRight size={14} color={colors.textMuted} style={{ transform: [{ rotate: showCal ? '90deg' : '0deg' }] }} />
              </View>
            </TouchableOpacity>

            {showCal && (
              <View style={styles.calendarBox}>
                <View style={styles.calHeader}>
                  <TouchableOpacity onPress={() => setCalViewDate(new Date(calYear, calMonth - 1, 1))} style={styles.calNav}>
                    <ChevronLeft size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.calMonthText}>{calMonthLabel}</Text>
                  <TouchableOpacity onPress={() => setCalViewDate(new Date(calYear, calMonth + 1, 1))} style={styles.calNav}>
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
                      const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const selected = dueDate === iso;
                      return (
                        <TouchableOpacity
                          key={col}
                          style={[styles.calCell, selected && styles.calCellSelected]}
                          onPress={() => { setDueDate(iso); setShowCal(false); }}
                        >
                          <Text style={[styles.calDayNum, selected && styles.calDayNumSelected]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.fileBtn} onPress={pickFile}>
              <Paperclip size={16} color={colors.primary} />
              <Text style={styles.fileBtnText}>{file ? file.name : 'Attach File (optional)'}</Text>
              {file && <TouchableOpacity onPress={() => setFile(null)}><X size={14} color={colors.textMuted} /></TouchableOpacity>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <><Send size={16} color="#fff" /><Text style={styles.submitText}>Post Assignment</Text></>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, margin: spacing.md, justifyContent: 'center' },
  addBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardLeft: { flex: 1 },
  cardTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  dueText: { fontSize: font.xs, color: colors.warning, fontWeight: '600' },
  statusBadge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '700' },
  deleteBtn: { padding: 8 },
  modal: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  fieldLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs, marginTop: spacing.sm },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  subjectBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start', marginBottom: spacing.sm },
  subjectText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  dateBtnText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  calendarBox: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.md },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  calNav: { padding: 6 },
  calMonthText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  calDayRow: { flexDirection: 'row', marginBottom: 4 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  calWeekRow: { flexDirection: 'row' },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  calCellSelected: { backgroundColor: colors.primary },
  calDayNum: { fontSize: font.sm, color: colors.text },
  calDayNumSelected: { color: '#fff', fontWeight: '700' },
  fileBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  fileBtnText: { flex: 1, fontSize: font.sm, color: colors.primary, fontWeight: '600' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  submitText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
