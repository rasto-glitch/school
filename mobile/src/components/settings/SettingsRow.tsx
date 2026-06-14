import { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

// One settings row: icon tile + label/sub + (chevron or custom right). The
// single source of truth for settings-row look across every role screen.
interface SettingsRowProps {
  icon: ReactNode;
  iconBg?: string;
  label: string;
  sub?: string;
  subColor?: string;
  onPress?: () => void;
  right?: ReactNode;          // overrides the default chevron
  showChevron?: boolean;
  disabled?: boolean;
}

export default function SettingsRow({
  icon, iconBg, label, sub, subColor, onPress, right, showChevron = true, disabled,
}: SettingsRowProps) {
  const colors = useColors();
  const s = makeStyles(colors);
  const Container: any = onPress ? TouchableOpacity : View;
  return (
    <Container style={s.row} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      <View style={[s.iconBox, { backgroundColor: iconBg || colors.bg }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        {sub ? <Text style={[s.sub, subColor ? { color: subColor } : null]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ? right : (onPress && showChevron ? <ChevronRight size={18} color={colors.textMuted} /> : null)}
    </Container>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: 2, ...shadow.sm,
  },
  iconBox: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.md, fontWeight: '600', color: colors.text },
  sub: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
});
