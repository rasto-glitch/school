import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { Plus, Trash2, Send, ChevronDown, Check } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string }
interface StudentItem { id: string; fullName: string }
interface MarkType { id: string; name: string }
interface TermItem { id: string; name: string }
interface Mark { name: string; value: string }
interface GradeRecord { id: string; gradingPeriod?: string; academicYear?: string; marks: Mark[]; createdAt: string }

interface Props { subject?: string; classes: ClassItem[]; academicYear?: string }

export default function TeacherGradingScreen({ subject, classes, academicYear }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedClass, setSelectedClass] = useState('');
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [terms, setTerms] = useState<TermItem[]>([]);
  const [gradingPeriod, setGradingPeriod] = useState('');
  const [marks, setMarks] = useState<Mark[]>([{ name: '', value: '' }]);
  const [history, setHistory] = useState<GradeRecord[]>([]);
  const [saving, setSaving] = useState(false);

  // Pickers
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [termPickerOpen, setTermPickerOpen] = useState(false);

  useEffect(() => {
    teacherApi.getMarkTypes('grade').then(r => setMarkTypes(r.data || [])).catch(() => {});
    teacherApi.getTerms().then(r => setTerms(r.data || [])).catch(() => {});
    if (classes.length > 0) setSelectedClass(classes[0].id);
  }, [classes]);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass }).then(r => setStudents(r.data || [])).catch(() => setStudents([]));
    setSelectedStudent('');
  }, [selectedClass]);

  useEffect(() => {
    setMarks([{ name: '', value: '' }]);
    setGradingPeriod('');
    if (!selectedStudent) { setHistory([]); return; }
    teacherApi.getGrades(selectedStudent).then(r => setHistory(r.data || [])).catch(() => setHistory([]));
  }, [selectedStudent]);

  const total = marks.reduce((s, m) => s + (parseFloat(m.value) || 0), 0);

  // Only show history for the current academic year. Past years are not deleted —
  // they remain in the DB and are still visible to admins, parents, and exports.
  const visibleHistory = academicYear ? history.filter(g => g.academicYear === academicYear) : history;

  const addMark = () => setMarks(prev => [...prev, { name: '', value: '' }]);
  const removeMark = (i: number) => setMarks(prev => prev.filter((_, idx) => idx !== i));
  const updateMark = (i: number, field: 'name' | 'value', val: string) =>
    setMarks(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const selectMarkType = (i: number, name: string) => {
    updateMark(i, 'name', name);
    setPickerIndex(null);
  };

  const handleSave = async () => {
    if (!selectedStudent || !gradingPeriod.trim()) { Alert.alert('Required', 'Select a student and enter a grading period.'); return; }
    const validMarks = marks.filter(m => m.name.trim() && m.value !== '');
    if (validMarks.length === 0) { Alert.alert('Required', 'Add at least one mark.'); return; }
    setSaving(true);
    try {
      await teacherApi.upsertGrade({ studentId: selectedStudent, classId: selectedClass, subject, gradingPeriod: gradingPeriod.trim(), marks: validMarks.map(m => ({ name: m.name, value: parseFloat(m.value) })) });
      Alert.alert('Saved', 'Grade saved successfully.');
      setMarks([{ name: '', value: '' }]);
      setGradingPeriod('');
      teacherApi.getGrades(selectedStudent).then(r => setHistory(r.data || [])).catch(() => {});
    } catch {
      Alert.alert('Error', 'Could not save grade.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
      {/* Class selector */}
      <Text style={styles.label}>Class</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {classes.map(c => (
          <TouchableOpacity key={c.id} style={[styles.chip, selectedClass === c.id && styles.chipActive]} onPress={() => setSelectedClass(c.id)}>
            <Text style={[styles.chipText, selectedClass === c.id && styles.chipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Student selector */}
      {students.length > 0 && (
        <>
          <Text style={styles.label}>Student</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            {students.map(s => (
              <TouchableOpacity key={s.id} style={[styles.chip, selectedStudent === s.id && styles.chipActive]} onPress={() => setSelectedStudent(s.id)}>
                <Text style={[styles.chipText, selectedStudent === s.id && styles.chipTextActive]}>{s.fullName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {subject && (
        <View style={styles.infoBadgeRow}>
          <View style={styles.subjectBadge}><Text style={styles.subjectText}>{subject}</Text></View>
          {academicYear && <View style={styles.yearBadge}><Text style={styles.yearText}>{academicYear}</Text></View>}
        </View>
      )}

      <Text style={styles.label}>Term *</Text>
      <TouchableOpacity style={[styles.input, styles.dropdownBtn]} onPress={() => setTermPickerOpen(true)}>
        <Text style={[styles.dropdownText, !gradingPeriod && { color: colors.textMuted }]}>
          {gradingPeriod || (terms.length ? 'Select term' : 'No terms configured')}
        </Text>
        <ChevronDown size={14} color={colors.textMuted} />
      </TouchableOpacity>

      <Text style={styles.label}>Marks</Text>
      {marks.map((mark, i) => (
        <View key={i} style={styles.markRow}>
          {/* Mark name — dropdown if markTypes available, else text input */}
          <View style={{ flex: 2 }}>
            {markTypes.length > 0 ? (
              <TouchableOpacity style={[styles.input, styles.dropdownBtn]} onPress={() => setPickerIndex(i)}>
                <Text style={[styles.dropdownText, !mark.name && { color: colors.textMuted }]}>
                  {mark.name || 'Select mark type'}
                </Text>
                <ChevronDown size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ) : (
              <TextInput
                style={styles.input}
                placeholder="Mark name"
                placeholderTextColor={colors.textMuted}
                value={mark.name}
                onChangeText={v => updateMark(i, 'name', v)}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={mark.value}
              onChangeText={v => updateMark(i, 'value', v)}
            />
          </View>
          {marks.length > 1 && (
            <TouchableOpacity onPress={() => removeMark(i)} style={styles.removeBtn}>
              <Trash2 size={16} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      ))}

      <View style={styles.marksFooter}>
        <TouchableOpacity style={styles.addMarkBtn} onPress={addMark}>
          <Plus size={16} color={colors.primary} />
          <Text style={styles.addMarkText}>Add Mark</Text>
        </TouchableOpacity>
        {marks.length > 1 && <Text style={styles.totalText}>Total: {total.toFixed(1)}</Text>}
      </View>

      <TouchableOpacity style={[styles.saveBtn, (!selectedStudent) && { opacity: 0.4 }]} onPress={handleSave} disabled={saving || !selectedStudent}>
        {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Send size={16} color="#fff" /><Text style={styles.saveBtnText}>Save Grade</Text></>}
      </TouchableOpacity>

      {/* Grade history — current academic year only.
          Past years are kept in the DB; admins/parents/exports still see them. */}
      {visibleHistory.length > 0 && (
        <>
          <Text style={[styles.label, { marginTop: spacing.lg }]}>Grade History</Text>
          {visibleHistory.map(g => (
            <View key={g.id} style={styles.historyCard}>
              <View style={styles.historyTop}>
                <Text style={styles.historyPeriod}>{g.gradingPeriod || '—'}</Text>
                {g.academicYear && <Text style={styles.historyYear}>{g.academicYear}</Text>}
                <Text style={styles.historyTotal}>{(g.marks || []).reduce((s: number, m: Mark) => s + (parseFloat(String(m.value)) || 0), 0).toFixed(1)}</Text>
              </View>
              <View style={styles.historyMarks}>
                {(g.marks || []).map((m: Mark, i: number) => (
                  <Text key={i} style={styles.historyMark}>{m.name}: {m.value}</Text>
                ))}
              </View>
            </View>
          ))}
        </>
      )}

      {/* Term picker modal */}
      <Modal visible={termPickerOpen} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerBox, { backgroundColor: colors.card }]}>
            <Text style={styles.pickerTitle}>Select Term</Text>
            {terms.length === 0 ? (
              <Text style={{ fontSize: font.sm, color: colors.textMuted, paddingVertical: 14 }}>
                No terms configured. Ask your administrator to add terms in school settings.
              </Text>
            ) : terms.map(t => (
              <TouchableOpacity
                key={t.id}
                style={styles.pickerOption}
                onPress={() => { setGradingPeriod(t.name); setTermPickerOpen(false); }}
              >
                <Text style={styles.pickerOptionText}>{t.name}</Text>
                {gradingPeriod === t.name && <Check size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setTermPickerOpen(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Mark type picker modal */}
      <Modal visible={pickerIndex !== null} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerBox, { backgroundColor: colors.card }]}>
            <Text style={styles.pickerTitle}>Select Mark Type</Text>
            {markTypes.map(mt => (
              <TouchableOpacity
                key={mt.id}
                style={styles.pickerOption}
                onPress={() => pickerIndex !== null && selectMarkType(pickerIndex, mt.name)}
              >
                <Text style={styles.pickerOptionText}>{mt.name}</Text>
                {pickerIndex !== null && marks[pickerIndex]?.name === mt.name && (
                  <Check size={16} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setPickerIndex(null)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  label: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  infoBadgeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  subjectBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7 },
  subjectText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  yearBadge: { backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  yearText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownText: { fontSize: font.md, color: colors.text, flex: 1 },
  markRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  removeBtn: { paddingTop: spacing.md, paddingHorizontal: 4 },
  marksFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  addMarkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addMarkText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  totalText: { fontSize: font.md, fontWeight: '800', color: colors.text },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  historyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  historyTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  historyPeriod: { flex: 1, fontSize: font.sm, fontWeight: '700', color: colors.text },
  historyYear: { fontSize: font.xs, color: colors.textMuted, marginRight: spacing.sm },
  historyTotal: { fontSize: font.lg, fontWeight: '800', color: colors.primary },
  historyMarks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  historyMark: { fontSize: font.xs, color: colors.textSecondary, backgroundColor: colors.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerBox: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: 32 },
  pickerTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  pickerOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerOptionText: { fontSize: font.md, color: colors.text },
  pickerCancel: { marginTop: spacing.md, alignItems: 'center', padding: spacing.md },
  pickerCancelText: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
});
