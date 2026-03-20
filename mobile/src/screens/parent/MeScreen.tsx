import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { User, Settings, GraduationCap, Bus } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { parentApi } from '../../services/api';
import { spacing, radius, font, shadow } from '../../theme';
import type { Student } from '../../types';

export default function MeScreen() {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [children, setChildren] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <Settings size={18} color={colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors]);

  useEffect(() => {
    parentApi.getChildren()
      .then(r => setChildren(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  const styles = useMemo(() => makeStyles(colors), [colors]);

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
            <GraduationCap size={13} color={colors.primary} />
            <Text style={styles.schoolBadgeText}>{school.name}</Text>
          </View>
        )}
      </View>

      {/* Info card */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Full Name</Text>
          <Text style={styles.infoValue}>{user?.firstName} {user?.lastName}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Username</Text>
          <Text style={styles.infoValue}>@{user?.username}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Role</Text>
          <Text style={styles.infoValue}>{t('nav.parent', 'Parent')}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>School</Text>
          <Text style={styles.infoValue}>{school?.name ?? '—'}</Text>
        </View>
      </View>

      {/* Children */}
      <Text style={styles.sectionTitle}>
        {t('nav.children', 'Children')} {!loading && `(${children.length})`}
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : children.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No children linked to this account.</Text>
        </View>
      ) : (
        children.map(child => (
          <View key={child.id} style={styles.childCard}>
            <View style={styles.childAvatar}>
              <GraduationCap size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.childName}>{child.fullName}</Text>
              {(child as any).classes?.name && (
                <Text style={styles.childClass}>{(child as any).classes.name}</Text>
              )}
            </View>
            {(child as any).drivers && (
              <View style={styles.driverBadge}>
                <Bus size={12} color="#D97706" />
                <Text style={styles.driverText}>{(child as any).drivers.fullName}</Text>
              </View>
            )}
          </View>
        ))
      )}
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
  sectionTitle: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  childCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  childAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  childName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  childClass: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  driverBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF3C7', borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  driverText: { fontSize: 11, color: '#92400E', fontWeight: '600' },
  emptyBox: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { fontSize: font.sm, color: colors.textMuted },
});
