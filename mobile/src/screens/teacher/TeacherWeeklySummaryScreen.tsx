import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { Clock, Lock, Send } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import { subjectsForClass, type SubjectOpt, type TeachingEntry } from '../../utils/subjects';

interface ClassItem { id: string; name: string }
interface PeriodItem { id: string; weekStartDate: string; weekEndDate: string }

interface Props { subject?: string; classes: ClassItem[]; subjects?: SubjectOpt[]; teaching?: TeachingEntry[]; embedded?: boolean }

export default function TeacherWeeklySummaryScreen({ subject, classes, subjects, teaching, embedded }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [period, setPeriod] = useState<PeriodItem | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [unit, setUnit] = useState('');
  const [lesson, setLesson] = useState('');
  const [pages, setPages] = useState('');
  const [homeworkReminder, setHomeworkReminder] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const subjectOptions = subjectsForClass(teaching, subjects, selectedClass);

  useEffect(() => {
    if (subjectOptions.length === 1) setSelectedSubject(subjectOptions[0].name);
    else if (selectedSubject && !subjectOptions.some(o => o.name === selectedSubject)) setSelectedSubject('');
  }, [selectedClass, subjectOptions.length]);

  useEffect(() => {
    teacherApi.getActivePeriod()
      .then(r => setPeriod(r.data || null))
      .catch(() => setPeriod(null))
      .finally(() => setPeriodLoading(false));
  }, []);

  useEffect(() => {
    if (classes.length > 0 && !selectedClass) setSelectedClass(classes[0].id);
  }, [classes]);

  useEffect(() => {
    if (!selectedClass || !period) return;
    setLoadingExisting(true);
    teacherApi.getWeeklySummary({ classId: selectedClass, weekStartDate: period.weekStartDate })
      .then(r => {
        const rows = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
        // A teacher can have one summary per subject for the same class+week — pick the one
        // matching the picked subject (or the first row if no subject is selected yet).
        const data = (selectedSubject && rows.find((x: any) => x.subject === selectedSubject)) || rows[0] || null;
        if (data) {
          setUnit(data.unit || '');
          setLesson(data.lesson || '');
          setPages(data.pages || '');
          setHomeworkReminder(data.homeworkReminder || '');
        } else {
          setUnit(''); setLesson(''); setPages(''); setHomeworkReminder('');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
  }, [selectedClass, period, selectedSubject]);

  const handleSave = async () => {
    if (!selectedClass || !period) return;
    setSaving(true);
    try {
      await teacherApi.upsertWeeklySummary({ classId: selectedClass, subject: selectedSubject || subject, unit: unit.trim() || undefined, lesson: lesson.trim() || undefined, pages: pages.trim() || undefined, homeworkReminder: homeworkReminder.trim() || undefined });
      Alert.alert(t('teacher.saved'), t('teacher.weekly_saved'));
    } catch {
      Alert.alert(t('common.error'), t('teacher.weekly_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const periodLabel = period
    ? `${new Date(period.weekStartDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(period.weekEndDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
      {/* Period banner */}
      {periodLoading ? (
        <CardListSkeleton count={1} hasIcon={false} />
      ) : period ? (
        <View style={styles.periodBanner}>
          <Clock size={16} color={colors.success} />
          <Text style={styles.periodText}>{t('teacher.period_open', { range: periodLabel })}</Text>
        </View>
      ) : (
        <View style={styles.noPeriodBanner}>
          <Lock size={16} color={colors.warning} />
          <Text style={styles.noPeriodText}>{t('teacher.no_active_period')}</Text>
        </View>
      )}

      {/* Class selector */}
      <Text style={styles.label}>{t('teacher.class')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {classes.map(c => (
          <TouchableOpacity key={c.id} style={[styles.chip, selectedClass === c.id && styles.chipActive]} onPress={() => setSelectedClass(c.id)} disabled={!period}>
            <Text style={[styles.chipText, selectedClass === c.id && styles.chipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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

      {loadingExisting ? (
        <CardListSkeleton count={4} hasIcon={false} />
      ) : (
        <>
          <Text style={styles.label}>{t('teacher.unit')}</Text>
          <TextInput style={styles.input} placeholder={t('teacher.unit_ph')} placeholderTextColor={colors.textMuted} value={unit} onChangeText={setUnit} editable={!!period} />

          <Text style={styles.label}>{t('teacher.lessons_covered')}</Text>
          <TextInput style={styles.input} placeholder={t('teacher.lessons_ph')} placeholderTextColor={colors.textMuted} value={lesson} onChangeText={setLesson} editable={!!period} />

          <Text style={styles.label}>{t('teacher.pages')}</Text>
          <TextInput style={styles.input} placeholder={t('teacher.pages_ph')} placeholderTextColor={colors.textMuted} value={pages} onChangeText={setPages} editable={!!period} />

          <Text style={styles.label}>{t('teacher.homework_reminder')}</Text>
          <TextInput style={[styles.input, styles.textarea]} placeholder={t('teacher.homework_reminder_ph')} placeholderTextColor={colors.textMuted} value={homeworkReminder} onChangeText={setHomeworkReminder} multiline numberOfLines={3} editable={!!period} />

          <TouchableOpacity style={[styles.saveBtn, !period && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving || !period}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Send size={16} color="#fff" /><Text style={styles.saveBtnText}>{t('teacher.save_summary')}</Text></>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  periodBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.successLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  periodText: { fontSize: font.sm, fontWeight: '600', color: colors.success, flex: 1 },
  noPeriodBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  noPeriodText: { fontSize: font.sm, fontWeight: '600', color: colors.warning, flex: 1 },
  label: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  subjectBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start', marginBottom: spacing.md },
  subjectText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  input: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, fontSize: font.md, color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
