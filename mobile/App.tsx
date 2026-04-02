import './src/i18n';
import './src/tasks/locationTask'; // register background task before anything renders
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import Navigation, { navigationRef } from './src/navigation';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useRTL } from './src/hooks/useRTL';
import { useAuthStore } from './src/store/authStore';
import { useSocketStore } from './src/store/socketStore';

interface BannerInfo {
  title: string;
  body: string;
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
          <Text style={{ fontSize: 20 }}>💬</Text>
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
  const { user, token } = useAuthStore();
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
      const convId = (data as any)?.conversationId as string | undefined;

      if (type === 'chat') {
        if (!navigationRef.isReady()) return;
        const route = navigationRef.getCurrentRoute();
        const routeName = route?.name;
        const routeParams = route?.params as any;

        // Already viewing this exact conversation — socket shows the message
        if (routeName === 'Chat' && convId && routeParams?.conversation?.id === convId) return;
        // In the chat list — sound already plays, no banner needed
        if ((routeName as string) === 'ChatList') return;

        if (title) {
          bannerKey.current += 1;
          setBanner({ title, body: body ?? '', conversationId: convId });
        }
      } else {
        // Non-chat notifications keep the original Alert behaviour
        if (title) Alert.alert(title, body ?? '');
      }
    });

    return () => listener.remove();
  }, []);

  const handleBannerPress = () => {
    if (!navigationRef.isReady()) return;
    const tabScreen = user?.role === 'supervisor' ? 'SupervisorTabs' : user?.role === 'teacher' ? 'TeacherTabs' : 'ParentTabs';
    try {
      (navigationRef as any).navigate(tabScreen, { screen: 'ChatList' });
    } catch {}
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr' }}>
      <Navigation />
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
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppInner />
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
