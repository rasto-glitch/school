import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, CalendarCheck, BookOpen, Users, User } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import SupervisorDashboardScreen from '../screens/supervisor/SupervisorDashboardScreen';
import SupervisorAttendanceScreen from '../screens/supervisor/SupervisorAttendanceScreen';
import SupervisorContentScreen from '../screens/supervisor/SupervisorContentScreen';
import SupervisorStudentsScreen from '../screens/supervisor/SupervisorStudentsScreen';
import SupervisorMeScreen from '../screens/supervisor/SupervisorMeScreen';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 22;

export default function SupervisorTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { school } = useAuthStore();
  const feat = (key: string) => school?.features?.[key] !== false;

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
        name="SupervisorDashboard"
        component={SupervisorDashboardScreen}
        options={{ tabBarLabel: t('nav.dashboard', 'Dashboard'), tabBarIcon: ({ color }) => <Home size={ICON_SIZE} color={color} /> }}
      />
      {feat('attendance') ? (
        <Tab.Screen
          name="SupervisorAttendance"
          component={SupervisorAttendanceScreen}
          options={{ tabBarLabel: t('nav.attendance', 'Attendance'), tabBarIcon: ({ color }) => <CalendarCheck size={ICON_SIZE} color={color} /> }}
        />
      ) : null}
      <Tab.Screen
        name="SupervisorContent"
        component={SupervisorContentScreen}
        options={{ tabBarLabel: t('nav.content', 'Content'), tabBarIcon: ({ color }) => <BookOpen size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="SupervisorStudents"
        component={SupervisorStudentsScreen}
        options={{ tabBarLabel: t('nav.students', 'Students'), tabBarIcon: ({ color }) => <Users size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="SupervisorMe"
        component={SupervisorMeScreen}
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
