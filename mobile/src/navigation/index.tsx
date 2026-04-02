import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useColors } from '../store/themeStore';
import LoginScreen from '../screens/auth/LoginScreen';
import ParentTabs from './ParentTabs';
import DriverTabs from './DriverTabs';
import DriverSettingsScreen from '../screens/driver/DriverSettingsScreen';
import SupervisorTabs from './SupervisorTabs';
import SupervisorSettingsScreen from '../screens/supervisor/SupervisorSettingsScreen';
import TeacherTabs from './TeacherTabs';
import TeacherSettingsScreen from '../screens/teacher/TeacherSettingsScreen';
import SetPickupLocationScreen from '../screens/parent/SetPickupLocationScreen';
import SettingsScreen from '../screens/parent/SettingsScreen';
import ReportsScreen from '../screens/parent/ReportsScreen';
import NotificationsScreen from '../screens/parent/NotificationsScreen';
import AppointmentsScreen from '../screens/parent/AppointmentsScreen';
import GradesScreen from '../screens/parent/GradesScreen';
import ReportDetailScreen from '../screens/parent/ReportDetailScreen';
import HomeworkDetailScreen from '../screens/parent/HomeworkDetailScreen';
import AssignmentDetailScreen from '../screens/parent/AssignmentDetailScreen';
import AnnouncementDetailScreen from '../screens/parent/AnnouncementDetailScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import type { Homework, Announcement, Conversation } from '../types';

export type RootStackParamList = {
  Login: undefined;
  ParentTabs: undefined;
  DriverTabs: undefined;
  DriverSettings: undefined;
  SupervisorTabs: undefined;
  SupervisorSettings: undefined;
  TeacherTabs: undefined;
  TeacherSettings: undefined;
  SetPickupLocation: undefined;
  Settings: undefined;
  Reports: undefined;
  Notifications: undefined;
  ReportDetail: { report: { id: string; subject: string; attendanceNotes?: string; behaviorNotes?: string; teacherNotes?: string; quizMarks?: number; examMarks?: number; reportDate?: string; createdAt: string; students?: { fullName: string }; teachers?: { fullName: string } } };
  Appointments: undefined;
  Grades: undefined;
  HomeworkDetail: { homework: Homework };
  AssignmentDetail: { assignment: { id: string; title: string; description?: string; subject?: string; dueDate?: string; submissionStatus?: string; grade?: number | null; createdAt: string; classes?: { name: string }; students?: { fullName: string } } };
  AnnouncementDetail: { announcement: Announcement };
  Chat: { conversation: Conversation };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, isAuthenticated } = useAuthStore();
  const colors = useColors();
  const authed = isAuthenticated();

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.primary,
          headerShown: false,
        }}
      >
        {!authed ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : user?.role === 'driver' ? (
          <>
            <Stack.Screen name="DriverTabs" component={DriverTabs} />
            <Stack.Screen
              name="DriverSettings"
              component={DriverSettingsScreen}
              options={{ headerShown: true, headerTitle: 'Settings', headerBackTitle: 'Back', presentation: 'card' }}
            />
          </>
        ) : user?.role === 'supervisor' ? (
          <>
            <Stack.Screen name="SupervisorTabs" component={SupervisorTabs} />
            <Stack.Screen
              name="SupervisorSettings"
              component={SupervisorSettingsScreen}
              options={{ headerShown: true, headerTitle: 'Settings', headerBackTitle: 'Back', presentation: 'card' }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ headerShown: true, headerBackTitle: 'Back' }}
            />
          </>
        ) : user?.role === 'teacher' ? (
          <>
            <Stack.Screen name="TeacherTabs" component={TeacherTabs} />
            <Stack.Screen
              name="TeacherSettings"
              component={TeacherSettingsScreen}
              options={{ headerShown: true, headerTitle: 'Settings', headerBackTitle: 'Back', presentation: 'card' }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ headerShown: true, headerBackTitle: 'Back' }}
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
            <Stack.Screen
              name="HomeworkDetail"
              component={HomeworkDetailScreen}
              options={{ headerShown: true, headerTitle: 'Homework', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="AssignmentDetail"
              component={AssignmentDetailScreen}
              options={{ headerShown: true, headerTitle: 'Assignment', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="AnnouncementDetail"
              component={AnnouncementDetailScreen}
              options={{ headerShown: true, headerTitle: 'Announcement', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ headerShown: true, headerBackTitle: 'Back' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
