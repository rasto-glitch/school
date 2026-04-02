import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, CalendarCheck, BookOpen, Users, Bell, User, MessageSquare } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { teacherApi, chatApi } from '../services/api';
import TeacherDashboardScreen from '../screens/teacher/TeacherDashboardScreen';
import TeacherAttendanceScreen from '../screens/teacher/TeacherAttendanceScreen';
import TeacherContentScreen from '../screens/teacher/TeacherContentScreen';
import TeacherStudentsScreen from '../screens/teacher/TeacherStudentsScreen';
import TeacherMeScreen from '../screens/teacher/TeacherMeScreen';
import ChatListScreen from '../screens/chat/ChatListScreen';

function TabBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

function HeaderBell({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onPress} style={{ marginRight: 12, padding: 4 }}>
      <View>
        <Bell size={22} color={colors.text} />
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
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

  // Notification count (for header bell)
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

  // Chat count (for chat tab badge)
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

  const headerRight = (navigation: any) => () => (
    <HeaderBell
      count={notifCount}
      onPress={() => {
        setNotifCount(0);
        navigation.navigate('TeacherNotifications');
      }}
    />
  );

  const headerOptions = (navigation: any) => ({
    headerShown: true,
    headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
    headerTitleStyle: { color: colors.text },
    headerTintColor: colors.primary,
    headerRight: headerRight(navigation),
  });

  return (
    <Tab.Navigator
      screenOptions={{
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
        options={({ navigation }) => ({
          ...headerOptions(navigation),
          headerTitle: t('nav.dashboard', 'Dashboard'),
          tabBarLabel: t('nav.dashboard', 'Dashboard'),
          tabBarIcon: ({ color }) => <Home size={ICON_SIZE} color={color} />,
        })}
      />
      {feat('attendance') ? (
        <Tab.Screen
          name="TeacherAttendance"
          component={TeacherAttendanceScreen}
          options={({ navigation }) => ({
            ...headerOptions(navigation),
            headerTitle: t('nav.attendance', 'Attendance'),
            tabBarLabel: t('nav.attendance', 'Attendance'),
            tabBarIcon: ({ color }) => <CalendarCheck size={ICON_SIZE} color={color} />,
          })}
        />
      ) : null}
      <Tab.Screen
        name="TeacherContent"
        component={TeacherContentScreen}
        options={({ navigation }) => ({
          ...headerOptions(navigation),
          headerTitle: 'Content',
          tabBarLabel: 'Content',
          tabBarIcon: ({ color }) => <BookOpen size={ICON_SIZE} color={color} />,
        })}
      />
      <Tab.Screen
        name="TeacherStudents"
        component={TeacherStudentsScreen}
        options={({ navigation }) => ({
          ...headerOptions(navigation),
          headerTitle: t('nav.students', 'Students'),
          tabBarLabel: t('nav.students', 'Students'),
          tabBarIcon: ({ color }) => <Users size={ICON_SIZE} color={color} />,
        })}
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
          options={({ navigation }) => ({
            ...headerOptions(navigation),
            headerTitle: t('nav.chat', 'Chat'),
            tabBarLabel: t('nav.chat', 'Chat'),
            tabBarIcon: ({ color }) => (
              <View>
                <MessageSquare size={ICON_SIZE} color={color} />
                <TabBadge count={chatCount} />
              </View>
            ),
          })}
        />
      ) : null}
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
