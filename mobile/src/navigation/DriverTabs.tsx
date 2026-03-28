import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Navigation, Users, User } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import DriverDashboardScreen from '../screens/driver/DriverDashboardScreen';
import StartDriveScreen from '../screens/driver/StartDriveScreen';
import DriverStudentsScreen from '../screens/driver/DriverStudentsScreen';
import DriverMeScreen from '../screens/driver/DriverMeScreen';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 22;

export default function DriverTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();

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
        name="DriverDashboard"
        component={DriverDashboardScreen}
        options={{ tabBarLabel: t('nav.dashboard'), tabBarIcon: ({ color }) => <Home size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="StartDrive"
        component={StartDriveScreen}
        options={{ tabBarLabel: t('driver.start_drive'), tabBarIcon: ({ color }) => <Navigation size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="DriverStudents"
        component={DriverStudentsScreen}
        options={{ tabBarLabel: t('nav.students'), tabBarIcon: ({ color }) => <Users size={ICON_SIZE} color={color} /> }}
      />
      <Tab.Screen
        name="DriverMe"
        component={DriverMeScreen}
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
