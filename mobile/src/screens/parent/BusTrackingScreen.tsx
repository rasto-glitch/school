import { useEffect, useState, useCallback, useRef, Component, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Animated, Linking, Easing } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { io as socketIO } from 'socket.io-client';
import { AlertCircle, Bus, Car, Phone, MessageSquare, Shield } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import i18n from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useColors, useIsDark } from '../../store/themeStore';
import { font } from '../../theme';
import type { Student } from '../../types';

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'https://school-production-3ccc.up.railway.app';

const KID_COLORS = ['#F472B6', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA', '#F87171'];

interface BusData {
  location: {
    driverId: string;
    latitude: number;
    longitude: number;
    isDriving: boolean;
    drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; vehicleType?: 'bus' | 'taxi'; buses?: { busNumber: string } };
  };
  studentHome: { latitude: number; longitude: number };
}

interface DriverInfo {
  fullName: string;
  phoneNumber?: string;
  licenseNumber?: string;
  vehicleType?: 'bus' | 'taxi';
  buses?: { busNumber: string };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeETA(busLat: number, busLng: number, targetLat: number, targetLng: number, speedMs: number): string {
  const distKm = haversineKm(busLat, busLng, targetLat, targetLng);
  const speedKmh = speedMs > 1 ? speedMs * 3.6 : 30;
  const etaMs = (distKm / speedKmh) * 3600000;
  return new Date(Date.now() + etaMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

class MapErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B7280' }}>{i18n.t('bus.map_unavailable')}</Text>
          <Text style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', paddingHorizontal: 24 }}>{i18n.t('bus.map_key_required')}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function BusTrackingScreen() {
  const { t } = useTranslation();
  const { token } = useAuthStore();
  const colors = useColors();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();

  // Saved pickup pin — still needed for ETA target + the map marker even
  // though the editor itself now lives in Settings → Pickup location.
  const [pickupCoords, setPickupCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const hasPickupRef = useRef<boolean | null>(null);

  const [staticDriverInfo, setStaticDriverInfo] = useState<DriverInfo | null>(null);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [busData, setBusData] = useState<BusData | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parentLocation, setParentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busSpeed, setBusSpeed] = useState(0);

  // "Updated Ns ago" — set on every poll success and every socket push.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Pulsing live dot
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulseAnim, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  useEffect(() => {
    parentApi.getPickupLocation().then(r => {
      const { latitude, longitude } = r.data;
      const has = !!(latitude && longitude);
      hasPickupRef.current = has;
      setPickupCoords({ lat: latitude ?? null, lng: longitude ?? null });
    }).catch(() => { hasPickupRef.current = false; });
  }, []);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids = r.data || [];
      setChildren(kids);
      if (kids.length > 0) {
        const withDriver = kids.find((k: any) => k.drivers && (Array.isArray(k.drivers) ? k.drivers.length > 0 : k.drivers.fullName));
        setSelectedChild(withDriver?.id || kids[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    parentApi.getDriverInfo(selectedChild)
      .then(r => setStaticDriverInfo(r.data))
      .catch(() => setStaticDriverInfo(null));
  }, [selectedChild]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const getLocation = async (autoSave = false) => {
        const loc = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = loc.coords;
        setParentLocation({ latitude, longitude });
        if (autoSave && hasPickupRef.current === false) {
          parentApi.updatePickupLocation(latitude, longitude).then(() => {
            hasPickupRef.current = true;
            setPickupCoords({ lat: latitude, lng: longitude });
          }).catch(() => {});
        }
      };
      await getLocation(true);
      interval = setInterval(() => getLocation(false), 5 * 60 * 1000);
    })();
    return () => clearInterval(interval);
  }, []);

  const reset = useCallback(() => { setBusData(null); setAbsent(false); }, []);

  const fetchBus = useCallback(() => {
    if (!selectedChild) return;
    setLoading(true);
    parentApi.getBusLocation(selectedChild)
      .then(r => { setBusData(r.data); setAbsent(false); setLastUpdatedAt(Date.now()); })
      .catch(err => {
        const msg: string = err.response?.data?.error || '';
        setBusData(null);
        setAbsent(msg.toLowerCase().includes('absent'));
      })
      .finally(() => setLoading(false));
  }, [selectedChild]);

  useEffect(() => { reset(); fetchBus(); const iv = setInterval(fetchBus, 30000); return () => clearInterval(iv); }, [fetchBus, reset]);

  useEffect(() => {
    const driverId = busData?.location?.driverId;
    if (!driverId) return;
    const socket = socketIO(SOCKET_URL, { auth: { token } });
    socket.emit('watchDriver', driverId);
    socket.on('locationUpdate', (data: { latitude: number; longitude: number; isDriving: boolean; speed?: number }) => {
      if (data.speed !== undefined) setBusSpeed(data.speed);
      setBusData(prev => prev ? { ...prev, location: { ...prev.location, latitude: data.latitude, longitude: data.longitude, isDriving: data.isDriving } } : prev);
      setLastUpdatedAt(Date.now());
    });
    socket.on('driveEnded', () => reset());
    socket.on('busAlert', (data: { title: string; message: string }) => {
      Alert.alert(data.title, data.message);
    });
    return () => { socket.disconnect(); };
  }, [busData?.location?.driverId, reset, token]);

  const isActive = !!busData?.location?.isDriving;
  const driverInfo: DriverInfo | null = busData?.location?.drivers || staticDriverInfo;
  const etaTarget = pickupCoords.lat && pickupCoords.lng
    ? { lat: pickupCoords.lat, lng: pickupCoords.lng }
    : parentLocation
      ? { lat: parentLocation.latitude, lng: parentLocation.longitude }
      : busData?.studentHome ? { lat: busData.studentHome.latitude, lng: busData.studentHome.longitude } : null;
  const etaTime = isActive && busData?.location && etaTarget
    ? computeETA(busData.location.latitude, busData.location.longitude, etaTarget.lat, etaTarget.lng, busSpeed)
    : null;

  const distKm = isActive && busData?.location && etaTarget
    ? haversineKm(busData.location.latitude, busData.location.longitude, etaTarget.lat, etaTarget.lng)
    : null;
  const etaMinutes = distKm != null
    ? Math.max(1, Math.round(distKm / (busSpeed > 1 ? busSpeed * 3.6 : 30) * 60))
    : null;
  const distLabel = distKm != null
    ? `${distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)} km`
    : null;
  const secondsAgo = lastUpdatedAt != null ? Math.max(0, Math.floor((nowTick - lastUpdatedAt) / 1000)) : null;

  // Initial map framing: show BOTH the bus and the parent point at a
  // moderate zoom. initialRegion (NOT region) applies once; afterwards the
  // user can freely zoom/pan while the live marker keeps moving.
  let mapInitialRegion: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | undefined;
  if (busData?.location) {
    const b = busData.location;
    if (etaTarget) {
      const PAD = 2.2;
      const MIN_DELTA = 0.012;
      mapInitialRegion = {
        latitude: (b.latitude + etaTarget.lat) / 2,
        longitude: (b.longitude + etaTarget.lng) / 2,
        latitudeDelta: Math.max(Math.abs(b.latitude - etaTarget.lat) * PAD, MIN_DELTA),
        longitudeDelta: Math.max(Math.abs(b.longitude - etaTarget.lng) * PAD, MIN_DELTA),
      };
    } else {
      mapInitialRegion = { latitude: b.latitude, longitude: b.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    }
  }

  const accent = colors.primary;
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const onCall = () => { if (driverInfo?.phoneNumber) Linking.openURL('tel:' + driverInfo.phoneNumber); };
  const onText = () => { if (driverInfo?.phoneNumber) Linking.openURL('sms:' + driverInfo.phoneNumber); };
  const onReport = () => {
    Alert.alert(t('bus.report_title'), t('bus.report_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('bus.report_send'), onPress: () => { console.log('[bus] report issue TODO — child', selectedChild); } },
    ]);
  };

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.8] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.5, 0, 0] });

  const onboardLabel = children.length === 1
    ? children[0].fullName.trim().split(/\s+/)[0]
    : t('bus.onboard_other', { count: children.length });

  return (
    <View style={styles.container}>
      {/* Map fills the scene (under the existing ParentTabs header + tab bar) */}
      {mapInitialRegion ? (
        <MapErrorBoundary>
          <MapView
            key={`${busData!.location.driverId}:${etaTarget ? 'two' : 'one'}`}
            style={StyleSheet.absoluteFillObject}
            provider={PROVIDER_DEFAULT}
            initialRegion={mapInitialRegion}
          >
            <Marker coordinate={{ latitude: busData!.location.latitude, longitude: busData!.location.longitude }} title="Bus" anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.busMarker}>
                {busData!.location.drivers?.vehicleType === 'taxi'
                  ? <Car size={18} color="#fff" />
                  : <Bus size={18} color="#fff" />}
              </View>
            </Marker>
            {busData!.studentHome?.latitude && (
              <Marker coordinate={{ latitude: busData!.studentHome.latitude, longitude: busData!.studentHome.longitude }} title="Home" pinColor="green" />
            )}
            {pickupCoords.lat && pickupCoords.lng ? (
              <Marker coordinate={{ latitude: pickupCoords.lat, longitude: pickupCoords.lng }} title="Pickup Location" pinColor="red" />
            ) : parentLocation ? (
              <Marker coordinate={parentLocation} title="Your Location" pinColor="red" />
            ) : null}
          </MapView>
        </MapErrorBoundary>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.bg }]} />
      )}

      {/* Loading spinner over the map */}
      {loading && !busData && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={isDark ? '#FFFFFF' : accent} />
        </View>
      )}

      {/* ── TOP BANNER ───────────────────────────────────────── */}
      {absent ? (
        <View style={[styles.card, styles.topCard, { top: insets.top + 12 }, styles.absentCard]}>
          <AlertCircle size={18} color={colors.warning} />
          <Text style={styles.absentText}>{t('bus.absent_message')}</Text>
        </View>
      ) : (
        <View style={[styles.card, styles.topCard, { top: insets.top + 12 }]}>
          <View style={styles.statusStrip}>
            {isActive ? (
              <>
                <View style={styles.pingWrap}>
                  <Animated.View style={[styles.pingHalo, { backgroundColor: accent, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
                  <View style={[styles.pingDot, { backgroundColor: accent }]} />
                </View>
                <Text style={[styles.statusLabel, { color: accent }]}>{t('bus.live')}</Text>
                {secondsAgo != null && (
                  <Text style={styles.updatedText}>{t('bus.updated_ago', { seconds: secondsAgo })}</Text>
                )}
              </>
            ) : (
              <>
                <View style={[styles.pingDot, { backgroundColor: colors.textMuted }]} />
                <Text style={[styles.statusLabel, { color: colors.textMuted }]}>{t('bus.not_active')}</Text>
              </>
            )}
          </View>

          <View style={styles.bannerMain}>
            <View style={{ flex: 1 }}>
              {isActive && etaTime ? (
                <>
                  <Text style={styles.caption}>{t('bus.arrives_caption')}</Text>
                  <View style={styles.etaRow}>
                    <Text style={styles.etaTime}>{etaTime}</Text>
                    {etaMinutes != null && (
                      <View style={[styles.chip, { backgroundColor: accent + (isDark ? '22' : '18') }]}>
                        <Text style={[styles.chipText, { color: accent }]}>{t('bus.in_min', { min: etaMinutes })}</Text>
                      </View>
                    )}
                  </View>
                  {distLabel && <Text style={styles.detailLine}>{t('bus.distance_away', { dist: distLabel })}</Text>}
                </>
              ) : (
                <>
                  <Text style={styles.caption}>{t('bus.not_active')}</Text>
                  <Text style={[styles.detailLine, { marginTop: 4 }]}>{t('bus.not_active_desc')}</Text>
                </>
              )}
            </View>

            {children.length > 0 && (
              <View style={{ alignItems: 'flex-end' }}>
                <View style={styles.kidStack}>
                  {children.slice(0, 4).map((c, i) => (
                    <View
                      key={c.id}
                      style={[
                        styles.kidAvatar,
                        { backgroundColor: KID_COLORS[i % KID_COLORS.length], marginLeft: i === 0 ? 0 : -10, zIndex: 4 - i },
                      ]}
                    >
                      <Text style={styles.kidInitials}>{initialsOf(c.fullName)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.onboardText}>{onboardLabel}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── BOTTOM DRIVER + ACTION BAR ────────────────────────── */}
      {!absent && driverInfo && (
        <View style={[styles.card, styles.bottomCard, { bottom: insets.bottom + 12 }]}>
          <View style={styles.driverRow}>
            <View style={[styles.driverAvatar, { backgroundColor: accent }]}>
              <Text style={styles.driverAvatarText}>{initialsOf(driverInfo.fullName)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.driverName} numberOfLines={1}>{driverInfo.fullName}</Text>
              <Text style={styles.driverSub} numberOfLines={1}>
                {driverInfo.licenseNumber
                  ? `${t('bus.driver')} · ${t('bus.license')} ${driverInfo.licenseNumber}`
                  : t('bus.driver')}
              </Text>
            </View>
            {driverInfo.buses?.busNumber && (
              <View style={styles.busBadge}>
                <Bus size={12} color={isDark ? '#F8FAFC' : colors.text} />
                <Text style={styles.busBadgeText}>#{driverInfo.buses.busNumber}</Text>
              </View>
            )}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, !driverInfo.phoneNumber && { opacity: 0.5 }]}
              onPress={onCall}
              disabled={!driverInfo.phoneNumber}
              activeOpacity={0.7}
            >
              <Phone size={16} color={isDark ? '#F8FAFC' : colors.text} />
              <Text style={styles.actionLabel}>{t('bus.call')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, !driverInfo.phoneNumber && { opacity: 0.5 }]}
              onPress={onText}
              disabled={!driverInfo.phoneNumber}
              activeOpacity={0.7}
            >
              <MessageSquare size={16} color={isDark ? '#F8FAFC' : colors.text} />
              <Text style={styles.actionLabel}>{t('bus.text')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={onReport} activeOpacity={0.7}>
              <Shield size={16} color={isDark ? '#F87171' : colors.danger} />
              <Text style={[styles.actionLabel, { color: isDark ? '#F87171' : colors.danger }]}>{t('bus.report')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: colors.card,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: isDark ? 0.4 : 0.1,
    shadowRadius: 24,
    elevation: 6,
    ...(isDark ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' } : null),
  },
  topCard: { paddingTop: 8, paddingHorizontal: 18, paddingBottom: 16 },
  bottomCard: { paddingTop: 14, paddingHorizontal: 18, paddingBottom: 14 },

  statusStrip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pingWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  pingHalo: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  pingDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  updatedText: { marginLeft: 'auto', fontSize: 11, fontWeight: '600', color: colors.textSecondary },

  bannerMain: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 4 },
  caption: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  etaTime: { fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 36, color: colors.text },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  detailLine: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginTop: 4 },

  kidStack: { flexDirection: 'row' },
  kidAvatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: isDark ? '#1B232E' : '#FFFFFF',
  },
  kidInitials: { fontSize: 11, fontWeight: '700', color: '#fff' },
  onboardText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 4, textAlign: 'right' },

  absentCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  absentText: { flex: 1, fontSize: font.sm, color: isDark ? '#FCD34D' : '#92400E', fontWeight: '500' },

  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  driverAvatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  driverName: { fontSize: 14, fontWeight: '700', color: colors.text },
  driverSub: { fontSize: 11, fontWeight: '500', color: colors.textSecondary, marginTop: 1 },
  busBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9',
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  busBadgeText: { fontSize: 11, fontWeight: '700', color: isDark ? '#F8FAFC' : colors.text },

  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, height: 44, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E5E9EF',
  },
  actionLabel: { fontSize: 13, fontWeight: '700', color: isDark ? '#F8FAFC' : colors.text },

  busMarker: {
    backgroundColor: colors.primary, borderRadius: 20, padding: 6,
    borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3,
    elevation: 4,
  },
});
