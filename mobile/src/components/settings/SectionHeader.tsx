import { Text, StyleSheet } from 'react-native';
import { useColors } from '../../store/themeStore';
import { spacing, font } from '../../theme';

// Uppercase section label that separates groups of settings rows.
export default function SectionHeader({ title, first }: { title: string; first?: boolean }) {
  const colors = useColors();
  return <Text style={[styles.title, { color: colors.textMuted }, first && { marginTop: spacing.xs }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  title: {
    fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
});
