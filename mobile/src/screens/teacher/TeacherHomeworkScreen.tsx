import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { BookOpen, Plus, Trash2, Paperclip, X, Send } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface ClassItem { id: string; name: string }
interface HwItem { id: string; title: string; subject?: string; dueDate?: string; classes?: { name: string }; description?: string }

interface Props { subject?: string; classes: ClassItem[] }

export default function TeacherHomeworkScreen({ subject, classes }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [homework, setHomework] = useState<HwItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    teacherApi.getHomework()
      .then(r => setHomework(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (classes.length > 0 && !classId) setClassId(classes[0].id);
  }, [classes]);

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
      await teacherApi.createHomework({ classId, title: title.trim(), description: description.trim() || undefined, dueDate: dueDate || undefined, subject: subject || undefined, file: file || undefined });
      setTitle(''); setDescription(''); setDueDate(''); setFile(null);
      setShowForm(false);
      load();
    } catch {
      Alert.alert('Error', 'Could not create homework.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (item: HwItem) => {
    Alert.alert('Delete Homework', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeletingId(item.id);
        try { await teacherApi.deleteHomework(item.id); setHomework(prev => prev.filter(h => h.id !== item.id)); }
        catch { Alert.alert('Error', 'Could not delete homework.'); }
        finally { setDeletingId(null); }
      }},
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)}>
        <Plus size={18} color="#fff" />
        <Text style={styles.addBtnText}>New Homework</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : homework.length === 0 ? (
        <View style={styles.empty}>
          <BookOpen size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>No homework posted yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 20 }}>
          {homework.map(hw => (
            <View key={hw.id} style={styles.card}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardTitle}>{hw.title}</Text>
                <Text style={styles.cardMeta}>{[hw.subject, hw.classes?.name].filter(Boolean).join(' · ')}</Text>
                {hw.dueDate && <Text style={styles.dueText}>Due {new Date(hw.dueDate).toLocaleDateString()}</Text>}
              </View>
              <TouchableOpacity onPress={() => handleDelete(hw)} disabled={deletingId === hw.id} style={styles.deleteBtn}>
                {deletingId === hw.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={18} color={colors.danger} />}
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Create Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Homework</Text>
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
            {subject && (
              <>
                <Text style={styles.fieldLabel}>Subject</Text>
                <View style={styles.subjectBadge}><Text style={styles.subjectText}>{subject}</Text></View>
              </>
            )}
            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput style={styles.input} placeholder="Homework title" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, styles.textarea]} placeholder="Description (optional)" placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={3} />
            <Text style={styles.fieldLabel}>Due Date</Text>
            <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={dueDate} onChangeText={setDueDate} />
            <TouchableOpacity style={styles.fileBtn} onPress={pickFile}>
              <Paperclip size={16} color={colors.primary} />
              <Text style={styles.fileBtnText}>{file ? file.name : 'Attach File (optional)'}</Text>
              {file && <TouchableOpacity onPress={() => setFile(null)}><X size={14} color={colors.textMuted} /></TouchableOpacity>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <><Send size={16} color="#fff" /><Text style={styles.submitText}>Post Homework</Text></>}
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
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardLeft: { flex: 1 },
  cardTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  dueText: { fontSize: font.xs, color: colors.warning, fontWeight: '600', marginTop: 2 },
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
  fileBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  fileBtnText: { flex: 1, fontSize: font.sm, color: colors.primary, fontWeight: '600' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  submitText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
