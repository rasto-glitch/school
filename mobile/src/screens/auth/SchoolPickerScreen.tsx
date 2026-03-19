import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GraduationCap, ChevronRight } from 'lucide-react-native';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, radius, font, shadow } from '../../theme';
import type { School } from '../../types';

export default function SchoolPickerScreen() {
  const { setSelectedSchool } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.getSchools()
      .then(r => setSchools(r.data || []))
      .catch(() => Alert.alert('Error', 'Could not load schools. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brand}>
        <View style={styles.logoBox}>
          <GraduationCap size={32} color={colors.textInverse} />
        </View>
        <Text style={styles.title}>School Portal</Text>
        <Text style={styles.subtitle}>Select your school to continue</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
      ) : schools.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No schools found.</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {schools.map(s => (
            <TouchableOpacity
              key={s.id}
              style={styles.schoolCard}
              onPress={() => setSelectedSchool(s)}
              activeOpacity={0.7}
            >
              <View style={styles.schoolIcon}>
                <GraduationCap size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.schoolName}>{s.name}</Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoBox: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md, ...shadow.md,
  },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  list: { flex: 1 },
  schoolCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  schoolIcon: {
    width: 40, height: 40, borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  schoolName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  emptyBox: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: font.md, color: colors.textMuted },
});
