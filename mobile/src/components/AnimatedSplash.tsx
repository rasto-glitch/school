import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

// How far past screen-center the S travels on its rightward sweep
const TRAVEL_RIGHT = Math.min(width * 0.22, 110);

const BIG_SCALE = 1.35;   // Size while spotlit in the center
const NORMAL_SCALE = 1.0; // Size when it finally sits next to "cholify"

export default function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const sOpacity = useRef(new Animated.Value(0)).current;
  const sScale = useRef(new Animated.Value(0.5)).current;
  const sTranslateX = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateX = useRef(new Animated.Value(-14)).current;
  const rootOpacity = useRef(new Animated.Value(1)).current;

  // Guard so the sequence only kicks off on the first layout callback
  const started = useRef(false);

  const startSequence = (initialX: number) => {
    sTranslateX.setValue(initialX);

    const rightX = initialX + TRAVEL_RIGHT;
    const finalX = 0; // Natural position in the row — flush against "cholify"

    Animated.sequence([
      // 1) S fades in at screen center, bigger than normal (pop-in)
      Animated.parallel([
        Animated.timing(sOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(sScale, {
          toValue: BIG_SCALE,
          duration: 600,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(250),

      // 2) Glide right while shrinking down to normal size
      Animated.parallel([
        Animated.timing(sTranslateX, {
          toValue: rightX,
          duration: 650,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sScale, {
          toValue: NORMAL_SCALE,
          duration: 650,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(180),

      // 3) Swing left to the final home while "cholify" reveals in parallel
      Animated.parallel([
        Animated.timing(sTranslateX, {
          toValue: finalX,
          duration: 700,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(250),
          Animated.parallel([
            Animated.timing(textOpacity, {
              toValue: 1,
              duration: 450,
              useNativeDriver: true,
            }),
            Animated.timing(textTranslateX, {
              toValue: 0,
              duration: 450,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),

      // 4) Hold the logo, then fade the splash out into the app
      Animated.delay(900),
      Animated.timing(rootOpacity, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinish();
    });
  };

  const onTextLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    if (started.current) return;
    started.current = true;
    // Row layout is [S][cholify] centered on screen. S's *natural* center sits
    // textWidth/2 to the left of screen-center, so we shift it right by that
    // amount to start the animation at the true center of the screen.
    const textWidth = e.nativeEvent.layout.width;
    startSequence(textWidth / 2);
  };

  useEffect(() => {
    // Fallback safety: if layout never fires for some reason, run with a
    // best-guess starting offset after a beat so the splash still completes.
    const t = setTimeout(() => {
      if (!started.current) {
        started.current = true;
        startSequence(100);
      }
    }, 400);
    return () => clearTimeout(t);
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
            onLayout={onTextLayout}
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sGlyph: {
    width: 116,
    height: 116,
    // 17px breathing room between the S and "cholify" — roughly the same
    // visual rhythm as the h-to-o letter spacing in Readex Pro Bold.
    marginRight: 17,
  },
  text: {
    fontFamily: 'ReadexPro_700Bold',
    fontSize: 64,
    color: '#FFFFFF',
    includeFontPadding: false,
    lineHeight: 72,
    // Push the baseline down so "cholify" sits with the bottom of the S
    // glyph instead of floating above it; the row reads as one word.
    marginTop: 32,
  },
});
