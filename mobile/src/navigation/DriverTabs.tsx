import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Navigation, Users } from 'lucide-react-native';
import DriverDashboardScreen from '../screens/driver/DriverDashboardScreen';
import StartDriveScreen from '../screens/driver/StartDriveScreen';
import DriverStudentsScreen from '../screens/driver/DriverStudentsScreen';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 22;

export default function DriverTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4F46E5',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E7EB',
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
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
    </Tab.Navigator>
  );
}
