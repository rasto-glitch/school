import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { driverApi } from '../../services/api';
import { LOCATION_TASK_NAME } from '../../tasks/locationTask';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Student } from '../../types';

export default function StartDriveScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [students, setStudents] = useState<Student[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [isDriving, setIsDriving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    driverApi.getStudents().then(r => setStudents(r.data || [])).catch(() => {});
    // Restore driving state if app was restarted mid-drive
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      .then(running => { if (running) setIsDriving(true); })
      .catch(() => {});
  }, []);

  const toggleExclude = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startDrive = async () => {
    // Request foreground permission first
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Permission Required', 'Location permission is needed to track your drive.');
      return;
    }

    // Request background permission — required for tracking when app is backgrounded
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert(
        'Background Location',
        'For continuous tracking when you lock your phone or switch apps, go to Settings → Apps → School Portal → Location and select "Allow all the time".',
        [{ text: 'Continue anyway' }, { text: 'Open Settings', onPress: () => Location.requestBackgroundPermissionsAsync() }]
      );
    }

    setLoading(true);
    try {
      await driverApi.startDrive(Array.from(excluded));

      // Start background location task
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.High,
        timeInterval: 20000,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'GPS Tracking Active',
          notificationBody: 'Your location is being shared for the bus route.',
          notificationColor: '#4F46E5',
        },
      });

      setIsDriving(true);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not start drive');
    } finally {
      setLoading(false);
    }
  };

  const stopDrive = async () => {
    setLoading(true);
    try {
      // Stop background location task
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);

      await driverApi.stopDrive();
      setIsDriving(false);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not stop drive');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>{t('driver.drive_page_title')}</Text>
      <Text style={styles.subtitle}>{t('driver.drive_page_subtitle')}</Text>

      {/* Drive status */}
      <View style={[styles.statusCard, isDriving ? styles.statusActive : styles.statusInactive]}>
        <View style={styles.statusRow}>
          {isDriving && <View style={styles.ping} />}
          <Text style={[styles.statusText, isDriving ? styles.statusTextActive : styles.statusTextInactive]}>
            {isDriving ? t('driver.currently_driving') : t('driver.not_started')}
          </Text>
        </View>
        <Text style={styles.statusDesc}>
          {isDriving ? t('driver.gps_active') : t('driver.gps_inactive')}
        </Text>
      </View>

      {/* Absent toggle list */}
      {!isDriving && (
        <>
          <Text style={styles.sectionTitle}>{t('driver.exclude_absent')}</Text>
          <Text style={styles.sectionDesc}>{t('driver.exclude_absent_desc')}</Text>
          {students.map(s => (
            <View key={s.id} style={styles.studentRow}>
              <View style={styles.studentInfo}>
                <Text style={styles.studentName}>{s.fullName}</Text>
                {s.classes?.name && <Text style={styles.studentClass}>{s.classes.name}</Text>}
              </View>
              <Switch
                value={excluded.has(s.id)}
                onValueChange={() => toggleExclude(s.id)}
                trackColor={{ false: colors.border, true: '#FCA5A5' }}
                thumbColor={excluded.has(s.id) ? colors.danger : colors.card}
              />
            </View>
          ))}
        </>
      )}

      {/* Action button */}
      <TouchableOpacity
        style={[styles.btn, isDriving ? styles.btnStop : styles.btnStart, loading && { opacity: 0.7 }]}
        onPress={isDriving ? stopDrive : startDrive}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color={colors.textInverse} />
          : <Text style={styles.btnText}>{isDriving ? t('driver.stop_drive') : t('driver.start_drive')}</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  statusCard: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1.5 },
  statusActive: { backgroundColor: colors.successLight, borderColor: '#6EE7B7' },
  statusInactive: { backgroundColor: colors.card, borderColor: colors.border },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  ping: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  statusText: { fontSize: font.md, fontWeight: '700' },
  statusTextActive: { color: '#065F46' },
  statusTextInactive: { color: colors.textSecondary },
  statusDesc: { fontSize: font.sm, color: colors.textSecondary },
  sectionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 4 },
  sectionDesc: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  studentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  studentInfo: { flex: 1 },
  studentName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  studentClass: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  btn: { borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg },
  btnStart: { backgroundColor: colors.primary },
  btnStop: { backgroundColor: colors.danger },
  btnText: { color: colors.textInverse, fontSize: font.lg, fontWeight: '700' },
});
