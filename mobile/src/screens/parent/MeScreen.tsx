import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Image, Alert } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { User, GraduationCap, Bus, Plus, Pencil, Calendar, ChevronRight, CreditCard, Archive } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import { useColors, useIsDark } from '../../store/themeStore';
import { parentApi, authApi } from '../../services/api';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { spacing, radius, font, shadow } from '../../theme';
import type { Student } from '../../types';

export default function MeScreen() {
  const { t } = useTranslation();
  const { user, school, setProfilePicture } = useAuthStore();
  const colors = useColors();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [children, setChildren] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadChildren = (silent = false) =>
    parentApi.getChildren()
      .then(r => setChildren(r.data || []))
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false); });

  useEffect(() => { loadChildren(); }, []);
  useRefreshOnFocus(() => loadChildren(true));

  const pickAndUpload = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow photo access in settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const data = await authApi.uploadProfilePicture(
        asset.uri,
        asset.fileName || `avatar_${Date.now()}.jpg`,
        asset.mimeType || 'image/jpeg',
      );
      setProfilePicture(data.profilePicture);
    } catch {
      Alert.alert('Upload failed', 'Could not update profile picture.');
    } finally {
      setUploading(false);
    }
  };

  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
    >
      {/* Profile card */}
      <View style={styles.profileCard}>
        <TouchableOpacity onPress={pickAndUpload} disabled={uploading} activeOpacity={0.8} style={styles.avatarWrap}>
          {user?.profilePicture ? (
            <Image source={{ uri: user.profilePicture }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <User size={36} color={colors.primary} />
            </View>
          )}
          {/* Badge: + when no photo, pencil when photo exists */}
          <View style={styles.avatarBadge}>
            {uploading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : user?.profilePicture
                ? <Pencil size={10} color={colors.primary} />
                : <Plus size={12} color={colors.primary} />}
          </View>
        </TouchableOpacity>

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

      {/* Schedule */}
      <TouchableOpacity
        style={styles.actionCard}
        onPress={() => navigation.navigate('ParentSchedule')}
        activeOpacity={0.7}
      >
        <View style={styles.actionIcon}>
          <Calendar size={20} color={isDark ? '#FFFFFF' : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Schedule</Text>
          <Text style={styles.actionSub}>See your child's weekly classes</Text>
        </View>
        <ChevronRight size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Tuition (premium) */}
      {school?.features?.tuition_fees === true && (
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('Tuition')}
          activeOpacity={0.7}
        >
          <View style={styles.actionIcon}>
            <CreditCard size={20} color={isDark ? '#FFFFFF' : colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>{t('tuition.title', 'Tuition')}</Text>
            <Text style={styles.actionSub}>{t('tuition.subtitle', 'Status, payments, receipts')}</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Past Records (archive — paid feature) */}
      {school?.features?.archive === true && (
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('PastRecords')}
          activeOpacity={0.7}
        >
          <View style={styles.actionIcon}>
            <Archive size={20} color={isDark ? '#FFFFFF' : colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>{t('past_records.title', 'Past Records')}</Text>
            <Text style={styles.actionSub}>{t('past_records.subtitle', 'Graduated or departed children')}</Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Children */}
      <Text style={styles.sectionTitle}>
        {t('nav.children', 'Children')} {!loading && `(${children.length})`}
      </Text>

      {loading ? (
        <CardListSkeleton count={2} />
      ) : children.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No children linked to this account.</Text>
        </View>
      ) : (
        children.map(child => (
          <View key={child.id} style={styles.childCard}>
            <View style={styles.childAvatar}>
              <GraduationCap size={20} color={isDark ? '#FFFFFF' : colors.primary} />
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

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
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
  avatarWrap: { position: 'relative', marginBottom: spacing.sm },
  avatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarImg: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
  },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.primaryLight,
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
    backgroundColor: isDark ? 'transparent' : colors.primaryLight,
    borderWidth: isDark ? 1.5 : 0,
    borderColor: isDark ? '#FFFFFF' : 'transparent',
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
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.sm,
  },
  actionIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: isDark ? 'transparent' : colors.primaryLight,
    borderWidth: isDark ? 1.5 : 0,
    borderColor: isDark ? '#FFFFFF' : 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  actionTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  actionSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
});
