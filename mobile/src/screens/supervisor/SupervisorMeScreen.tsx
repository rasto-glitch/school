import { useMemo, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { User, Settings, ShieldCheck, Plus, Pencil } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { authApi } from '../../services/api';
import { spacing, radius, font, shadow } from '../../theme';

export default function SupervisorMeScreen() {
  const { t } = useTranslation();
  const { user, school, setProfilePicture } = useAuthStore();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [uploading, setUploading] = useState(false);
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
});
