import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '../store/themeStore';
import { isUpdateRequired, openStore } from '../utils/appVersion';

// Outermost gate: if the installed build is below the server-required minimum,
// show a blocking "update required" screen that sends the user to the store.
// Renders children while the (cheap, one-shot) check runs and whenever it isn't
// confidently below the minimum — the check fails open, so this never blocks
// without a definite signal.
export default function UpdateGate({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  const colors = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let alive = true;
    isUpdateRequired().then(r => { if (alive) setBlocked(r); });
    return () => { alive = false; };
  }, []);

  if (!blocked) return <>{children}</>;

  return (
    <View
      style={[
        styles.center,
        {
          backgroundColor: colors.bg,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
        <ArrowUpCircle size={40} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{t('update.title')}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t('update.body')}</Text>
      <Pressable style={[styles.btn, { backgroundColor: colors.primary }]} onPress={openStore}>
        <Text style={styles.btnText}>{t('update.button')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 28 },
  btn: { alignSelf: 'stretch', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
