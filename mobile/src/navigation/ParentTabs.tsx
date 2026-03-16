import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { Home, BookOpen, Star, Bus, User } from 'lucide-react-native';
import FeedScreen from '../screens/parent/FeedScreen';
import HomeworkScreen from '../screens/parent/HomeworkScreen';
import GradesScreen from '../screens/parent/GradesScreen';
import BusTrackingScreen from '../screens/parent/BusTrackingScreen';
import MeScreen from '../screens/parent/MeScreen';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

export default function ParentTabs() {
  const { t } = useTranslation();

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
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{ tabBarLabel: t('dashboard.title'), tabBarIcon: ({ color }) => <Home size={22} color={color} /> }}
      />
      <Tab.Screen
        name="Homework"
        component={HomeworkScreen}
        options={{ tabBarLabel: t('nav.homework'), tabBarIcon: ({ color }) => <BookOpen size={22} color={color} /> }}
      />
      <Tab.Screen
        name="Grades"
        component={GradesScreen}
        options={{ tabBarLabel: t('nav.grades'), tabBarIcon: ({ color }) => <Star size={22} color={color} /> }}
      />
      <Tab.Screen
        name="BusTracking"
        component={BusTrackingScreen}
        options={{ tabBarLabel: t('nav.track_bus'), tabBarIcon: ({ color }) => <Bus size={22} color={color} /> }}
      />
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{ tabBarLabel: t('nav.profile'), tabBarIcon: ({ color }) => <User size={22} color={color} /> }}
      />
    </Tab.Navigator>
  );
}
