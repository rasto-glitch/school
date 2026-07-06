import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Users, Bell, User, MessageSquare, Settings, Clock } from 'lucide-react-native';
import HouseIcon from '../components/HouseIcon';
import CalendarCheckIcon from '../components/CalendarCheckIcon';
import BookOpenIcon from '../components/BookOpenIcon';
import HeaderBrand from '../components/HeaderBrand';
import { makeSlideTransition } from './tabSlide';
import { useColors, useIsDark } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { teacherApi, chatApi } from '../services/api';
import TeacherDashboardScreen from '../screens/teacher/TeacherDashboardScreen';
import TeacherAttendanceScreen from '../screens/teacher/TeacherAttendanceScreen';
import TeacherContentScreen from '../screens/teacher/TeacherContentScreen';
import TeacherStudentsScreen from '../screens/teacher/TeacherStudentsScreen';
import TeacherMeScreen from '../screens/teacher/TeacherMeScreen';
import StaffAttendanceScreen from '../screens/staff/StaffAttendanceScreen';
import ChatListScreen from '../screens/chat/ChatListScreen';

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

export default function TeacherTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const navigation = useNavigation<any>();
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;
  const showClockIn = school?.features?.staff_attendance === true;
  const { socket } = useSocketStore();
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeRoute, setActiveRoute] = useState('TeacherDashboard');
  const indicatorX = useRef(new Animated.Value(0)).current;

  const tabCount = 3
    + (feat('attendance') ? 1 : 0)
    + (feat('chat') ? 1 : 0)
    + (showClockIn ? 1 : 0)
    + 1;

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

  const [notifCount, setNotifCount] = useState(0);
  const fetchNotifCount = useCallback(() => {
    teacherApi.getUnreadCount()
      .then(r => setNotifCount(r.data?.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchNotifCount();
    const interval = setInterval(fetchNotifCount, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifCount]);

  useEffect(() => {
    if (!socket) return;
    const onNotif = () => setNotifCount(prev => prev + 1);
    socket.on('notification', onNotif);
    return () => { socket.off('notification', onNotif); };
  }, [socket]);

  const [chatCount, setChatCount] = useState(0);
  const chatListActive = useRef(false);
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

  const NotificationBell = () => (
    <TouchableOpacity
      onPress={() => { setNotifCount(0); navigation.navigate('TeacherNotifications'); }}
      style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
      activeOpacity={0.7}
    >
      <Bell size={18} color={headerIconColor} />
      {notifCount > 0 && (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{notifCount > 99 ? '99+' : notifCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const SettingsButton = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('TeacherSettings')}
      style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
      activeOpacity={0.7}
    >
      <Settings size={18} color={headerIconColor} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Fixed header — lives OUTSIDE the navigator so the tab slide moves
          only the body, like Facebook (the bottom bar is already fixed). */}
      <View style={{ backgroundColor: colors.card, paddingTop: insets.top }}>
        <View style={styles.headerRow}>
          <HeaderBrand />
          {activeRoute === 'TeacherMe' ? SettingsButton() : NotificationBell()}
        </View>
      </View>
      <View style={{ flex: 1 }}>
      <Tab.Navigator
        detachInactiveScreens={false}
        screenListeners={{
          state: (e) => {
            const s: any = (e.data as any)?.state;
            if (s && typeof s.index === 'number') {
              setActiveIndex(s.index);
              const rname = s.routes?.[s.index]?.name;
              if (rname) setActiveRoute(rname);
            }
          },
        }}
        screenOptions={{
          ...makeSlideTransition(screenWidth),
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
          name="TeacherDashboard"
          component={TeacherDashboardScreen}
          options={{
            tabBarLabel: t('nav.dashboard', 'Dashboard'),
            tabBarIcon: ({ color, focused }) => (
              <HouseIcon
                size={ICON_SIZE}
                color={color}
                fillColor={focused ? activeFill : 'none'}
                doorColor={focused ? (isDark ? '#000000' : colors.card) : 'none'}
              />
            ),
          }}
        />
        {feat('attendance') ? (
          <Tab.Screen
            name="TeacherAttendance"
            component={TeacherAttendanceScreen}
            options={{
              tabBarLabel: t('nav.attendance', 'Attendance'),
              tabBarIcon: ({ color, focused }) => <CalendarCheckIcon size={ICON_SIZE} color={color} fillColor={focused ? activeFill : 'none'} />,
            }}
          />
        ) : null}
        <Tab.Screen
          name="TeacherContent"
          component={TeacherContentScreen}
          options={{
            tabBarLabel: t('nav.content', 'Content'),
            tabBarIcon: ({ color, focused }) => <BookOpenIcon size={ICON_SIZE} color={color} fillColor={focused ? activeFill : 'none'} />,
          }}
        />
        <Tab.Screen
          name="TeacherStudents"
          component={TeacherStudentsScreen}
          options={{
            tabBarLabel: t('nav.students', 'Students'),
            tabBarIcon: ({ color, focused }) => <Users size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} />,
          }}
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
        {showClockIn ? (
          <Tab.Screen
            name="TeacherClockIn"
            component={StaffAttendanceScreen}
            initialParams={{ embedded: true }}
            options={{
              tabBarLabel: t('nav.clock_in', 'Clock In'),
              tabBarIcon: ({ color, focused }) => <Clock size={ICON_SIZE} color={focused ? (isDark ? colors.primary : '#FFFFFF') : color} fill={focused ? activeFill : 'transparent'} />,
            }}
          />
        ) : null}
        <Tab.Screen
          name="TeacherMe"
          component={TeacherMeScreen}
          options={{
            tabBarLabel: t('nav.me', 'Me'),
            tabBarIcon: ({ color, focused }) => <User size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} />,
          }}
        />
      </Tab.Navigator>
      </View>
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
  headerRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    direction: 'ltr',
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 12,
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
  activeTopLine: {
    position: 'absolute',
    left: 0,
    width: 32, height: 2,
    borderRadius: 1,
  },
});
