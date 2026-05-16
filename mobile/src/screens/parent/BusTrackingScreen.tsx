import { useEffect, useState, useCallback, useRef, Component, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { io as socketIO } from 'socket.io-client';
import { RefreshCw, User, AlertCircle, Bus, Car, MapPin, ChevronRight, Building2, Home, Check } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { parentApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Student } from '../../types';

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'https://school-production-3ccc.up.railway.app';

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

class MapErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <View style={{ height: 280, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B7280' }}>Map unavailable on this device</Text>
          <Text style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', paddingHorizontal: 24 }}>Google Maps API key required for Android</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function BusTrackingScreen() {
  const { t } = useTranslation();
  const { token } = useAuthStore();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const isDark = useIsDark();

  // Pickup location + residence state
  const [hasPickupLocation, setHasPickupLocation] = useState<boolean | null>(null);
  const hasPickupRef = useRef<boolean | null>(null);
  const [pickupCoords, setPickupCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [residenceType, setResidenceType] = useState<'apartment' | 'house' | null>(null);
  const [blockNumber, setBlockNumber] = useState('');
  const [residenceDirty, setResidenceDirty] = useState(false);
  const [savingResidence, setSavingResidence] = useState(false);

  const [staticDriverInfo, setStaticDriverInfo] = useState<DriverInfo | null>(null);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [busData, setBusData] = useState<BusData | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parentLocation, setParentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busSpeed, setBusSpeed] = useState(0);

  useEffect(() => {
    parentApi.getPickupLocation().then(r => {
      const { latitude, longitude, residenceType: rt, blockNumber: bn } = r.data;
      const has = !!(latitude && longitude);
      hasPickupRef.current = has;
      setHasPickupLocation(has);
      setPickupCoords({ lat: latitude ?? null, lng: longitude ?? null });
      setResidenceType((rt as 'apartment' | 'house' | null) ?? null);
      setBlockNumber(bn ?? '');
    }).catch(() => { hasPickupRef.current = false; setHasPickupLocation(false); });
  }, []);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids = r.data || [];
      setChildren(kids);
      if (kids.length > 0) {
        // Prefer the first child who has a driver assigned
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
        // Auto-save as pickup location if none set yet
        if (autoSave && hasPickupRef.current === false) {
          parentApi.updatePickupLocation(latitude, longitude).then(() => {
            hasPickupRef.current = true;
            setHasPickupLocation(true);
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
      .then(r => { setBusData(r.data); setAbsent(false); })
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
    });
    socket.on('driveEnded', () => reset());
    socket.on('busAlert', (data: { title: string; message: string }) => {
      Alert.alert(data.title, data.message);
    });
    return () => { socket.disconnect(); };
  }, [busData?.location?.driverId, reset, token]);

  const handleSaveResidence = async () => {
    setSavingResidence(true);
    try {
      await parentApi.updatePickupLocation(
        pickupCoords.lat ?? 0,
        pickupCoords.lng ?? 0,
        residenceType ?? undefined,
        blockNumber.trim() || undefined,
      );
      setResidenceDirty(false);
    } catch {
      Alert.alert('Error', 'Could not save residence info. Please try again.');
    } finally {
      setSavingResidence(false);
    }
  };

  const isActive = !!busData?.location?.isDriving;
  const driverInfo: DriverInfo | null = busData?.location?.drivers || staticDriverInfo;
  // Prefer manually-set pickup location for ETA and map marker
  const etaTarget = pickupCoords.lat && pickupCoords.lng
    ? { lat: pickupCoords.lat, lng: pickupCoords.lng }
    : parentLocation
      ? { lat: parentLocation.latitude, lng: parentLocation.longitude }
      : busData?.studentHome ? { lat: busData.studentHome.latitude, lng: busData.studentHome.longitude } : null;
  const etaTime = isActive && busData?.location && etaTarget
    ? computeETA(busData.location.latitude, busData.location.longitude, etaTarget.lat, etaTarget.lng, busSpeed)
    : null;

  // Initial map framing: when the parent opens an active bus, show BOTH the
  // bus and the parent's point (pickup > GPS > home) at a moderate zoom so
  // the distance is readable. initialRegion (NOT region) = applied once;
  // after that the user can freely zoom/pan and the live marker keeps
  // moving without the camera ever snapping back.
  let mapInitialRegion: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | undefined;
  if (busData?.location) {
    const b = busData.location;
    if (etaTarget) {
      const PAD = 2.2;         // breathing room so neither point sits on the edge
      const MIN_DELTA = 0.012; // moderate cap so close points don't over-zoom
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

  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>{t('bus.title')}</Text>
          <Text style={styles.subtitle}>{t('bus.subtitle')}</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchBus} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={isDark ? '#FFFFFF' : colors.primary} />
            : <RefreshCw size={18} color={isDark ? '#FFFFFF' : colors.primary} />}
        </TouchableOpacity>
      </View>

      {/* Child selector */}
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {children.map(c => (
            <TouchableOpacity key={c.id} style={[styles.chip, selectedChild === c.id && styles.chipActive]} onPress={() => setSelectedChild(c.id)}>
              <Text style={[styles.chipText, selectedChild === c.id && styles.chipTextActive]}>{c.fullName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Driver info — always visible when available */}
      {driverInfo && (
        <View style={styles.driverCard}>
          <Text style={styles.sectionLabel}>{t('bus.driver_info')}</Text>
          <View style={styles.driverRow}>
            <View style={styles.driverAvatar}>
              <User size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{driverInfo.fullName}</Text>
              {driverInfo.licenseNumber && <Text style={styles.driverMeta}>{t('bus.license')}: {driverInfo.licenseNumber}</Text>}
              {driverInfo.phoneNumber && <Text style={[styles.driverMeta, { color: colors.primary }]}>{driverInfo.phoneNumber}</Text>}
            </View>
            {driverInfo.buses?.busNumber && (
              <View style={styles.busBadge}>
                <Bus size={12} color={colors.primary} />
                <Text style={styles.busBadgeText}>#{driverInfo.buses.busNumber}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Absent */}
      {absent && (
        <View style={styles.absentCard}>
          <AlertCircle size={18} color={colors.warning} />
          <Text style={styles.absentText}>{t('bus.absent_message')}</Text>
        </View>
      )}

      {/* Not active */}
      {!isActive && !absent && !loading && (
        <View style={styles.inactiveCard}>
          <Bus size={28} color={colors.textMuted} />
          <Text style={styles.inactiveTitle}>{t('bus.not_active')}</Text>
          <Text style={styles.inactiveDesc}>{t('bus.not_active_desc')}</Text>
        </View>
      )}

      {/* Active */}
      {isActive && busData && (
        <>
          <View style={styles.activeCard}>
            <View style={styles.activeRow}>
              <View>
                <Text style={styles.activeTitle}>{t('bus.bus_active')}</Text>
                <Text style={styles.activeSub}>{t('bus.bus_number', { number: busData.location.drivers?.buses?.busNumber || 'N/A' })}</Text>
              </View>
              <View style={styles.pingDot} />
            </View>
          </View>

          {etaTime && (
            <View style={styles.etaCard}>
              <Text style={styles.etaLabel}>{t('bus.arrives_at')}</Text>
              <Text style={styles.etaTime}>{etaTime}</Text>
              <Text style={styles.etaNote}>{pickupCoords.lat ? t('bus.eta_pickup_location', { defaultValue: 'Based on your pickup location' }) : parentLocation ? t('bus.eta_your_location') : t('bus.eta_home_location')}</Text>
            </View>
          )}

          {mapInitialRegion && (
            <View style={styles.mapContainer}>
              <MapErrorBoundary>
                <MapView
                  // Remount only when the framed pair changes (different
                  // driver, or the parent point becoming known) so a fresh
                  // active bus is re-framed once — but live socket/poll
                  // updates keep the same key, preserving the user's zoom/pan.
                  key={`${busData.location.driverId}:${etaTarget ? 'two' : 'one'}`}
                  style={styles.map}
                  provider={PROVIDER_DEFAULT}
                  initialRegion={mapInitialRegion}
                >
                  <Marker coordinate={{ latitude: busData.location.latitude, longitude: busData.location.longitude }} title="Bus" anchor={{ x: 0.5, y: 0.5 }}>
                    <View style={styles.busMarker}>
                      {busData.location.drivers?.vehicleType === 'taxi'
                        ? <Car size={18} color="#fff" />
                        : <Bus size={18} color="#fff" />}
                    </View>
                  </Marker>
                  {busData.studentHome?.latitude && (
                    <Marker coordinate={{ latitude: busData.studentHome.latitude, longitude: busData.studentHome.longitude }} title="Home" pinColor="green" />
                  )}
                  {pickupCoords.lat && pickupCoords.lng ? (
                    <Marker coordinate={{ latitude: pickupCoords.lat, longitude: pickupCoords.lng }} title="Pickup Location" pinColor="red" />
                  ) : parentLocation ? (
                    <Marker coordinate={parentLocation} title="Your Location" pinColor="red" />
                  ) : null}
                </MapView>
              </MapErrorBoundary>
            </View>
          )}
        </>
      )}

      {/* Pickup location (GPS pin) */}
      <TouchableOpacity style={styles.pickupRow} onPress={() => navigation.navigate('SetPickupLocation')} activeOpacity={0.7}>
        <View style={[styles.pickupIcon, { backgroundColor: hasPickupLocation ? colors.success + '22' : colors.warning + '22' }]}>
          <MapPin size={16} color={hasPickupLocation ? colors.success : colors.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pickupLabel}>{t('pickup.profile_row')}</Text>
          <Text style={[styles.pickupSub, { color: hasPickupLocation ? colors.success : colors.warning }]}>
            {hasPickupLocation === null ? '...' : hasPickupLocation ? t('pickup.set') : t('pickup.not_set')}
          </Text>
        </View>
        <ChevronRight size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Residence info — inline */}
      <View style={styles.residenceCard}>
        <Text style={styles.sectionLabel}>Residence Type</Text>
        <View style={styles.residenceRow}>
          {([
            { type: 'apartment' as const, label: 'Apartment', Icon: Building2 },
            { type: 'house' as const, label: 'House', Icon: Home },
          ]).map(({ type, label, Icon }) => {
            const selected = residenceType === type;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.residenceOption, selected && styles.residenceOptionSelected]}
                onPress={() => { setResidenceType(type); setResidenceDirty(true); }}
                activeOpacity={0.7}
              >
                <Icon size={20} color={isDark ? (selected ? '#000000' : '#FFFFFF') : (selected ? colors.primary : colors.textMuted)} />
                <Text style={[styles.residenceOptionLabel, selected && { color: isDark ? '#000000' : colors.primary }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
          {residenceType === 'apartment' ? 'Building Number' : 'Block Number'}
        </Text>
        <TextInput
          style={styles.blockInput}
          placeholder={residenceType === 'apartment' ? 'e.g. Building A or Building 3' : 'e.g. Block 1 or Block B'}
          placeholderTextColor={colors.textMuted}
          value={blockNumber}
          onChangeText={v => { setBlockNumber(v); setResidenceDirty(true); }}
        />

        {residenceDirty && (
          <TouchableOpacity style={styles.saveResidenceBtn} onPress={handleSaveResidence} disabled={savingResidence} activeOpacity={0.8}>
            {savingResidence
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Check size={15} color="#fff" /><Text style={styles.saveResidenceBtnText}>Save</Text></>}
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  refreshBtn: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1.5, borderColor: isDark ? '#FFFFFF' : colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: isDark ? 'transparent' : colors.card },
  chipActive: { borderColor: isDark ? '#FFFFFF' : colors.primary, backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight },
  chipText: { fontSize: font.sm, color: isDark ? '#FFFFFF' : colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: isDark ? '#000000' : colors.primary, fontWeight: '700' },
  driverCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  driverMeta: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  busBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  busBadgeText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  absentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: '#FDE68A' },
  absentText: { color: '#92400E', fontSize: font.sm, flex: 1 },
  inactiveCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  inactiveTitle: { fontSize: font.md, fontWeight: '600', color: colors.textSecondary },
  inactiveDesc: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },
  activeCard: { backgroundColor: colors.successLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1.5, borderColor: '#6EE7B7', ...shadow.sm },
  activeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeTitle: { fontSize: font.md, fontWeight: '700', color: '#065F46' },
  activeSub: { fontSize: font.sm, color: '#047857', marginTop: 2 },
  pingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success },
  etaCard: { backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  etaLabel: { fontSize: font.xs, color: colors.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  etaTime: { fontSize: 40, fontWeight: '800', color: colors.primaryDark, marginTop: 2 },
  etaNote: { fontSize: font.xs, color: '#818CF8', marginTop: 4 },
  mapContainer: { borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.sm, height: 280 },
  map: { flex: 1 },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  pickupIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  pickupLabel: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  pickupSub: { fontSize: font.xs, fontWeight: '600', marginTop: 1 },
  residenceCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  residenceRow: { flexDirection: 'row', gap: spacing.sm },
  residenceOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 12, borderRadius: radius.md, borderWidth: 2,
    borderColor: isDark ? '#FFFFFF' : colors.border,
    backgroundColor: isDark ? 'transparent' : undefined,
  },
  residenceOptionSelected: { borderColor: isDark ? '#FFFFFF' : colors.primary, backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight },
  residenceOptionLabel: { fontSize: font.sm, fontWeight: '600', color: isDark ? '#FFFFFF' : colors.textMuted },
  blockInput: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: font.sm, color: colors.text,
    marginBottom: spacing.sm,
  },
  saveResidenceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 10, marginTop: spacing.xs,
  },
  saveResidenceBtnText: { fontSize: font.sm, fontWeight: '700', color: '#fff' },
  busMarker: {
    backgroundColor: colors.primary, borderRadius: 20, padding: 6,
    borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3,
    elevation: 4,
  },
});
