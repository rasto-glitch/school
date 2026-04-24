import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Users, User, MessageSquare, Settings } from 'lucide-react-native';
import HouseIcon from '../components/HouseIcon';
import CalendarCheckIcon from '../components/CalendarCheckIcon';
import BookOpenIcon from '../components/BookOpenIcon';
import HeaderBrand from '../components/HeaderBrand';
import { useColors, useIsDark } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import SupervisorDashboardScreen from '../screens/supervisor/SupervisorDashboardScreen';
import SupervisorAttendanceScreen from '../screens/supervisor/SupervisorAttendanceScreen';
import SupervisorContentScreen from '../screens/supervisor/SupervisorContentScreen';
import SupervisorStudentsScreen from '../screens/supervisor/SupervisorStudentsScreen';
import SupervisorMeScreen from '../screens/supervisor/SupervisorMeScreen';
import ChatListScreen from '../screens/chat/ChatListScreen';
import { chatApi } from '../services/api';
import { useSocketStore } from '../store/socketStore';

function TabBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const Tab = createBottomTabNavigator();
const ICON_SIZE = 22;
const INDICATOR_WIDTH = 32;

export default function SupervisorTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const navigation = useNavigation<any>();
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;
  const { socket } = useSocketStore();
  const [chatCount, setChatCount] = useState(0);
  const chatListActive = useRef(false);
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;

  const tabCount = 3
    + (feat('attendance') ? 1 : 0)
    + (feat('chat') ? 1 : 0)
    + 1; // Me tab

  useEffect(() => {
    if (!screenWidth) return;
    const tabW = screenWidth / tabCount;
    const target = activeIndex * tabW + (tabW - INDICATOR_WIDTH) / 2;
    Animated.spring(indicatorX, {
      toValue: target,
      useNativeDriver: true,
      tension: 140,
      friction: 16,
    }).start();
  }, [activeIndex, screenWidth, tabCount, indicatorX]);

  const fetchChatCount = useCallback(() => {
    chatApi.getUnreadCount().then(r => { if (!chatListActive.current) setChatCount(r.data?.count ?? 0); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchChatCount();
    const interval = setInterval(fetchChatCount, 30000);
    return () => clearInterval(interval);
  }, [fetchChatCount]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = () => {
      if (!chatListActive.current) setChatCount(prev => prev + 1);
    };
    socket.on('chat:message', onMessage);
    return () => { socket.off('chat:message', onMessage); };
  }, [socket]);

  const headerIconBg = isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight;
  const headerIconColor = isDark ? '#FFFFFF' : colors.primary;
  const activeFill = isDark ? '#FFFFFF' : colors.primary;

  const SettingsButton = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('SupervisorSettings')}
      style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
      activeOpacity={0.7}
    >
      <Settings size={18} color={headerIconColor} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenListeners={{
          state: (e) => {
            const s: any = (e.data as any)?.state;
            if (s && typeof s.index === 'number') setActiveIndex(s.index);
          },
        }}
        screenOptions={{
          headerShown: false,
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
          name="SupervisorDashboard"
          component={SupervisorDashboardScreen}
          options={{ tabBarLabel: t('nav.dashboard', 'Dashboard'), tabBarIcon: ({ color, focused }) => (
            <HouseIcon
              size={ICON_SIZE}
              color={color}
              fillColor={focused ? activeFill : 'none'}
              doorColor={focused ? (isDark ? '#000000' : colors.card) : 'none'}
            />
          ) }}
        />
        {feat('attendance') ? (
          <Tab.Screen
            name="SupervisorAttendance"
            component={SupervisorAttendanceScreen}
            options={{ tabBarLabel: t('nav.attendance', 'Attendance'), tabBarIcon: ({ color, focused }) => <CalendarCheckIcon size={ICON_SIZE} color={color} fillColor={focused ? activeFill : 'none'} /> }}
          />
        ) : null}
        <Tab.Screen
          name="SupervisorContent"
          component={SupervisorContentScreen}
          options={{ tabBarLabel: t('nav.content', 'Content'), tabBarIcon: ({ color, focused }) => <BookOpenIcon size={ICON_SIZE} color={color} fillColor={focused ? activeFill : 'none'} /> }}
        />
        <Tab.Screen
          name="SupervisorStudents"
          component={SupervisorStudentsScreen}
          options={{ tabBarLabel: t('nav.students', 'Students'), tabBarIcon: ({ color, focused }) => <Users size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} /> }}
        />
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
              headerShown: true,
              headerTitle: '',
              headerLeft: () => <HeaderBrand />,
              headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
              headerShadowVisible: false,
              tabBarLabel: t('nav.chat', 'Chat'),
              tabBarIcon: ({ color, focused }) => (
                <View>
                  <MessageSquare size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} />
                  <TabBadge count={chatCount} />
                </View>
              ),
            }}
          />
        ) : null}
        <Tab.Screen
          name="SupervisorMe"
          component={SupervisorMeScreen}
          options={{
            tabBarLabel: t('nav.me', 'Me'),
            tabBarIcon: ({ color, focused }) => <User size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} />,
            headerShown: true,
            headerTitle: '',
            headerLeft: () => <HeaderBrand />,
            headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
            headerTintColor: colors.primary,
            headerShadowVisible: false,
            headerRight: () => <SettingsButton />,
          }}
        />
      </Tab.Navigator>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.activeTopLine,
          {
            bottom: 60 + insets.bottom - 1,
            backgroundColor: isDark ? '#FFFFFF' : colors.primary,
            transform: [{ translateX: indicatorX }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 12,
  },
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  activeTopLine: {
    position: 'absolute',
    left: 0,
    width: 32, height: 2,
    borderRadius: 1,
  },
});
