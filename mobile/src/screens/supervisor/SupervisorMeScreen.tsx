import { useMemo, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { User, Settings, ShieldCheck } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

export default function SupervisorMeScreen() {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('SupervisorSettings')}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <Settings size={18} color={colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
    >
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <User size={36} color={colors.primary} />
        </View>
        <Text style={styles.profileName}>{user?.firstName} {user?.lastName}</Text>
        <Text style={styles.profileUsername}>@{user?.username}</Text>
        {school && (
          <View style={styles.schoolBadge}>
            <ShieldCheck size={13} color={colors.primary} />
            <Text style={styles.schoolBadgeText}>{school.name}</Text>
          </View>
        )}
      </View>

      {/* Info card */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('me.full_name', 'Full Name')}</Text>
          <Text style={styles.infoValue}>{user?.firstName} {user?.lastName}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('me.username', 'Username')}</Text>
          <Text style={styles.infoValue}>@{user?.username}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('me.role', 'Role')}</Text>
          <Text style={styles.infoValue}>Supervisor</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('me.school', 'School')}</Text>
          <Text style={styles.infoValue}>{school?.name ?? '—'}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.md },
  profileCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    ...shadow.md,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  profileName: { fontSize: font.xl, fontWeight: '800', color: '#fff' },
  profileUsername: { fontSize: font.sm, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  schoolBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4,
    marginTop: spacing.sm,
  },
  schoolBadgeText: { fontSize: font.xs, color: '#fff', fontWeight: '600' },
  infoCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.sm,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  infoLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: '500' },
  infoValue: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  divider: { height: 1, backgroundColor: colors.border },
});
