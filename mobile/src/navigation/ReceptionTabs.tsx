import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Calendar, User, Settings, Clock } from 'lucide-react-native';
import HouseIcon from '../components/HouseIcon';
import HeaderBrand from '../components/HeaderBrand';
import { makeSlideTransition } from './tabSlide';
import { useColors, useIsDark } from '../store/themeStore';
import { receptionApi } from '../services/api';
import ReceptionDashboardScreen from '../screens/reception/ReceptionDashboardScreen';
import ReceptionAppointmentsScreen from '../screens/reception/ReceptionAppointmentsScreen';
import ReceptionMeScreen from '../screens/reception/ReceptionMeScreen';
import StaffAttendanceScreen from '../screens/staff/StaffAttendanceScreen';
import { useAuthStore } from '../store/authStore';

const Tab = createBottomTabNavigator();

const ICON_SIZE = 22;
const INDICATOR_WIDTH = 32;

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export default function ReceptionTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const navigation = useNavigation<any>();
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const { school } = useAuthStore();
  const showClockIn = school?.features?.staff_attendance === true;
  const tabCount = 3 + (showClockIn ? 1 : 0);

  const [pendingCount, setPendingCount] = useState(0);
  const fetchPending = useCallback(() => {
    receptionApi.getPendingAppointmentCount().then(r => setPendingCount(r.data?.count ?? 0)).catch(() => {});
  }, []);
  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 60000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  useEffect(() => {
    if (!screenWidth) return;
    const tabW = screenWidth / tabCount;
    const target = activeIndex * tabW + (tabW - INDICATOR_WIDTH) / 2;
    Animated.spring(indicatorX, { toValue: target, useNativeDriver: true, tension: 140, friction: 16 }).start();
  }, [activeIndex, screenWidth, tabCount, indicatorX]);

  const headerIconBg = isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight;
  const headerIconColor = isDark ? '#FFFFFF' : colors.primary;
  const activeFill = isDark ? '#FFFFFF' : colors.primary;

  const SettingsButton = () => (
    <TouchableOpacity
      onPress={() => navigation.navigate('ReceptionSettings')}
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
            if (s && typeof s.index === 'number') {
              setActiveIndex(s.index);
              if (s.routes?.[s.index]?.name === 'ReceptionAppointments') fetchPending();
            }
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
          name="ReceptionDashboard"
          component={ReceptionDashboardScreen}
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
          name="ReceptionAppointments"
          component={ReceptionAppointmentsScreen}
          listeners={{ tabPress: () => fetchPending() }}
          options={{
            tabBarLabel: t('nav.appointments'),
            tabBarIcon: ({ color, focused }) => (
              <View>
                <Calendar size={ICON_SIZE} color={color} fill={focused ? activeFill : 'transparent'} />
                <TabBadge count={pendingCount} />
              </View>
            ),
          }}
        />
        {showClockIn ? (
          <Tab.Screen
            name="ReceptionClockIn"
            component={StaffAttendanceScreen}
            options={{
              tabBarLabel: t('nav.clock_in', 'Clock In'),
              // Focused: keep the filled disc but stroke the ring + hands in a
              // contrasting colour (white on light, indigo on dark) so it still
              // reads as a clock, not a solid blob. SAME across all role tabs.
              tabBarIcon: ({ color, focused }) => <Clock size={ICON_SIZE} color={focused ? (isDark ? colors.primary : '#FFFFFF') : color} fill={focused ? activeFill : 'transparent'} />,
            }}
          />
        ) : null}
        <Tab.Screen
          name="ReceptionMe"
          component={ReceptionMeScreen}
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
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
