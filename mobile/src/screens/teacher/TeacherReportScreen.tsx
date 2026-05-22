import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { Plus, Trash2, Send, ChevronDown, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';
import { subjectsForClass, type SubjectOpt, type TeachingEntry } from '../../utils/subjects';

interface ClassItem { id: string; name: string }
interface StudentItem { id: string; fullName: string }
interface MarkType { id: string; name: string }
interface Mark { name: string; value: string }

interface Props { subject?: string; classes: ClassItem[]; subjects?: SubjectOpt[]; teaching?: TeachingEntry[] }

export default function TeacherReportScreen({ subject, classes, subjects, teaching }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [marks, setMarks] = useState<Mark[]>([{ name: '', value: '' }]);
  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [behaviorNotes, setBehaviorNotes] = useState('');
  const [teacherNotes, setTeacherNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Mark type picker state
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  useEffect(() => {
    teacherApi.getMarkTypes('report').then(r => setMarkTypes(r.data || [])).catch(() => {});
    if (classes.length > 0) setSelectedClass(classes[0].id);
  }, [classes]);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass }).then(r => setStudents(r.data || [])).catch(() => setStudents([]));
    setSelectedStudent('');
  }, [selectedClass]);

  const subjectOptions = subjectsForClass(teaching, subjects, selectedClass);

  useEffect(() => {
    if (subjectOptions.length === 1) setSelectedSubject(subjectOptions[0].name);
    else if (selectedSubject && !subjectOptions.some(o => o.name === selectedSubject)) setSelectedSubject('');
  }, [selectedClass, subjectOptions.length]);

  useEffect(() => {
    setMarks([{ name: '', value: '' }]);
    setAttendanceNotes('');
    setBehaviorNotes('');
    setTeacherNotes('');
  }, [selectedStudent]);

  const total = marks.reduce((s, m) => s + (parseFloat(m.value) || 0), 0);

  const addMark = () => setMarks(prev => [...prev, { name: '', value: '' }]);
  const removeMark = (i: number) => setMarks(prev => prev.filter((_, idx) => idx !== i));
  const updateMark = (i: number, field: 'name' | 'value', val: string) =>
    setMarks(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  const selectMarkType = (i: number, name: string) => {
    updateMark(i, 'name', name);
    setPickerIndex(null);
  };

  const handleSave = async () => {
    if (!selectedStudent) { Alert.alert(t('teacher.required'), t('teacher.select_student_required')); return; }
    const validMarks = marks.filter(m => m.name.trim() && m.value !== '');
    setSaving(true);
    try {
      await teacherApi.createReport({
        studentId: selectedStudent,
        subject: selectedSubject || subject,
        marks: validMarks.map(m => ({ name: m.name, value: parseFloat(m.value) })),
        attendanceNotes: attendanceNotes.trim() || undefined,
        behaviorNotes: behaviorNotes.trim() || undefined,
        teacherNotes: teacherNotes.trim() || undefined,
      });
      Alert.alert(t('teacher.saved'), t('teacher.report_saved'));
      setMarks([{ name: '', value: '' }]);
      setAttendanceNotes(''); setBehaviorNotes(''); setTeacherNotes('');
      setSelectedStudent('');
    } catch {
      Alert.alert(t('common.error'), t('teacher.submit_report_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
      <Text style={styles.label}>{t('teacher.class')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {classes.map(c => (
          <TouchableOpacity key={c.id} style={[styles.chip, selectedClass === c.id && styles.chipActive]} onPress={() => setSelectedClass(c.id)}>
            <Text style={[styles.chipText, selectedClass === c.id && styles.chipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {students.length > 0 && (
        <>
          <Text style={styles.label}>{t('teacher.student_required')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            {students.map(s => (
              <TouchableOpacity key={s.id} style={[styles.chip, selectedStudent === s.id && styles.chipActive]} onPress={() => setSelectedStudent(s.id)}>
                <Text style={[styles.chipText, selectedStudent === s.id && styles.chipTextActive]}>{s.fullName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {selectedClass ? (subjectOptions.length === 0 ? (
        <Text style={[styles.label, { color: colors.warning, textTransform: 'none', marginBottom: spacing.md }]}>{t('teacher.no_subject_for_class')}</Text>
      ) : (
        <>
          <Text style={styles.label}>{t('common.subject')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            {subjectOptions.map(s => (
              <TouchableOpacity key={s.id} style={[styles.chip, selectedSubject === s.name && styles.chipActive]} onPress={() => setSelectedSubject(s.name)}>
                <Text style={[styles.chipText, selectedSubject === s.name && styles.chipTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )) : null}

      <Text style={styles.label}>{t('teacher.marks')}</Text>
      {marks.map((mark, i) => (
        <View key={i} style={styles.markRow}>
          <View style={{ flex: 2 }}>
            {markTypes.length > 0 ? (
              <TouchableOpacity style={[styles.input, styles.dropdownBtn]} onPress={() => setPickerIndex(i)}>
                <Text style={[styles.dropdownText, !mark.name && { color: colors.textMuted }]}>
                  {mark.name || t('teacher.select_mark_type')}
                </Text>
                <ChevronDown size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ) : (
              <TextInput
                style={styles.input}
                placeholder={t('teacher.mark_name')}
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
          <Text style={styles.addMarkText}>{t('teacher.add_mark')}</Text>
        </TouchableOpacity>
        {marks.length > 1 && <Text style={styles.totalText}>{t('grades.total')}: {total.toFixed(1)}</Text>}
      </View>

      <Text style={styles.label}>{t('reports.attendance_notes')}</Text>
      <TextInput style={[styles.input, styles.textarea]} placeholder={t('teacher.attendance_obs_ph')} placeholderTextColor={colors.textMuted} value={attendanceNotes} onChangeText={setAttendanceNotes} multiline numberOfLines={3} />

      <Text style={styles.label}>{t('reports.behavior_notes')}</Text>
      <TextInput style={[styles.input, styles.textarea]} placeholder={t('teacher.behavior_obs_ph')} placeholderTextColor={colors.textMuted} value={behaviorNotes} onChangeText={setBehaviorNotes} multiline numberOfLines={3} />

      <Text style={styles.label}>{t('reports.teacher_notes')}</Text>
      <TextInput style={[styles.input, styles.textarea]} placeholder={t('teacher.additional_notes_ph')} placeholderTextColor={colors.textMuted} value={teacherNotes} onChangeText={setTeacherNotes} multiline numberOfLines={4} />

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving || !selectedStudent}>
        {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Send size={16} color="#fff" /><Text style={styles.saveBtnText}>{t('teacher.submit_report')}</Text></>}
      </TouchableOpacity>

      {/* Mark type picker modal */}
      <Modal visible={pickerIndex !== null} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerBox, { backgroundColor: colors.card }]}>
            <Text style={styles.pickerTitle}>{t('teacher.select_mark_type_title')}</Text>
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
              <Text style={styles.pickerCancelText}>{t('common.cancel')}</Text>
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
  subjectBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start', marginBottom: spacing.md },
  subjectText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownText: { fontSize: font.md, color: colors.text, flex: 1 },
  markRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  removeBtn: { paddingTop: spacing.md, paddingHorizontal: 4 },
  marksFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  addMarkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addMarkText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  totalText: { fontSize: font.md, fontWeight: '800', color: colors.text },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerBox: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: 32 },
  pickerTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  pickerOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerOptionText: { fontSize: font.md, color: colors.text },
  pickerCancel: { marginTop: spacing.md, alignItems: 'center', padding: spacing.md },
  pickerCancelText: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
});
