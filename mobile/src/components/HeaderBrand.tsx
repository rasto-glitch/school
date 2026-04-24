import { Image, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../store/themeStore';

export default function HeaderBrand() {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={[styles.name, { color: colors.text }]}>Scholify</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    // paddingHorizontal + gap don't get auto-flipped under I18nManager.isRTL,
    // so the spacing stays correct in Arabic/Kurdish (header is forced LTR).
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
