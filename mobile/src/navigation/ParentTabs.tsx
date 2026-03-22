import { useEffect, useRef, useState, useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Home, BookOpen, ClipboardList, Bus, Bell, User } from 'lucide-react-native';
import FeedScreen from '../screens/parent/FeedScreen';
import HomeworkScreen from '../screens/parent/HomeworkScreen';
import AssignmentsScreen from '../screens/parent/AssignmentsScreen';
import BusTrackingScreen from '../screens/parent/BusTrackingScreen';
import NotificationsScreen from '../screens/parent/NotificationsScreen';
import { useColors } from '../store/themeStore';
import { useBadgeStore } from '../store/badgeStore';
import { font } from '../theme';
import { parentApi } from '../services/api';

const Tab = createBottomTabNavigator();

function ProfileButton() {
  const navigation = useNavigation<any>();
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Me')}
      style={[styles.profileBtn, { backgroundColor: colors.primaryLight }]}
      activeOpacity={0.7}
    >
      <User size={20} color={colors.primary} />
    </TouchableOpacity>
  );
}

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [homeworkCount, setHomeworkCount] = useState(0);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const { reportCount, setReportCount } = useBadgeStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCounts = useCallback(() => {
    parentApi.getUnreadCount()
      .then(r => setUnreadCount(r.data?.count ?? 0))
      .catch(() => {});
    parentApi.getContentUnreadCounts()
      .then(r => {
        setHomeworkCount(r.data?.homework ?? 0);
        setAssignmentCount(r.data?.assignment ?? 0);
        setReportCount(r.data?.report ?? 0);
      })
      .catch(() => {});
  }, [setReportCount]);

  useEffect(() => {
    fetchCounts();
    intervalRef.current = setInterval(fetchCounts, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchCounts]);

  const handleNotificationsPress = () => {
    if (unreadCount > 0) {
      parentApi.markAllRead().catch(() => {});
      setUnreadCount(0);
    }
  };

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

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
        headerShadowVisible: false,
        headerRight: () => <ProfileButton />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          headerTitle: t('dashboard.title'),
          tabBarLabel: t('dashboard.title'),
          tabBarIcon: ({ color }) => (
            <View>
              <Home size={22} color={color} />
              <TabBadge count={reportCount} />
            </View>
          ),
        }}
      />
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
      <Tab.Screen
        name="BusTracking"
        component={BusTrackingScreen}
        options={{
          headerTitle: t('nav.track_bus'),
          tabBarLabel: t('nav.track_bus'),
          tabBarIcon: ({ color }) => <Bus size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        listeners={{ tabPress: handleNotificationsPress }}
        options={{
          headerTitle: t('nav.notifications', 'Notifications'),
          tabBarLabel: t('nav.notifications', 'Notifications'),
          tabBarIcon: ({ color }) => (
            <View>
              <Bell size={22} color={color} />
              <TabBadge count={unreadCount} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  profileBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
