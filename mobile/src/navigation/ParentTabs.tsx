import { useEffect, useRef, useState, useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Home, BookOpen, ClipboardList, Bus, Bell, User, Settings } from 'lucide-react-native';
import FeedScreen from '../screens/parent/FeedScreen';
import HomeworkScreen from '../screens/parent/HomeworkScreen';
import AssignmentsScreen from '../screens/parent/AssignmentsScreen';
import BusTrackingScreen from '../screens/parent/BusTrackingScreen';
import MeScreen from '../screens/parent/MeScreen';
import { useColors } from '../store/themeStore';
import { useBadgeStore } from '../store/badgeStore';
import { font } from '../theme';
import { parentApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

const Tab = createBottomTabNavigator();

function TabBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export default function ParentTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const navigation = useNavigation<any>();
  const { school } = useAuthStore();
  const [homeworkCount, setHomeworkCount] = useState(0);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const { unreadCount, setUnreadCount, setReportCount, setBookingCount } = useBadgeStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  }, [setUnreadCount, setReportCount, setBookingCount]);

  useEffect(() => {
    fetchCounts();
    intervalRef.current = setInterval(fetchCounts, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchCounts]);

  const handleHomeworkPress = () => {
    if (homeworkCount > 0) {
      parentApi.markTypeRead('homework').catch(() => {});
      setHomeworkCount(0);
    }
  };

  const handleAssignmentPress = () => {
    if (assignmentCount > 0) {
      parentApi.markTypeRead('assignment').catch(() => {});
      setAssignmentCount(0);
    }
  };

  // Notification bell — shown in header for all tabs except Me
  const NotificationBell = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      style={[styles.headerBtn, { backgroundColor: colors.primaryLight }]}
      activeOpacity={0.7}
    >
      <Bell size={18} color={colors.primary} />
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
      style={[styles.headerBtn, { backgroundColor: colors.primaryLight }]}
      activeOpacity={0.7}
    >
      <Settings size={18} color={colors.primary} />
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
        name="Feed"
        component={FeedScreen}
        options={{
          headerTitle: t('dashboard.title'),
          tabBarLabel: t('dashboard.title'),
          tabBarIcon: ({ color }) => <Home size={22} color={color} />,
        }}
      />
      {feat('homework') && (
        <Tab.Screen
          name="Homework"
          component={HomeworkScreen}
          listeners={{ tabPress: handleHomeworkPress }}
          options={{
            headerTitle: t('nav.homework'),
            tabBarLabel: t('nav.homework'),
            tabBarIcon: ({ color }) => (
              <View>
                <BookOpen size={22} color={color} />
                <TabBadge count={homeworkCount} />
              </View>
            ),
          }}
        />
      )}
      {feat('assignments') && (
        <Tab.Screen
          name="Assignments"
          component={AssignmentsScreen}
          listeners={{ tabPress: handleAssignmentPress }}
          options={{
            headerTitle: t('nav.assignments', 'Assignments'),
            tabBarLabel: t('nav.assignments', 'Assignments'),
            tabBarIcon: ({ color }) => (
              <View>
                <ClipboardList size={22} color={color} />
                <TabBadge count={assignmentCount} />
              </View>
            ),
          }}
        />
      )}
      {feat('bus_tracking') && (
        <Tab.Screen
          name="BusTracking"
          component={BusTrackingScreen}
          options={{
            headerTitle: t('nav.track_bus'),
            tabBarLabel: t('nav.track_bus'),
            tabBarIcon: ({ color }) => <Bus size={22} color={color} />,
          }}
        />
      )}
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{
          headerTitle: t('nav.me', 'Me'),
          tabBarLabel: t('nav.me', 'Me'),
          tabBarIcon: ({ color }) => <User size={22} color={color} />,
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
});
