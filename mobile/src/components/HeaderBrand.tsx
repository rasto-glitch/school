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
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
  },
  logo: {
    width: 28,
    height: 28,
    marginRight: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
