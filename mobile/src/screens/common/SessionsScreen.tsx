import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Activity, LogOut } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { sessionsApi } from '../../services/api';
import { spacing, radius, font } from '../../theme';

// One row per refresh-token family (the "session" unit the user
// recognizes — one browser, one phone, etc.). Independent of MFA, so
// every signed-in user has at least this screen worth seeing.

interface Session {
  familyId: string;
  deviceLabel: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
}

export default function SessionsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const styles = makeStyles(colors);

  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await sessionsApi.list();
      setSessions(r.data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const onRevoke = (familyId: string) => {
    Alert.alert(
      t('sessions.revoke_title'),
      t('sessions.revoke_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sessions.revoke'),
          style: 'destructive',
          onPress: async () => {
            setRevokingId(familyId);
            try {
              await sessionsApi.revoke(familyId);
              setSessions((prev) => (prev || []).filter((s) => s.familyId !== familyId));
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.response?.data?.error || t('sessions.revoke_failed'));
            } finally {
              setRevokingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('sessions.section_title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}>
        <View style={styles.card}>
          <Activity size={20} color={colors.primary} />
          <Text style={styles.cardText}>{t('sessions.section_body')}</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : !sessions || sessions.length === 0 ? (
          <Text style={styles.muted}>{t('sessions.none')}</Text>
        ) : (
          sessions.map((s) => (
            <View key={s.familyId} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceLabel}>{s.deviceLabel}</Text>
                <Text style={styles.deviceSub}>
                  {t('sessions.started')}: {new Date(s.createdAt).toLocaleString()}
                </Text>
                <Text style={styles.deviceSub}>
                  {t('sessions.last_active')}: {new Date(s.lastActivityAt).toLocaleString()}
                  {s.ip ? ` · ${s.ip}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onRevoke(s.familyId)}
                disabled={revokingId === s.familyId}
                style={styles.revokeBtn}
              >
                {revokingId === s.familyId
                  ? <ActivityIndicator color={colors.danger} />
                  : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <LogOut size={14} color={colors.danger} />
                      <Text style={styles.revokeBtnText}>{t('sessions.revoke')}</Text>
                    </View>
                  )}
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  cardText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 20 },
  muted: { fontSize: font.sm, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  deviceLabel: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  deviceSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  revokeBtn: { padding: spacing.xs },
  revokeBtnText: { fontSize: font.xs, fontWeight: '700', color: colors.danger },
});
