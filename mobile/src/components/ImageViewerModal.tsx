import { useRef, useState } from 'react';
import {
  Modal, View, Animated, PanResponder, TouchableOpacity, StyleSheet,
  StatusBar, Dimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Download } from 'lucide-react-native';

interface Props {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
  onDownload?: () => void;
  downloading?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export default function ImageViewerModal({ visible, uri, onClose, onDownload, downloading }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const txAnim = useRef(new Animated.Value(0)).current;
  const tyAnim = useRef(new Animated.Value(0)).current;

  const lastScale = useRef(1);
  const lastTx = useRef(0);
  const lastTy = useRef(0);
  const initialDistance = useRef(0);
  const initialScale = useRef(1);
  const lastTap = useRef(0);

  const reset = (animated = false) => {
    lastScale.current = 1;
    lastTx.current = 0;
    lastTy.current = 0;
    if (animated) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
        Animated.spring(txAnim, { toValue: 0, useNativeDriver: true }),
        Animated.spring(tyAnim, { toValue: 0, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(1);
      txAnim.setValue(0);
      tyAnim.setValue(0);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          initialDistance.current = Math.hypot(dx, dy);
          initialScale.current = lastScale.current;
        } else if (touches.length === 1) {
          const now = Date.now();
          if (now - lastTap.current < 280) {
            // double-tap toggles between 1x and 2.5x
            if (lastScale.current > 1) {
              reset(true);
            } else {
              lastScale.current = 2.5;
              Animated.spring(scaleAnim, { toValue: 2.5, useNativeDriver: true }).start();
            }
          }
          lastTap.current = now;
        }
      },
      onPanResponderMove: (e, gesture) => {
        const touches = e.nativeEvent.touches;
        if (touches.length === 2 && initialDistance.current > 0) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.hypot(dx, dy);
          const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialScale.current * (dist / initialDistance.current)));
          scaleAnim.setValue(next);
          lastScale.current = next;
        } else if (touches.length === 1 && lastScale.current > 1) {
          txAnim.setValue(lastTx.current + gesture.dx);
          tyAnim.setValue(lastTy.current + gesture.dy);
        }
      },
      onPanResponderRelease: () => {
        if (lastScale.current <= 1.01) {
          reset(true);
        } else {
          // @ts-ignore — read current animated value
          lastTx.current = txAnim._value;
          // @ts-ignore
          lastTy.current = tyAnim._value;
        }
      },
    }),
  ).current;

  const handleClose = () => {
    reset(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={styles.bg}>
        <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
          <TouchableOpacity style={styles.iconBtn} onPress={handleClose} hitSlop={12}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
          {onDownload && (
            <TouchableOpacity style={styles.iconBtn} onPress={onDownload} hitSlop={12} disabled={downloading}>
              {downloading ? <ActivityIndicator color="#fff" size="small" /> : <Download size={22} color="#fff" />}
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.imageWrap} {...panResponder.panHandlers}>
          {uri && (
            <Animated.Image
              source={{ uri }}
              style={{
                width,
                height,
                transform: [
                  { translateX: txAnim },
                  { translateY: tyAnim },
                  { scale: scaleAnim },
                ],
              }}
              resizeMode="contain"
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 8,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  imageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
