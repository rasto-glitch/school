import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Navigation, ChevronLeft, Building2, Home } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { colors, spacing, radius, font, shadow } from '../../theme';

type ResidenceType = 'apartment' | 'house';

export default function SetPickupLocationScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [region, setRegion] = useState<Region | null>(null);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [residenceType, setResidenceType] = useState<ResidenceType | null>(null);
  const [blockNumber, setBlockNumber] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    parentApi.getPickupLocation().then(r => {
      const { latitude, longitude, residenceType: rt, blockNumber: bn } = r.data;
      if (latitude && longitude) {
        const loc = { latitude, longitude };
        setPin(loc);
        setRegion({ ...loc, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      }
      if (rt) setResidenceType(rt as ResidenceType);
      if (bn) setBlockNumber(bn);
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
      await parentApi.updatePickupLocation(
        pin.latitude,
        pin.longitude,
        residenceType ?? undefined,
        blockNumber.trim() || undefined,
      );
      Alert.alert('', t('pickup.saved'), [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch {
      Alert.alert(t('pickup.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const residenceOptions: { type: ResidenceType; label: string; Icon: typeof Home }[] = [
    { type: 'apartment', label: 'Apartment', Icon: Building2 },
    { type: 'house', label: 'House', Icon: Home },
  ];

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

        {pin && (
          <View style={styles.hintBadge}>
            <Text style={styles.hintText}>{t('pickup.drag_hint')}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.gpsBtn} onPress={useCurrentLocation} disabled={gettingLocation}>
          {gettingLocation
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Navigation size={20} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      {/* Bottom panel */}
      <ScrollView style={styles.bottom} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }}>
        {/* Residence type */}
        <Text style={styles.sectionLabel}>Residence Type</Text>
        <View style={styles.residenceRow}>
          {residenceOptions.map(({ type, label, Icon }) => {
            const selected = residenceType === type;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.residenceCard, selected && styles.residenceCardSelected]}
                onPress={() => setResidenceType(type)}
                activeOpacity={0.7}
              >
                <View style={[styles.residenceIconBox, selected && styles.residenceIconBoxSelected]}>
                  <Icon size={22} color={selected ? colors.primary : colors.textMuted} />
                </View>
                <Text style={[styles.residenceLabel, selected && styles.residenceLabelSelected]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Block / Building number */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
          {residenceType === 'apartment' ? 'Building Number' : 'Block Number'}
        </Text>
        <TextInput
          style={styles.blockInput}
          placeholder={residenceType === 'apartment' ? 'e.g. Building A or Building 3' : 'e.g. Block 1 or Block B'}
          placeholderTextColor={colors.textMuted}
          value={blockNumber}
          onChangeText={setBlockNumber}
        />

        {/* Pin coords */}
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
      </ScrollView>
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
    backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.md,
    maxHeight: 320,
  },
  sectionLabel: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  residenceRow: { flexDirection: 'row', gap: spacing.sm },
  residenceCard: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: spacing.md,
    borderRadius: radius.md, borderWidth: 2, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  residenceCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  residenceIconBox: {
    width: 44, height: 44, borderRadius: radius.sm,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  residenceIconBoxSelected: { backgroundColor: 'rgba(79,70,229,0.12)' },
  residenceLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  residenceLabelSelected: { color: colors.primary },
  blockInput: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: font.sm, color: colors.text,
    marginBottom: spacing.md,
  },
  noPinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  noPinText: { fontSize: font.sm, color: colors.textMuted },
  coordText: { fontSize: font.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'], marginBottom: spacing.sm },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
});
