import './src/i18n';
import './src/tasks/locationTask'; // register background task before anything renders
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useFonts, ReadexPro_700Bold } from '@expo-google-fonts/readex-pro';
import Navigation, { navigationRef } from './src/navigation';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useRTL } from './src/hooks/useRTL';
import { useAuthStore } from './src/store/authStore';
import { useColors } from './src/store/themeStore';
import { useSocketStore } from './src/store/socketStore';
import { getNotifEmoji, openNotificationTarget } from './src/utils/notificationNav';
import AnimatedSplash from './src/components/AnimatedSplash';
import ConsentGate from './src/components/ConsentGate';

interface BannerInfo {
  title: string;
  body: string;
  type?: string;
  relatedId?: string;
  conversationId?: string;
}

function NotificationBanner({ info, onDismiss, onPress }: { info: BannerInfo; onDismiss: () => void; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: -120, duration: 250, useNativeDriver: true }).start(onDismiss);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const handlePress = () => {
    Animated.timing(anim, { toValue: -120, duration: 200, useNativeDriver: true }).start(() => {
      onDismiss();
      onPress();
    });
  };

  return (
    <Animated.View style={[styles.banner, { top: insets.top + 8, transform: [{ translateY: anim }] }]}>
      <TouchableOpacity style={styles.bannerInner} onPress={handlePress} activeOpacity={0.92}>
        <View style={styles.bannerIcon}>
          <Text style={{ fontSize: 20 }}>{getNotifEmoji(info.type)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.bannerTitle} numberOfLines={1}>{info.title}</Text>
          {!!info.body && <Text style={styles.bannerBody} numberOfLines={1}>{info.body}</Text>}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function AppInner() {
  usePushNotifications();
  const isRTL = useRTL();
  const colors = useColors();
  const { token } = useAuthStore();
  const { connect, disconnect } = useSocketStore();

  useEffect(() => {
    if (token) connect(token);
    else disconnect();
  }, [token]);
  const [banner, setBanner] = useState<BannerInfo | null>(null);
  const bannerKey = useRef(0);

  useEffect(() => {
    const listener = Notifications.addNotificationReceivedListener(notification => {
      const { title, body, data } = notification.request.content;
      const type = (data as any)?.type as string | undefined;
      const relatedId = (data as any)?.relatedId as string | undefined;
      const conversationId = (data as any)?.conversationId as string | undefined;

      // Chat: suppress banner if user is already viewing this conversation or the chat list
      if (type === 'chat' && navigationRef.isReady()) {
        const route = navigationRef.getCurrentRoute();
        const routeName = route?.name as string | undefined;
        const routeParams = route?.params as any;
        const convId = conversationId || relatedId;
        if (routeName === 'Chat' && convId && routeParams?.conversation?.id === convId) return;
        if (routeName === 'ChatList') return;
      }

      // Learn posts: system + drop-down only, no in-app banner.
      if (type === 'post') return;

      if (title) {
        bannerKey.current += 1;
        setBanner({ title, body: body ?? '', type, relatedId, conversationId });
      }
    });

    // Tapping a system notification (app backgrounded) — same deep-link behaviour
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      openNotificationTarget({
        type: data?.type,
        relatedId: data?.relatedId,
        conversationId: data?.conversationId,
      });
    });

    return () => {
      listener.remove();
      responseListener.remove();
    };
  }, []);

  const handleBannerPress = () => {
    if (!banner) return;
    openNotificationTarget({
      type: banner.type,
      relatedId: banner.relatedId,
      conversationId: banner.conversationId,
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, direction: isRTL ? 'rtl' : 'ltr' }}>
      <ConsentGate>
        <Navigation />
      </ConsentGate>
      {banner && (
        <NotificationBanner
          key={bannerKey.current}
          info={banner}
          onDismiss={() => setBanner(null)}
          onPress={handleBannerPress}
        />
      )}
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ ReadexPro_700Bold });
  const [splashDone, setSplashDone] = useState(false);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {fontsLoaded && <AppInner />}
      {(!splashDone || !fontsLoaded) && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#4F46E5' }]}>
          {fontsLoaded && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    borderRadius: 16,
    backgroundColor: 'rgba(30,30,30,0.96)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  bannerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 2 },
  bannerBody: { fontSize: 12, color: 'rgba(255,255,255,0.72)' },
});
