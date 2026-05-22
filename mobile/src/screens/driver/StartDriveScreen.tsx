import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { AlertCircle, Home } from 'lucide-react-native';
import { driverApi } from '../../services/api';
import { LOCATION_TASK_NAME } from '../../tasks/locationTask';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Student } from '../../types';

type ExclusionReason = 'school_absent' | 'went_home_with_parents';

interface ExclusionEntry {
  reason: ExclusionReason;
  schoolStatus: string; // snapshot of attendance.status
}

export default function StartDriveScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<Student[]>([]);
  // Map of studentId → exclusion info; absent from map = riding the bus
  const [exclusionMap, setExclusionMap] = useState<Map<string, ExclusionEntry>>(new Map());
  // Map of studentId → school attendance status today (only absent/excused entries)
  const [schoolAbsences, setSchoolAbsences] = useState<Map<string, string>>(new Map());
  const [isDriving, setIsDriving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    driverApi.getStudents().then(r => setStudents(r.data || [])).catch(() => {});

    // Fetch today's school attendance — pre-populate excluded list
    driverApi.getTodayAttendance().then(r => {
      const absMap = new Map<string, string>();
      (r.data || []).forEach((a: any) => absMap.set(a.studentId, a.status));
      setSchoolAbsences(absMap);
      // Pre-exclude students marked absent/excused by school
      setExclusionMap(() => {
        const next = new Map<string, ExclusionEntry>();
        absMap.forEach((status, studentId) => {
          next.set(studentId, { reason: 'school_absent', schoolStatus: status });
        });
        return next;
      });
    }).catch(() => {});

    // Restore driving state if app was restarted mid-drive
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      .then(running => { if (running) setIsDriving(true); })
      .catch(() => {});
  }, []);

  const toggleExclude = (student: Student) => {
    setExclusionMap(prev => {
      const next = new Map(prev);
      if (next.has(student.id)) {
        // Un-exclude: student WILL ride the bus (overrides school absent too)
        next.delete(student.id);
      } else {
        // Exclude: determine reason
        const schoolStatus = schoolAbsences.get(student.id);
        const reason: ExclusionReason = (schoolStatus === 'absent' || schoolStatus === 'excused')
          ? 'school_absent'
          : 'went_home_with_parents';
        next.set(student.id, { reason, schoolStatus: schoolStatus ?? 'present' });
      }
      return next;
    });
  };

  const startDrive = async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert(t('driver.perm_required_title'), t('driver.perm_required_body'));
      return;
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert(
        t('driver.bg_location_title'),
        t('driver.bg_location_body'),
        [{ text: t('driver.continue_anyway') }, { text: t('driver.open_settings'), onPress: () => Location.requestBackgroundPermissionsAsync() }]
      );
    }

    setLoading(true);
    try {
      // Build ride records for every student
      const studentRides = students.map(s => {
        const excl = exclusionMap.get(s.id);
        return {
          studentId: s.id,
          rodeBus: !excl,
          exclusionReason: excl?.reason,
          // Snapshot school status: use known absence or 'present' if riding
          schoolAttendanceStatus: excl?.schoolStatus ?? (schoolAbsences.get(s.id) ?? 'present'),
        };
      });

      await driverApi.startDrive(studentRides);

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
      Alert.alert(t('common.error'), err.response?.data?.error || t('driver.start_failed'));
    } finally {
      setLoading(false);
    }
  };

  const stopDrive = async () => {
    setLoading(true);
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      await driverApi.stopDrive();
      setIsDriving(false);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.response?.data?.error || t('driver.stop_failed'));
    } finally {
      setLoading(false);
    }
  };

  const excludedCount = exclusionMap.size;

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

      {/* Student list — only shown before driving */}
      {!isDriving && (
        <>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>{t('driver.exclude_absent')}</Text>
            {excludedCount > 0 && (
              <View style={styles.excludedBadge}>
                <Text style={styles.excludedBadgeText}>{t('driver.n_excluded', { count: excludedCount })}</Text>
              </View>
            )}
          </View>
          <Text style={styles.sectionDesc}>{t('driver.exclude_absent_desc')}</Text>

          {students.map(s => {
            const excl = exclusionMap.get(s.id);
            const isExcluded = !!excl;
            const isSchoolAbsent = excl?.reason === 'school_absent';
            const isHomeWithParents = excl?.reason === 'went_home_with_parents';

            return (
              <View key={s.id} style={[styles.studentRow, isExcluded && styles.studentRowExcluded]}>
                <View style={styles.studentInfo}>
                  <Text style={styles.studentName}>{s.fullName}</Text>
                  {s.classes?.name && <Text style={styles.studentClass}>{s.classes.name}</Text>}

                  {/* Reason tag */}
                  {isSchoolAbsent && (
                    <View style={styles.reasonTag}>
                      <AlertCircle size={11} color={colors.danger} />
                      <Text style={[styles.reasonTagText, { color: colors.danger }]}>
                        {excl!.schoolStatus === 'excused' ? t('driver.excused_by_school') : t('driver.absent_by_school')}
                      </Text>
                    </View>
                  )}
                  {isHomeWithParents && (
                    <View style={[styles.reasonTag, { backgroundColor: '#EDE9FE' }]}>
                      <Home size={11} color="#7C3AED" />
                      <Text style={[styles.reasonTagText, { color: '#7C3AED' }]}>{t('driver.home_with_parents')}</Text>
                    </View>
                  )}

                  {/* Override notice: school absent but driver un-excludes */}
                  {!isExcluded && schoolAbsences.has(s.id) && (
                    <View style={[styles.reasonTag, { backgroundColor: colors.warningLight }]}>
                      <AlertCircle size={11} color={colors.warning} />
                      <Text style={[styles.reasonTagText, { color: colors.warning }]}>{t('driver.school_absent_riding')}</Text>
                    </View>
                  )}
                </View>

                <Switch
                  value={isExcluded}
                  onValueChange={() => toggleExclude(s)}
                  trackColor={{ false: colors.border, true: '#FCA5A5' }}
                  thumbColor={isExcluded ? colors.danger : colors.card}
                />
              </View>
            );
          })}
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
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  sectionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sectionDesc: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  excludedBadge: { backgroundColor: colors.dangerLight, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  excludedBadgeText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  studentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  studentRowExcluded: { opacity: 0.75, borderLeftWidth: 3, borderLeftColor: colors.danger },
  studentInfo: { flex: 1, marginRight: spacing.sm },
  studentName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  studentClass: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  reasonTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.dangerLight, borderRadius: radius.full,
    paddingHorizontal: 7, paddingVertical: 3, marginTop: 5, alignSelf: 'flex-start',
  },
  reasonTagText: { fontSize: 11, fontWeight: '600' },
  btn: { borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg },
  btnStart: { backgroundColor: colors.primary },
  btnStop: { backgroundColor: colors.danger },
  btnText: { color: colors.textInverse, fontSize: font.lg, fontWeight: '700' },
});
