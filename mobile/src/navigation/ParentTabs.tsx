import { useEffect, useRef, useState, useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { GraduationCap, Bell, User, Settings, MessageSquare } from 'lucide-react-native';
import HouseIcon from '../components/HouseIcon';
import BusIcon from '../components/BusIcon';
import FeedScreen from '../screens/parent/FeedScreen';
import BusTrackingScreen from '../screens/parent/BusTrackingScreen';
import MeScreen from '../screens/parent/MeScreen';
import LearnScreen from '../screens/parent/LearnScreen';
import ChatListScreen from '../screens/chat/ChatListScreen';
import { useColors, useIsDark } from '../store/themeStore';
import { useBadgeStore } from '../store/badgeStore';
import { font } from '../theme';
import { parentApi, chatApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';

const Tab = createBottomTabNavigator();

function TabBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

function TabIconWrap({ focused, isDark, children }: { focused: boolean; isDark: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.iconWrap}>
      {focused && isDark && <View style={styles.activeTopLine} />}
      {children}
    </View>
  );
}

export default function ParentTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const navigation = useNavigation<any>();
  const { school } = useAuthStore();
  const { socket } = useSocketStore();
  const [chatCount, setChatCount] = useState(0);
  const {
    unreadCount, setUnreadCount,
    setReportCount, setBookingCount, setHomeworkCount, setAssignmentCount,
  } = useBadgeStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatListActive = useRef(false);

  const feat = (key: string) => school?.features?.[key] !== false;

  const fetchCounts = useCallback(() => {
    parentApi.getUnreadCount()
      .then(r => setUnreadCount(r.data?.count ?? 0))
      .catch(() => {});
    parentApi.getContentUnreadCounts()
      .then(r => {
        setHomeworkCount(r.data?.homework ?? 0);
        setAssignmentCount(r.data?.assignment ?? 0);
        setReportCount(r.data?.report ?? 0);
        setBookingCount(r.data?.booking ?? 0);
      })
      .catch(() => {});
    chatApi.getUnreadCount()
      .then(r => { if (!chatListActive.current) setChatCount(r.data?.count ?? 0); })
      .catch(() => {});
  }, [setUnreadCount, setReportCount, setBookingCount, setHomeworkCount, setAssignmentCount]);

  useEffect(() => {
    fetchCounts();
    intervalRef.current = setInterval(fetchCounts, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchCounts]);

  // Increment chat badge in real-time when a message arrives and user is not on the Chat tab
  useEffect(() => {
    if (!socket) return;
    const onMessage = () => {
      if (!chatListActive.current) setChatCount(prev => prev + 1);
    };
    socket.on('chat:message', onMessage);
    return () => { socket.off('chat:message', onMessage); };
  }, [socket]);

  // Real-time: bump the right badge the moment the server emits a notification
  useEffect(() => {
    if (!socket) return;
    const onNotif = (payload: { type?: string } = {}) => {
      setUnreadCount(useBadgeStore.getState().unreadCount + 1);
      switch (payload.type) {
        case 'homework':
          setHomeworkCount(useBadgeStore.getState().homeworkCount + 1);
          break;
        case 'assignment':
          setAssignmentCount(useBadgeStore.getState().assignmentCount + 1);
          break;
        case 'report':
          setReportCount(useBadgeStore.getState().reportCount + 1);
          break;
        case 'appointment':
          setBookingCount(useBadgeStore.getState().bookingCount + 1);
          break;
      }
    };
    socket.on('notification', onNotif);
    return () => { socket.off('notification', onNotif); };
  }, [socket, setUnreadCount, setHomeworkCount, setAssignmentCount, setReportCount, setBookingCount]);

  const headerIconBg = isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight;
  const headerIconColor = isDark ? '#FFFFFF' : colors.primary;

  // Notification bell — shown in header for all tabs except Me
  const NotificationBell = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
      activeOpacity={0.7}
    >
      <Bell size={18} color={headerIconColor} />
      {unreadCount > 0 && (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  // Settings button — shown in header only on Me tab
  const SettingsButton = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('Settings')}
      style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
      activeOpacity={0.7}
    >
      <Settings size={18} color={headerIconColor} />
    </TouchableOpacity>
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
        headerTitleStyle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
        headerShadowVisible: false,
        headerRight: () => <NotificationBell />,
        tabBarActiveTintColor: isDark ? '#FFFFFF' : colors.primary,
        tabBarInactiveTintColor: isDark ? '#FFFFFF' : colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
          direction: 'ltr',
        } as any,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          headerTitle: t('dashboard.title'),
          tabBarLabel: t('dashboard.title'),
          tabBarIcon: ({ color, focused }) => (
            <TabIconWrap focused={focused} isDark={isDark}>
              <HouseIcon
                size={22}
                color={color}
                fillColor={focused && isDark ? '#FFFFFF' : 'none'}
                doorColor={focused && isDark ? '#000000' : 'none'}
              />
            </TabIconWrap>
          ),
        }}
      />
      {feat('academic_portal') ? (
        <Tab.Screen
          name="Learn"
          component={LearnScreen}
          options={{
            headerTitle: t('nav.learn', 'Learn'),
            tabBarLabel: t('nav.learn', 'Learn'),
            tabBarIcon: ({ color, focused }) => (
              <TabIconWrap focused={focused} isDark={isDark}>
                <GraduationCap size={22} color={color} fill={focused && isDark ? '#FFFFFF' : 'transparent'} />
              </TabIconWrap>
            ),
          }}
        />
      ) : null}
      {feat('bus_tracking') ? (
        <Tab.Screen
          name="BusTracking"
          component={BusTrackingScreen}
          options={{
            headerTitle: t('nav.track_bus'),
            tabBarLabel: t('nav.track_bus'),
            tabBarIcon: ({ color, focused }) => {
              const strokeColor = focused && isDark ? '#000000' : color;
              return (
                <TabIconWrap focused={focused} isDark={isDark}>
                  <BusIcon size={22} color={strokeColor} fillColor={focused && isDark ? '#FFFFFF' : 'none'} />
                </TabIconWrap>
              );
            },
          }}
        />
      ) : null}
      {feat('chat') ? (
        <Tab.Screen
          name="ChatList"
          component={ChatListScreen}
          listeners={{
            tabPress: () => { setChatCount(0); chatListActive.current = true; },
            focus: () => { setChatCount(0); chatListActive.current = true; },
            blur: () => { chatListActive.current = false; },
          }}
          options={{
            headerTitle: t('nav.chat', 'Chat'),
            tabBarLabel: t('nav.chat', 'Chat'),
            tabBarIcon: ({ color, focused }) => (
              <TabIconWrap focused={focused} isDark={isDark}>
                <View>
                  <MessageSquare size={22} color={color} fill={focused && isDark ? '#FFFFFF' : 'transparent'} />
                  <TabBadge count={chatCount} />
                </View>
              </TabIconWrap>
            ),
          }}
        />
      ) : null}
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{
          headerTitle: t('nav.me', 'Me'),
          tabBarLabel: t('nav.me', 'Me'),
          tabBarIcon: ({ color, focused }) => (
            <TabIconWrap focused={focused} isDark={isDark}>
              <User size={22} color={color} fill={focused && isDark ? '#FFFFFF' : 'transparent'} />
            </TabIconWrap>
          ),
          headerRight: () => <SettingsButton />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 14, height: 14, borderRadius: 7,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 2,
  },
  bellBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  activeTopLine: {
    position: 'absolute',
    top: -8,
    width: 32, height: 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },
});
