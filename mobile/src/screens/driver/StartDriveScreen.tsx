import { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { driverApi } from '../../services/api';
import { colors, spacing, radius, shadow, font } from '../../theme';
import type { Student } from '../../types';

export default function StartDriveScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [students, setStudents] = useState<Student[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [isDriving, setIsDriving] = useState(false);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    driverApi.getStudents().then(r => setStudents(r.data || [])).catch(() => {});
  }, []);

  const toggleExclude = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sendLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await driverApi.updateLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        speed: loc.coords.speed ?? 0,
        isDriving: true,
      });
    } catch {}
  };

  const startDrive = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Location permission is needed to track your drive.');
      return;
    }
    setLoading(true);
    try {
      await driverApi.startDrive(Array.from(excluded));
      setIsDriving(true);
      await sendLocation();
      intervalRef.current = setInterval(sendLocation, 20000);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not start drive');
    } finally {
      setLoading(false);
    }
  };

  const stopDrive = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setLoading(true);
    try {
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

const styles = StyleSheet.create({
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
