import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Clock, User, Settings } from 'lucide-react-native';
import HeaderBrand from '../components/HeaderBrand';
import { makeSlideTransition } from './tabSlide';
import { useColors, useIsDark } from '../store/themeStore';
import StaffAttendanceScreen from '../screens/staff/StaffAttendanceScreen';
import EmployeeMeScreen from '../screens/staff/EmployeeMeScreen';

// Minimal tab app for roles whose ONLY mobile purpose is clocking in/out:
// admin, accountant, staff. Two fixed tabs — Clock In + Me. The Clock In screen
// itself handles the staff_attendance-off case, so the tab is always present.
const Tab = createBottomTabNavigator();

const ICON_SIZE = 22;
const INDICATOR_WIDTH = 32;
const TAB_COUNT = 2;

export default function EmployeeTabs() {
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
    Animated.spring(indicatorX, { toValue: target, useNativeDriver: true, tension: 140, friction: 16 }).start();
  }, [activeIndex, screenWidth, indicatorX]);

  const headerIconBg = isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight;
  const headerIconColor = isDark ? '#FFFFFF' : colors.primary;
  const activeFill = isDark ? '#FFFFFF' : colors.primary;

  const SettingsButton = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('EmployeeSettings')}
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
          name="EmployeeAttendance"
          component={StaffAttendanceScreen}
          options={{
            tabBarLabel: t('nav.clock_in', 'Clock In'),
            // Focused: keep the filled disc but stroke the ring + hands in a
            // contrasting colour (white on the light indigo fill, indigo on the
            // dark white fill) so it still reads as a clock, not a solid blob.
            tabBarIcon: ({ color, focused }) => <Clock size={ICON_SIZE} color={focused ? (isDark ? colors.primary : '#FFFFFF') : color} fill={focused ? activeFill : 'transparent'} />,
          }}
        />
        <Tab.Screen
          name="EmployeeMe"
          component={EmployeeMeScreen}
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
  activeTopLine: { position: 'absolute', left: 0, width: 32, height: 2, borderRadius: 1 },
});
