import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HeartPulse, AlertTriangle } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { spacing, radius, font } from '../theme';

// Read-only "safety subset" of a student's clinic health profile (allergies,
// chronic conditions, dietary notes) shown to teachers & supervisors in the
// mobile student brief. The full profile + nurse-visit log stay clinic-only.
export interface StudentHealthBrief {
  allergyTags: string[];
  chronicConditions: string | null;
  dietaryNotes: string | null;
  hasAny: boolean;
}

const ROSE = '#E11D48';

export default function HealthSafetyPanel({ health }: { health?: StudentHealthBrief | null }) {
  const { t } = useTranslation();
  const colors = useColors();
  if (!health || !health.hasAny) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <HeartPulse size={14} color={ROSE} />
        <Text style={styles.title}>{t('healthBrief.title', 'Health & safety')}</Text>
      </View>

      {health.allergyTags.length > 0 ? (
        <View style={styles.chipsRow}>
          <AlertTriangle size={12} color={ROSE} style={{ marginRight: 4 }} />
          <Text style={styles.label}>{t('healthBrief.allergies', 'Allergies')}:</Text>
          {health.allergyTags.map((a, i) => (
            <View key={i} style={styles.chip}><Text style={styles.chipText}>{a}</Text></View>
          ))}
        </View>
      ) : null}

      {health.chronicConditions ? (
        <Text style={[styles.line, { color: colors.text }]}>
          <Text style={styles.lineLabel}>{t('healthBrief.conditions', 'Conditions')}: </Text>
          {health.chronicConditions}
        </Text>
      ) : null}

      {health.dietaryNotes ? (
        <Text style={[styles.line, { color: colors.text }]}>
          <Text style={styles.lineLabel}>{t('healthBrief.dietary', 'Dietary notes')}: </Text>
          {health.dietaryNotes}
        </Text>
      ) : null}

      <Text style={[styles.confidential, { color: colors.textMuted }]}>
        {t('healthBrief.confidential', 'Confidential — for student safety only.')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1, borderColor: 'rgba(225,29,72,0.35)', backgroundColor: 'rgba(225,29,72,0.08)',
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  title: { color: ROSE, fontWeight: '700', fontSize: font.sm, marginLeft: 6 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 },
  label: { color: ROSE, fontWeight: '600', fontSize: font.sm, marginRight: 6 },
  chip: { backgroundColor: 'rgba(225,29,72,0.15)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4, marginBottom: 4 },
  chipText: { color: ROSE, fontSize: font.xs },
  line: { fontSize: font.sm, marginTop: 2 },
  lineLabel: { fontWeight: '600' },
  confidential: { fontSize: font.xs, marginTop: 6 },
});
