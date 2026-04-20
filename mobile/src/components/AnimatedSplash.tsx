import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

// How far the S travels to the right before swinging left to its final home
const TRAVEL = Math.min(width * 0.28, 130);
// Final offset of the S from center-x — sits just left of "cholify"
const FINAL_X = -Math.min(width * 0.22, 95);

export default function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const sOpacity = useRef(new Animated.Value(0)).current;
  const sScale = useRef(new Animated.Value(0.6)).current;
  const sTranslateX = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateX = useRef(new Animated.Value(-12)).current;
  const rootOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const seq = Animated.sequence([
      // 1) S fades in and pops to full size in the center (0 → 500ms)
      Animated.parallel([
        Animated.timing(sOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(sScale, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(200),

      // 2) S glides right (500 → 1100ms)
      Animated.timing(sTranslateX, {
        toValue: TRAVEL,
        duration: 600,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(150),

      // 3) S glides all the way left to its final home next to "cholify"
      Animated.timing(sTranslateX, {
        toValue: FINAL_X,
        duration: 650,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),

      // 4) "cholify" slides in and fades in from the S's right edge
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(textTranslateX, {
          toValue: 0,
          duration: 450,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),

      // 5) Hold the logo, then fade the whole splash out
      Animated.delay(800),
      Animated.timing(rootOpacity, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]);

    seq.start(({ finished }) => {
      if (finished) onFinish();
    });
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: rootOpacity }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#6D66F0" stopOpacity="1" />
            <Stop offset="1" stopColor="#4F46E5" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#bg)" />
      </Svg>

      <View style={styles.center} pointerEvents="none">
        <View style={styles.row}>
          <Animated.Image
            source={require('../../assets/splash-s.png')}
            resizeMode="contain"
            style={[
              styles.sGlyph,
              {
                opacity: sOpacity,
                transform: [{ translateX: sTranslateX }, { scale: sScale }],
              },
            ]}
          />
          <Animated.Text
            style={[
              styles.text,
              {
                opacity: textOpacity,
                transform: [{ translateX: textTranslateX }],
              },
            ]}
          >
            cholify
          </Animated.Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sGlyph: {
    width: 110,
    height: 110,
    // Pull the text slightly into the S's negative space so "Scholify" reads as one word
    marginRight: -18,
  },
  text: {
    fontFamily: 'ReadexPro_700Bold',
    fontSize: 56,
    color: '#FFFFFF',
    includeFontPadding: false,
    lineHeight: 64,
  },
});
