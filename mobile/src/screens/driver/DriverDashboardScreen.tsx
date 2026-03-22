import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Navigation, Users } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';

export default function DriverDashboardScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{t('driver.dashboard_subtitle', { name: user?.firstName })}</Text>
        <Text style={styles.title}>{t('driver.dashboard_title')}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.iconBox}>
          <Navigation size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t('driver.start_your_ride')}</Text>
          <Text style={styles.cardDesc}>{t('driver.start_your_ride_desc')}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.iconBox}>
          <Users size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t('driver.student_info')}</Text>
          <Text style={styles.cardDesc}>{t('driver.student_info_desc')}</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  header: { marginBottom: spacing.lg },
  greeting: { fontSize: font.sm, color: colors.textMuted, marginBottom: 2 },
  title: { fontSize: font.xxxl, fontWeight: '700', color: colors.text },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 2 },
  cardDesc: { fontSize: font.sm, color: colors.textSecondary },
});
