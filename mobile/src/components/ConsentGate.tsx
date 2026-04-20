import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { Check, ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '../store/themeStore';
import { useRTL } from '../hooks/useRTL';

const CONSENT_KEY = 'consent:v1';
const TERMS_URL = 'https://scholify.krd/terms';
const PRIVACY_URL = 'https://scholify.krd/privacy';

type Status = 'loading' | 'pending' | 'declined' | 'accepted';

export default function ConsentGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [checked, setChecked] = useState(false);
  const colors = useColors();
  const { t } = useTranslation();
  const isRTL = useRTL();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY).then(v => {
      setStatus(v === '1' ? 'accepted' : 'pending');
    });
  }, []);

  const handleAccept = async () => {
    if (!checked) return;
    await AsyncStorage.setItem(CONSENT_KEY, '1');
    setStatus('accepted');
  };

  if (status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (status === 'accepted') {
    return <>{children}</>;
  }

  if (status === 'declined') {
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor: colors.bg,
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 24,
          },
        ]}
      >
        <Text style={[styles.deadTitle, { color: colors.text }]}>{t('consent.declined_title')}</Text>
        <Text style={[styles.deadBody, { color: colors.textSecondary }]}>
          {t('consent.declined_body')}
        </Text>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: colors.primary, alignSelf: 'stretch' }]}
          onPress={() => {
            setChecked(false);
            setStatus('pending');
          }}
        >
          <Text style={[styles.primaryBtnText, { color: '#fff' }]}>{t('consent.review_again')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 16 }}>
        <Text style={[styles.title, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
          {t('consent.title')}
        </Text>
        <Text style={[styles.desc, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
          {t('consent.description')}
        </Text>

        <Pressable
          style={[
            styles.linkCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              flexDirection: isRTL ? 'row-reverse' : 'row',
            },
          ]}
          onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
        >
          <Text style={[styles.linkText, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('consent.read_terms')}
          </Text>
          <ExternalLink size={18} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          style={[
            styles.linkCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              flexDirection: isRTL ? 'row-reverse' : 'row',
            },
          ]}
          onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
        >
          <Text style={[styles.linkText, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('consent.read_privacy')}
          </Text>
          <ExternalLink size={18} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          style={[styles.checkRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          onPress={() => setChecked(v => !v)}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: checked ? colors.primary : colors.border,
                backgroundColor: checked ? colors.primary : 'transparent',
              },
            ]}
          >
            {checked && <Check size={14} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={[styles.checkText, { color: colors.text, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('consent.checkbox')}
          </Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: checked ? colors.primary : colors.border }]}
          onPress={handleAccept}
          disabled={!checked}
        >
          <Text style={[styles.primaryBtnText, { color: checked ? '#fff' : colors.textMuted }]}>
            {t('consent.accept')}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => setStatus('declined')}>
          <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>
            {t('consent.decline')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 12 },
  desc: { fontSize: 15, lineHeight: 22, marginBottom: 24 },
  linkCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  linkText: { fontSize: 16, fontWeight: '600', flex: 1 },
  checkRow: { alignItems: 'flex-start', marginTop: 16, gap: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkText: { fontSize: 14, flex: 1, lineHeight: 20 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 4,
  },
  primaryBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryBtnText: { fontSize: 16, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },
  deadTitle: { fontSize: 24, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  deadBody: { fontSize: 15, lineHeight: 22, marginBottom: 28, textAlign: 'center' },
});
