import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, CalendarCheck, BookOpen, Users, Bell, User } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { teacherApi } from '../services/api';
import TeacherDashboardScreen from '../screens/teacher/TeacherDashboardScreen';
import TeacherAttendanceScreen from '../screens/teacher/TeacherAttendanceScreen';
import TeacherContentScreen from '../screens/teacher/TeacherContentScreen';
import TeacherStudentsScreen from '../screens/teacher/TeacherStudentsScreen';
import TeacherNotificationsScreen from '../screens/teacher/TeacherNotificationsScreen';
import TeacherMeScreen from '../screens/teacher/TeacherMeScreen';

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

export default function TeacherTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;
  const { socket } = useSocketStore();
  const [notifCount, setNotifCount] = useState(0);
  const notifActive = useRef(false);

  const fetchNotifCount = useCallback(() => {
    teacherApi.getUnreadCount()
      .then(r => { if (!notifActive.current) setNotifCount(r.data?.count ?? 0); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchNotifCount();
    const interval = setInterval(fetchNotifCount, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifCount]);

  useEffect(() => {
    if (!socket) return;
    const onNotif = () => {
      if (!notifActive.current) setNotifCount(prev => prev + 1);
    };
    socket.on('notification', onNotif);
    return () => { socket.off('notification', onNotif); };
  }, [socket]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
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
        options={{ tabBarLabel: t('nav.dashboard', 'Dashboard'), tabBarIcon: ({ color }) => <Home size={ICON_SIZE} color={color} /> }}
      />
      {feat('attendance') ? (
        <Tab.Screen
          name="TeacherAttendance"
          component={TeacherAttendanceScreen}
          options={{ tabBarLabel: t('nav.attendance', 'Attendance'), tabBarIcon: ({ color }) => <CalendarCheck size={ICON_SIZE} color={color} /> }}
        />
      ) : null}
      <Tab.Screen
        name="TeacherContent"
        component={TeacherContentScreen}
        options={{ tabBarLabel: 'Content', tabBarIcon: ({ color }) => <BookOpen size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="TeacherStudents"
        component={TeacherStudentsScreen}
        options={{ tabBarLabel: t('nav.students', 'Students'), tabBarIcon: ({ color }) => <Users size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="TeacherNotifications"
        component={TeacherNotificationsScreen}
        listeners={{
          tabPress: () => { setNotifCount(0); notifActive.current = true; },
          focus: () => { setNotifCount(0); notifActive.current = true; },
          blur: () => { notifActive.current = false; },
        }}
        options={{
          tabBarLabel: t('nav.notifications', 'Notifications'),
          tabBarIcon: ({ color }) => (
            <View>
              <Bell size={ICON_SIZE} color={color} />
              <TabBadge count={notifCount} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="TeacherMe"
        component={TeacherMeScreen}
        options={{
          tabBarLabel: t('nav.me', 'Me'),
          tabBarIcon: ({ color }) => <User size={ICON_SIZE} color={color} />,
          headerShown: true,
          headerTitle: t('nav.me', 'Me'),
          headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.primary,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
