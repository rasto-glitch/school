import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Navigation, ChevronLeft } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { colors, spacing, radius, font, shadow } from '../../theme';

export default function SetPickupLocationScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [region, setRegion] = useState<Region | null>(null);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const mapRef = useRef<MapView>(null);

  // Load existing pickup location on mount
  useEffect(() => {
    parentApi.getPickupLocation().then(r => {
      const { latitude, longitude } = r.data;
      if (latitude && longitude) {
        const loc = { latitude, longitude };
        setPin(loc);
        setRegion({ ...loc, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      }
    }).catch(() => {});
  }, []);

  const useCurrentLocation = async () => {
    setGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('pickup.permission_denied'));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setPin(coords);
      const newRegion = { ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 };
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 500);
    } catch {
      Alert.alert(t('pickup.permission_denied'));
    } finally {
      setGettingLocation(false);
    }
  };

  const handleSave = async () => {
    if (!pin) return;
    setSaving(true);
    try {
      await parentApi.updatePickupLocation(pin.latitude, pin.longitude);
      Alert.alert('', t('pickup.saved'), [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch {
      Alert.alert(t('pickup.save_error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('pickup.title')}</Text>
          <Text style={styles.subtitle}>{t('pickup.subtitle')}</Text>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          region={region ?? { latitude: 36.19, longitude: 44.01, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
          onPress={(e) => setPin(e.nativeEvent.coordinate)}
        >
          {pin && (
            <Marker
              coordinate={pin}
              draggable
              onDragEnd={(e) => setPin(e.nativeEvent.coordinate)}
            />
          )}
        </MapView>

        {/* Drag hint */}
        {pin && (
          <View style={styles.hintBadge}>
            <Text style={styles.hintText}>{t('pickup.drag_hint')}</Text>
          </View>
        )}

        {/* Use current location button */}
        <TouchableOpacity style={styles.gpsBtn} onPress={useCurrentLocation} disabled={gettingLocation}>
          {gettingLocation
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Navigation size={20} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      {/* Bottom panel */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
        {!pin ? (
          <View style={styles.noPinRow}>
            <MapPin size={18} color={colors.textMuted} />
            <Text style={styles.noPinText}>{t('pickup.not_set')}</Text>
          </View>
        ) : (
          <Text style={styles.coordText}>
            {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, (!pin || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!pin || saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.saveBtnText}>{t('pickup.confirm')}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },
  hintBadge: {
    position: 'absolute', top: 12, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  hintText: { color: '#fff', fontSize: font.xs },
  gpsBtn: {
    position: 'absolute', bottom: 16, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
    ...shadow.md,
  },
  bottom: {
    backgroundColor: colors.card, padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm,
  },
  noPinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noPinText: { fontSize: font.sm, color: colors.textMuted },
  coordText: { fontSize: font.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
