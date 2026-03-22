import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useColors } from '../store/themeStore';
import SchoolPickerScreen from '../screens/auth/SchoolPickerScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import ParentTabs from './ParentTabs';
import DriverTabs from './DriverTabs';
import DriverSettingsScreen from '../screens/driver/DriverSettingsScreen';
import SetPickupLocationScreen from '../screens/parent/SetPickupLocationScreen';
import SettingsScreen from '../screens/parent/SettingsScreen';
import ReportsScreen from '../screens/parent/ReportsScreen';
import NotificationsScreen from '../screens/parent/NotificationsScreen';
import AppointmentsScreen from '../screens/parent/AppointmentsScreen';
import GradesScreen from '../screens/parent/GradesScreen';
import ReportDetailScreen from '../screens/parent/ReportDetailScreen';

export type RootStackParamList = {
  SchoolPicker: undefined;
  Login: undefined;
  ParentTabs: undefined;
  DriverTabs: undefined;
  DriverSettings: undefined;
  SetPickupLocation: undefined;
  Settings: undefined;
  Reports: undefined;
  Notifications: undefined;
  ReportDetail: { report: { id: string; subject: string; attendanceNotes?: string; behaviorNotes?: string; teacherNotes?: string; quizMarks?: number; examMarks?: number; reportDate?: string; createdAt: string; students?: { fullName: string }; teachers?: { fullName: string } } };
  Appointments: undefined;
  Grades: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, isAuthenticated, selectedSchool } = useAuthStore();
  const colors = useColors();
  const authed = isAuthenticated();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.primary,
          headerShown: false,
        }}
      >
        {!authed ? (
          !selectedSchool ? (
            <Stack.Screen name="SchoolPicker" component={SchoolPickerScreen} />
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )
        ) : user?.role === 'driver' ? (
          <>
            <Stack.Screen name="DriverTabs" component={DriverTabs} />
            <Stack.Screen
              name="DriverSettings"
              component={DriverSettingsScreen}
              options={{ headerShown: true, headerTitle: 'Settings', headerBackTitle: 'Back', presentation: 'card' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="ParentTabs" component={ParentTabs} />
            <Stack.Screen name="SetPickupLocation" component={SetPickupLocationScreen} options={{ headerShown: true, headerTitle: 'Set Pickup Location', headerBackTitle: 'Back' }} />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerShown: true, headerTitle: 'Notifications', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: true, headerTitle: 'Settings', headerBackTitle: 'Back', presentation: 'card' }}
            />
            <Stack.Screen
              name="Reports"
              component={ReportsScreen}
              options={{ headerShown: true, headerTitle: 'Reports', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="ReportDetail"
              component={ReportDetailScreen}
              options={{ headerShown: true, headerTitle: 'Report', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Appointments"
              component={AppointmentsScreen}
              options={{ headerShown: true, headerTitle: 'Appointments', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Grades"
              component={GradesScreen}
              options={{ headerShown: true, headerTitle: 'Grades', headerBackTitle: 'Back' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
