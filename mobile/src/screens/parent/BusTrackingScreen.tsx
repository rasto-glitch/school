import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { io as socketIO } from 'socket.io-client';
import { RefreshCw, User, AlertCircle, Bus } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, radius, shadow, font } from '../../theme';
import type { Student } from '../../types';

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://localhost:5000';

interface BusData {
  location: {
    driverId: string;
    latitude: number;
    longitude: number;
    isDriving: boolean;
    drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; buses?: { busNumber: string } };
  };
  studentHome: { latitude: number; longitude: number };
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

export default function BusTrackingScreen() {
  const { t } = useTranslation();
  const { token } = useAuthStore();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [busData, setBusData] = useState<BusData | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parentLocation, setParentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busSpeed, setBusSpeed] = useState(0);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids = r.data || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0].id);
    });
  }, []);

  // Get parent's location every 5 minutes
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const getLocation = async () => {
        const loc = await Location.getCurrentPositionAsync({});
        setParentLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      };
      await getLocation();
      interval = setInterval(getLocation, 5 * 60 * 1000);
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

  // Socket
  useEffect(() => {
    const driverId = busData?.location?.driverId;
    if (!driverId) return;
    const socket = socketIO(SOCKET_URL, { transports: ['websocket'], auth: { token } });
    socket.emit('watchDriver', driverId);
    socket.on('locationUpdate', (data: { latitude: number; longitude: number; isDriving: boolean; speed?: number }) => {
      if (data.speed !== undefined) setBusSpeed(data.speed);
      setBusData(prev => prev ? { ...prev, location: { ...prev.location, latitude: data.latitude, longitude: data.longitude, isDriving: data.isDriving } } : prev);
    });
    socket.on('driveEnded', () => reset());
    return () => { socket.disconnect(); };
  }, [busData?.location?.driverId, reset, token]);

  const isActive = !!busData?.location?.isDriving;
  const driverInfo = busData?.location?.drivers;
  const etaTarget = parentLocation
    ? { lat: parentLocation.latitude, lng: parentLocation.longitude }
    : busData?.studentHome ? { lat: busData.studentHome.latitude, lng: busData.studentHome.longitude } : null;
  const etaTime = isActive && busData?.location && etaTarget
    ? computeETA(busData.location.latitude, busData.location.longitude, etaTarget.lat, etaTarget.lng, busSpeed)
    : null;

  const mapRegion = busData?.location ? {
    latitude: busData.location.latitude,
    longitude: busData.location.longitude,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  } : undefined;

  const insets = useSafeAreaInsets();

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
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <RefreshCw size={18} color={colors.primary} />}
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
              <Text style={styles.etaNote}>{parentLocation ? t('bus.eta_your_location') : t('bus.eta_home_location')}</Text>
            </View>
          )}

          {mapRegion && (
            <View style={styles.mapContainer}>
              <MapView style={styles.map} region={mapRegion}>
                <Marker coordinate={{ latitude: busData.location.latitude, longitude: busData.location.longitude }} title="Bus" />
                {busData.studentHome?.latitude && (
                  <Marker coordinate={{ latitude: busData.studentHome.latitude, longitude: busData.studentHome.longitude }} title="Home" pinColor="green" />
                )}
                {parentLocation && (
                  <Marker coordinate={parentLocation} title="Your Location" pinColor="orange" />
                )}
              </MapView>
            </View>
          )}
        </>
      )}

      {/* Driver info */}
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
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  refreshBtn: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
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
  driverCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, ...shadow.sm },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  driverMeta: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
});
