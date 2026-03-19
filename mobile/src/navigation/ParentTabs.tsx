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
import { colors, radius, font } from '../theme';

const Tab = createBottomTabNavigator();

function ProfileButton() {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Me')}
      style={styles.profileBtn}
      activeOpacity={0.7}
    >
      <User size={20} color={colors.primary} />
    </TouchableOpacity>
  );
}

export default function ParentTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

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
          tabBarIcon: ({ color }) => <Home size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Homework"
        component={HomeworkScreen}
        options={{
          headerTitle: t('nav.homework'),
          tabBarLabel: t('nav.homework'),
          tabBarIcon: ({ color }) => <BookOpen size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Assignments"
        component={AssignmentsScreen}
        options={{
          headerTitle: t('nav.assignments', 'Assignments'),
          tabBarLabel: t('nav.assignments', 'Assignments'),
          tabBarIcon: ({ color }) => <ClipboardList size={22} color={color} />,
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
        options={{
          headerTitle: t('nav.notifications', 'Notifications'),
          tabBarLabel: t('nav.notifications', 'Notifications'),
          tabBarIcon: ({ color }) => <Bell size={22} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  profileBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
});
