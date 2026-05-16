import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Navigation, Users, User, Settings } from 'lucide-react-native';
import HouseIcon from '../components/HouseIcon';
import HeaderBrand from '../components/HeaderBrand';
import { makeSlideTransition } from './tabSlide';
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
  const navigation = useNavigation<any>();
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

  const headerIconBg = isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight;
  const headerIconColor = isDark ? '#FFFFFF' : colors.primary;
  const activeFill = isDark ? '#FFFFFF' : colors.primary;

  const SettingsButton = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('DriverSettings')}
      style={[styles.headerBtn, { backgroundColor: headerIconBg }]}
      activeOpacity={0.7}
    >
      <Settings size={18} color={headerIconColor} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        detachInactiveScreens={false}
        screenListeners={{
          state: (e) => {
            const s: any = (e.data as any)?.state;
            if (s && typeof s.index === 'number') setActiveIndex(s.index);
          },
        }}
        screenOptions={{
          ...makeSlideTransition(screenWidth),
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
          options={{ tabBarLabel: t('nav.dashboard'), tabBarIcon: ({ color, focused }) => (
            <HouseIcon
              size={ICON_SIZE}
              color={color}
              fillColor={focused ? activeFill : 'none'}
              doorColor={focused ? (isDark ? '#000000' : colors.card) : 'none'}
            />
          ) }}
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
            headerTitle: '',
            headerLeft: () => <HeaderBrand />,
            headerStyle: { backgroundColor: colors.card, direction: 'ltr' } as any,
            headerTintColor: colors.primary,
            headerShadowVisible: false,
            headerRight: () => <SettingsButton />,
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
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 12,
  },
  activeTopLine: {
    position: 'absolute',
    left: 0,
    width: 32, height: 2,
    borderRadius: 1,
  },
});
