import { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, Modal, Alert, Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { QrCode, Clock, CheckCircle2, LogOut, AlertTriangle, ScanLine } from 'lucide-react-native';
import { staffAttendanceApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

// Employee self clock-in/out. Scans the rotating reception QR (camera) and sends
// the device GPS fix; the server validates the token + geofence and toggles
// check-in vs check-out. Shared by every clocking role's "Clock In" tab and by
// EmployeeTabs. `embedded` (route param) is true when a header already sits
// above this screen (TeacherTabs' external fixed header) so it skips the top
// safe-area inset; everywhere else it owns its own top inset.

interface AttRow {
  id: string;
  workDate: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  status: 'open' | 'closed' | 'auto_closed';
  isLate?: boolean;
  flagged?: boolean;
  flagReason?: string | null;
}

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// HH:MM in the device's local time (the employee is physically at the school,
// so device-local ≈ school-local). Avoids relying on Hermes Intl.
function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function mapScanError(err: unknown, t: (k: string) => string): string {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
  switch (code) {
    case 'OUTSIDE_GEOFENCE': return t('staff_attendance.err_outside');
    case 'TOKEN_EXPIRED':    return t('staff_attendance.err_expired');
    case 'INVALID_TOKEN':    return t('staff_attendance.err_invalid');
    case 'WRONG_SCHOOL':     return t('staff_attendance.err_wrong_school');
    case 'ALREADY_CLOSED':   return t('staff_attendance.err_already');
    case 'FEATURE_OFF':      return t('staff_attendance.feature_off');
    case 'NOT_CONFIGURED':   return t('staff_attendance.err_not_configured');
    case 'NO_GEOFENCE':      return t('staff_attendance.err_no_geofence');
    default:                 return t('staff_attendance.err_generic');
  }
}

export default function StaffAttendanceScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const embedded = route.params?.embedded === true;
  const { school } = useAuthStore();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const featureOn = school?.features?.staff_attendance === true;

  const [today, setToday] = useState<AttRow | null>(null);
  const [history, setHistory] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const scannedRef = useRef(false);

  const load = useCallback(() =>
    staffAttendanceApi.getMyAttendance()
      .then(r => { setToday(r.data?.today ?? null); setHistory(r.data?.history ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false)),
  []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const status: 'none' | 'open' | 'closed' =
    !today ? 'none' : today.status === 'open' ? 'open' : 'closed';

  const promptSettings = (title: string, body: string) =>
    Alert.alert(title, body, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staff_attendance.open_settings'), onPress: () => { Linking.openSettings().catch(() => {}); } },
    ]);

  const startScan = async () => {
    if (!featureOn) { Alert.alert('', t('staff_attendance.feature_off')); return; }
    let granted = camPerm?.granted ?? false;
    if (!granted) {
      const res = await requestCamPerm();
      granted = res.granted;
    }
    if (!granted) { promptSettings(t('staff_attendance.cam_perm_title'), t('staff_attendance.cam_perm_body')); return; }

    const loc = await Location.requestForegroundPermissionsAsync();
    if (loc.status !== 'granted') { promptSettings(t('staff_attendance.loc_perm_title'), t('staff_attendance.loc_perm_body')); return; }

    scannedRef.current = false;
    setScanning(true);
  };

  const onBarcode = async ({ data }: { data: string }) => {
    if (scannedRef.current) return;       // debounce — the camera fires continuously
    scannedRef.current = true;
    setScanning(false);
    setProcessing(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const res = await staffAttendanceApi.scan({
        token: data,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy ?? undefined,
      });
      const d = res.data as { action: 'check_in' | 'check_out'; isLate?: boolean };
      const msg = d.action === 'check_in'
        ? (d.isLate ? t('staff_attendance.success_check_in_late') : t('staff_attendance.success_check_in'))
        : t('staff_attendance.success_check_out');
      Alert.alert('', msg);
      await load();
    } catch (err) {
      Alert.alert('', mapScanError(err, t));
    } finally {
      setProcessing(false);
      scannedRef.current = false;
    }
  };

  const renderStatus = () => {
    if (!featureOn) {
      return (
        <View style={styles.statusCard}>
          <AlertTriangle size={26} color="#D97706" />
          <Text style={styles.statusText}>{t('staff_attendance.feature_off')}</Text>
        </View>
      );
    }
    if (status === 'open') {
      return (
        <View style={styles.statusCard}>
          <CheckCircle2 size={30} color="#16A34A" />
          <Text style={styles.statusText}>{t('staff_attendance.status_checked_in', { time: fmtTime(today?.checkInAt) })}</Text>
          {today?.isLate && (
            <View style={styles.lateBadge}><Text style={styles.lateBadgeText}>{t('staff_attendance.late_badge')}</Text></View>
          )}
        </View>
      );
    }
    if (status === 'closed') {
      return (
        <View style={styles.statusCard}>
          <LogOut size={28} color={colors.primary} />
          <Text style={styles.statusText}>{t('staff_attendance.status_checked_out', { time: fmtTime(today?.checkOutAt) })}</Text>
        </View>
      );
    }
    return (
      <View style={styles.statusCard}>
        <Clock size={28} color={colors.textMuted} />
        <Text style={styles.statusText}>{t('staff_attendance.status_not_checked_in')}</Text>
      </View>
    );
  };

  const actionLabel =
    status === 'open' ? t('staff_attendance.scan_check_out')
      : status === 'closed' ? t('staff_attendance.done_today')
        : t('staff_attendance.scan_check_in');
  const actionDisabled = !featureOn || status === 'closed' || processing;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: (embedded ? 0 : insets.top) + spacing.md, paddingBottom: 40 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.heading}>{t('staff_attendance.title')}</Text>
        <Text style={styles.subheading}>{t('staff_attendance.subtitle')}</Text>

        {renderStatus()}

        <TouchableOpacity
          style={[styles.scanBtn, actionDisabled && styles.scanBtnDisabled]}
          activeOpacity={0.85}
          onPress={startScan}
          disabled={actionDisabled}
        >
          {processing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <QrCode size={20} color="#fff" />
              <Text style={styles.scanBtnText}>{actionLabel}</Text>
            </>
          )}
        </TouchableOpacity>

        {/* History */}
        <Text style={styles.sectionTitle}>{t('staff_attendance.history_title')}</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} />
        ) : history.length === 0 ? (
          <Text style={styles.emptyText}>{t('staff_attendance.no_history')}</Text>
        ) : (
          <View style={styles.historyCard}>
            {history.map((row, i) => {
              const [y, mo, da] = row.workDate.split('-').map(Number);
              const dt = new Date(y, (mo || 1) - 1, da || 1);
              const dateLabel = `${t('common.days.' + WEEKDAY_KEYS[dt.getDay()])} ${da}`;
              return (
                <View key={row.id} style={[styles.historyRow, i > 0 && styles.historyDivider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>{dateLabel}</Text>
                    {(row.flagged || row.status === 'auto_closed') && (
                      <Text style={styles.flaggedText}>{t('staff_attendance.flagged')}</Text>
                    )}
                  </View>
                  <View style={styles.timeCol}>
                    <Text style={styles.timeLabel}>{t('staff_attendance.in_label')}</Text>
                    <Text style={[styles.timeValue, row.isLate && { color: '#D97706' }]}>{fmtTime(row.checkInAt) || '—'}</Text>
                  </View>
                  <View style={styles.timeCol}>
                    <Text style={styles.timeLabel}>{t('staff_attendance.out_label')}</Text>
                    <Text style={styles.timeValue}>{fmtTime(row.checkOutAt) || '—'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Camera scanner */}
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {scanning && (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcode}
            />
          )}
          <View style={[styles.scanOverlay, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]} pointerEvents="box-none">
            <View style={styles.scanHintWrap}>
              <ScanLine size={20} color="#fff" />
              <Text style={styles.scanHint}>{t('staff_attendance.scanning_hint')}</Text>
            </View>
            <View style={styles.scanFrame} pointerEvents="none" />
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setScanning(false)} activeOpacity={0.85}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>, isDark: boolean) => StyleSheet.create({
  content: { paddingHorizontal: spacing.md },
  heading: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  subheading: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.lg },
  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.lg, ...shadow.sm,
  },
  statusText: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  lateBadge: { backgroundColor: '#FEF3C7', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  lateBadgeText: { fontSize: font.xs, fontWeight: '800', color: '#D97706' },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingVertical: 16, marginTop: spacing.md, ...shadow.md,
  },
  scanBtnDisabled: { opacity: 0.45 },
  scanBtnText: { fontSize: font.md, fontWeight: '800', color: '#fff' },
  sectionTitle: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  emptyText: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing.sm },
  historyCard: { backgroundColor: colors.card, borderRadius: radius.md, ...shadow.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  historyDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  historyDate: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  flaggedText: { fontSize: font.xs, color: '#D97706', marginTop: 2, fontWeight: '600' },
  timeCol: { alignItems: 'center', minWidth: 48 },
  timeLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  timeValue: { fontSize: font.sm, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], marginTop: 2 },
  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  scanHintWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: spacing.lg,
  },
  scanHint: { color: '#fff', fontSize: font.sm, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  scanFrame: {
    width: 240, height: 240, borderRadius: radius.lg,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
  },
  cancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: radius.full,
    paddingHorizontal: 28, paddingVertical: 12,
  },
  cancelText: { fontSize: font.md, fontWeight: '800', color: '#111' },
});
