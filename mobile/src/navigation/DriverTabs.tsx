import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Navigation, Users, User } from 'lucide-react-native';
import { useColors, useIsDark } from '../store/themeStore';
import DriverDashboardScreen from '../screens/driver/DriverDashboardScreen';
import StartDriveScreen from '../screens/driver/StartDriveScreen';
import DriverStudentsScreen from '../screens/driver/DriverStudentsScreen';
import DriverMeScreen from '../screens/driver/DriverMeScreen';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 22;
const INDICATOR_WIDTH = 32;
const TAB_COUNT = 4;

export default function DriverTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!screenWidth) return;
    const tabW = screenWidth / TAB_COUNT;
    const target = activeIndex * tabW + (tabW - INDICATOR_WIDTH) / 2;
    Animated.spring(indicatorX, {
      toValue: target,
      useNativeDriver: true,
      tension: 140,
      friction: 16,
    }).start();
  }, [activeIndex, screenWidth, indicatorX]);

  const activeFill = isDark ? '#FFFFFF' : colors.primary;

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenListeners={{
          state: (e) => {
            const s: any = (e.data as any)?.state;
            if (s && typeof s.index === 'number') setActiveIndex(s.index);
          },
        }}
        screenOptions={{
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
          name="DriverDashboard"
          component={DriverDashboardScreen}
          options={{ tabBarLabel: t('nav.dashboard'), tabBarIcon: ({ color, focused }) => <Home size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} /> }}
        />
        <Tab.Screen
          name="StartDrive"
          component={StartDriveScreen}
          options={{ tabBarLabel: t('driver.start_drive'), tabBarIcon: ({ color, focused }) => <Navigation size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} /> }}
        />
        <Tab.Screen
          name="DriverStudents"
          component={DriverStudentsScreen}
          options={{ tabBarLabel: t('nav.students'), tabBarIcon: ({ color, focused }) => <Users size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} /> }}
        />
        <Tab.Screen
          name="DriverMe"
          component={DriverMeScreen}
          options={{
            tabBarLabel: t('nav.me', 'Me'),
            tabBarIcon: ({ color, focused }) => <User size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} />,
            headerShown: true,
            headerTitle: t('nav.me', 'Me'),
            headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
            headerTitleStyle: { color: colors.text },
            headerTintColor: colors.primary,
          }}
        />
      </Tab.Navigator>
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
  activeTopLine: {
    position: 'absolute',
    left: 0,
    width: 32, height: 2,
    borderRadius: 1,
  },
});
