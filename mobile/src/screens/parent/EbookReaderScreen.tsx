import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Dimensions } from 'react-native';
import Pdf from 'react-native-pdf';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation } from '@react-navigation/native';
import { academicApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { font, spacing } from '../../theme';
import type { Ebook } from '../../types';

export default function EbookReaderScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const ebook: Ebook = route.params?.ebook;
  const studentId: string = route.params?.studentId;
  const studentName: string | undefined = route.params?.studentName;

  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [startPage, setStartPage] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ page: 0, total: 0 });

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: ebook?.title ?? t('learn.reader_title', 'Reader') });
  }, [ebook, navigation, t]);

  useEffect(() => {
    academicApi.getEbookProgress({ ebookId: ebook.id, studentId })
      .then(r => {
        const saved = r.data?.[0]?.current_page ?? 0;
        setStartPage(saved > 0 ? saved : 1);
      })
      .catch(() => setStartPage(1));
  }, [ebook.id, studentId]);

  const flushSave = () => {
    const { page: p, total: tot } = latest.current;
    if (p > 0) {
      academicApi.upsertEbookProgress({
        ebookId: ebook.id,
        studentId,
        currentPage: p,
        totalPages: tot || undefined,
      }).catch(() => {});
    }
  };

  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 2000);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    flushSave();
  }, []);

  const percent = total > 0 ? Math.round((page / total) * 100) : 0;

  if (startPage == null) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {loadError ? (
        <View style={styles.loading}>
          <Text style={{ color: colors.danger, fontSize: font.sm, textAlign: 'center', padding: spacing.md }}>
            {loadError}
          </Text>
        </View>
      ) : (
        <Pdf
          source={{ uri: ebook.file_url, cache: true }}
          page={startPage}
          onLoadComplete={(numberOfPages) => {
            setTotal(numberOfPages);
            latest.current.total = numberOfPages;
            if (latest.current.page === 0) {
              setPage(startPage);
              latest.current.page = startPage;
            }
          }}
          onPageChanged={(p, tot) => {
            setPage(p);
            setTotal(tot);
            latest.current = { page: p, total: tot };
            scheduleSave();
          }}
          onError={(err: any) => {
            const msg = err?.message || t('learn.reader_load_failed', 'Failed to open this book.');
            setLoadError(msg);
            Alert.alert(t('common.error', 'Error'), msg);
          }}
          trustAllCerts={false}
          style={styles.pdf}
        />
      )}

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <View>
          <Text style={[styles.footerPage, { color: colors.text }]}>
            {t('learn.reader_page', 'Page')} {page} / {total || '—'}
          </Text>
          {studentName && (
            <Text style={[styles.footerStudent, { color: colors.textMuted }]}>
              {studentName}
            </Text>
          )}
        </View>
        <Text style={[styles.footerPercent, { color: colors.primary }]}>
          {percent}%
        </Text>
      </View>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pdf: { flex: 1, width },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  footerPage: { fontSize: font.sm, fontWeight: '700' },
  footerStudent: { fontSize: font.xs, marginTop: 2 },
  footerPercent: { fontSize: font.md, fontWeight: '800' },
});
