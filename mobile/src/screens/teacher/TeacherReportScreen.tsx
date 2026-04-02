import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { Plus, Trash2, Send } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';

interface ClassItem { id: string; name: string }
interface StudentItem { id: string; fullName: string }
interface MarkType { id: string; name: string }
interface Mark { name: string; value: string }

interface Props { subject?: string; classes: ClassItem[] }

export default function TeacherReportScreen({ subject, classes }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedClass, setSelectedClass] = useState('');
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [markTypes, setMarkTypes] = useState<MarkType[]>([]);
  const [marks, setMarks] = useState<Mark[]>([{ name: '', value: '' }]);
  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [behaviorNotes, setBehaviorNotes] = useState('');
  const [teacherNotes, setTeacherNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    teacherApi.getMarkTypes('report').then(r => setMarkTypes(r.data || [])).catch(() => {});
    if (classes.length > 0) setSelectedClass(classes[0].id);
  }, [classes]);

  useEffect(() => {
    if (!selectedClass) return;
    teacherApi.getStudents({ classId: selectedClass }).then(r => setStudents(r.data || [])).catch(() => setStudents([]));
    setSelectedStudent('');
  }, [selectedClass]);

  const total = marks.reduce((s, m) => s + (parseFloat(m.value) || 0), 0);

  const addMark = () => setMarks(prev => [...prev, { name: '', value: '' }]);
  const removeMark = (i: number) => setMarks(prev => prev.filter((_, idx) => idx !== i));
  const updateMark = (i: number, field: 'name' | 'value', val: string) =>
    setMarks(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));

  const handleSave = async () => {
    if (!selectedStudent) { Alert.alert('Required', 'Please select a student.'); return; }
    const validMarks = marks.filter(m => m.name.trim() && m.value !== '');
    setSaving(true);
    try {
      await teacherApi.createReport({
        studentId: selectedStudent,
        subject,
        marks: validMarks.map(m => ({ name: m.name, value: parseFloat(m.value) })),
        attendanceNotes: attendanceNotes.trim() || undefined,
        behaviorNotes: behaviorNotes.trim() || undefined,
        teacherNotes: teacherNotes.trim() || undefined,
      });
      Alert.alert('Saved', 'Report submitted successfully.');
      setMarks([{ name: '', value: '' }]);
      setAttendanceNotes(''); setBehaviorNotes(''); setTeacherNotes('');
      setSelectedStudent('');
    } catch {
      Alert.alert('Error', 'Could not submit report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
      <Text style={styles.label}>Class</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {classes.map(c => (
          <TouchableOpacity key={c.id} style={[styles.chip, selectedClass === c.id && styles.chipActive]} onPress={() => setSelectedClass(c.id)}>
            <Text style={[styles.chipText, selectedClass === c.id && styles.chipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {students.length > 0 && (
        <>
          <Text style={styles.label}>Student *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
            {students.map(s => (
              <TouchableOpacity key={s.id} style={[styles.chip, selectedStudent === s.id && styles.chipActive]} onPress={() => setSelectedStudent(s.id)}>
                <Text style={[styles.chipText, selectedStudent === s.id && styles.chipTextActive]}>{s.fullName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {subject && <View style={styles.subjectBadge}><Text style={styles.subjectText}>{subject}</Text></View>}

      <Text style={styles.label}>Marks</Text>
      {marks.map((mark, i) => (
        <View key={i} style={styles.markRow}>
          <View style={{ flex: 2 }}>
            <TextInput
              style={styles.input}
              placeholder={markTypes[i]?.name || 'Mark name'}
              placeholderTextColor={colors.textMuted}
              value={mark.name}
              onChangeText={v => updateMark(i, 'name', v)}
            />
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

      <Text style={styles.label}>Attendance Notes</Text>
      <TextInput style={[styles.input, styles.textarea]} placeholder="Attendance observations..." placeholderTextColor={colors.textMuted} value={attendanceNotes} onChangeText={setAttendanceNotes} multiline numberOfLines={3} />

      <Text style={styles.label}>Behavior Notes</Text>
      <TextInput style={[styles.input, styles.textarea]} placeholder="Behavior observations..." placeholderTextColor={colors.textMuted} value={behaviorNotes} onChangeText={setBehaviorNotes} multiline numberOfLines={3} />

      <Text style={styles.label}>Teacher Notes</Text>
      <TextInput style={[styles.input, styles.textarea]} placeholder="Additional notes..." placeholderTextColor={colors.textMuted} value={teacherNotes} onChangeText={setTeacherNotes} multiline numberOfLines={4} />

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving || !selectedStudent}>
        {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Send size={16} color="#fff" /><Text style={styles.saveBtnText}>Submit Report</Text></>}
      </TouchableOpacity>
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
  markRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  removeBtn: { paddingTop: spacing.md, paddingHorizontal: 4 },
  marksFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  addMarkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addMarkText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  totalText: { fontSize: font.md, fontWeight: '800', color: colors.text },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
