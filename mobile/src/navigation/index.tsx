import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { useColors, useIsDark } from '../store/themeStore';
import LoginScreen from '../screens/auth/LoginScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ParentTabs from './ParentTabs';
import DriverTabs from './DriverTabs';
import DriverSettingsScreen from '../screens/driver/DriverSettingsScreen';
import SupervisorTabs from './SupervisorTabs';
import SupervisorSettingsScreen from '../screens/supervisor/SupervisorSettingsScreen';
import SupervisorNotificationsScreen from '../screens/supervisor/SupervisorNotificationsScreen';
import SupervisorSalaryScreen from '../screens/supervisor/SupervisorSalaryScreen';
import TeacherTabs from './TeacherTabs';
import TeacherSettingsScreen from '../screens/teacher/TeacherSettingsScreen';
import TeacherNotificationsScreen from '../screens/teacher/TeacherNotificationsScreen';
import TeacherScheduleScreen from '../screens/teacher/TeacherScheduleScreen';
import TeacherSalaryScreen from '../screens/teacher/TeacherSalaryScreen';
import SetPickupLocationScreen from '../screens/parent/SetPickupLocationScreen';
import SettingsScreen from '../screens/parent/SettingsScreen';
import ReportsScreen from '../screens/parent/ReportsScreen';
import NotificationsScreen from '../screens/parent/NotificationsScreen';
import AppointmentsScreen from '../screens/parent/AppointmentsScreen';
import GradesScreen from '../screens/parent/GradesScreen';
import ReportDetailScreen from '../screens/parent/ReportDetailScreen';
import HomeworkScreen from '../screens/parent/HomeworkScreen';
import HomeworkDetailScreen from '../screens/parent/HomeworkDetailScreen';
import AssignmentsScreen from '../screens/parent/AssignmentsScreen';
import AssignmentDetailScreen from '../screens/parent/AssignmentDetailScreen';
import AnnouncementDetailScreen from '../screens/parent/AnnouncementDetailScreen';
import PostDetailScreen from '../screens/parent/PostDetailScreen';
import EbookReaderScreen from '../screens/parent/EbookReaderScreen';
import ParentScheduleScreen from '../screens/parent/ParentScheduleScreen';
import TuitionScreen from '../screens/parent/TuitionScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import ReportBugScreen from '../screens/common/ReportBugScreen';
import type { Homework, Announcement, Conversation, Ebook, Report } from '../types';

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: { prefillUsername?: string } | undefined;
  ParentTabs: undefined;
  DriverTabs: undefined;
  DriverSettings: undefined;
  SupervisorTabs: undefined;
  SupervisorSettings: undefined;
  SupervisorNotifications: undefined;
  SupervisorSalary: undefined;
  TeacherTabs: undefined;
  TeacherSettings: undefined;
  TeacherNotifications: undefined;
  TeacherSchedule: undefined;
  TeacherSalary: undefined;
  ParentSchedule: undefined;
  Tuition: undefined;
  SetPickupLocation: undefined;
  Settings: undefined;
  ReportBug: undefined;
  Reports: undefined;
  Notifications: undefined;
  ReportDetail: { report: Report };
  Appointments: undefined;
  Grades: undefined;
  Homework: undefined;
  HomeworkDetail: { homework: Homework };
  Assignments: undefined;
  AssignmentDetail: { assignment: { id: string; title: string; description?: string; subject?: string; dueDate?: string; submissionStatus?: string; grade?: number | null; createdAt: string; classes?: { name: string }; students?: { fullName: string } } };
  AnnouncementDetail: { announcement?: Announcement; announcementId?: string; focusComment?: boolean };
  PostDetail: { postId: string; focusComment?: boolean };
  EbookReader: { ebook: Ebook; studentId: string; studentName?: string };
  Chat: { conversation: Conversation };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, isAuthenticated } = useAuthStore();
  const colors = useColors();
  const isDark = useIsDark();
  const authed = isAuthenticated();

  // React Navigation ships a LIGHT theme by default; without this its
  // scene/transition backdrop (background + card) stays light and flashes
  // through during tab slides and stack pushes when the app is in dark mode.
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.primary,
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {!authed ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
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
              name="SupervisorNotifications"
              component={SupervisorNotificationsScreen}
              options={{ headerShown: true, headerTitle: 'Notifications', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="SupervisorSalary"
              component={SupervisorSalaryScreen}
              options={{ headerShown: true, headerTitle: 'My Salary', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="AnnouncementDetail"
              component={AnnouncementDetailScreen}
              options={{ headerShown: true, headerTitle: 'Announcement', headerBackTitle: 'Back' }}
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
              name="TeacherNotifications"
              component={TeacherNotificationsScreen}
              options={{ headerShown: true, headerTitle: 'Notifications', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="TeacherSchedule"
              component={TeacherScheduleScreen}
              options={{ headerShown: true, headerTitle: 'Schedule', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="TeacherSalary"
              component={TeacherSalaryScreen}
              options={{ headerShown: true, headerTitle: 'My Salary', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="PostDetail"
              component={PostDetailScreen}
              options={{ headerShown: true, headerTitle: 'Post', headerBackTitle: 'Back' }}
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
            <Stack.Screen
              name="ReportBug"
              component={ReportBugScreen}
              options={{ headerShown: true, headerTitle: 'Report a bug', headerBackTitle: 'Back' }}
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
              name="Homework"
              component={HomeworkScreen}
              options={{ headerShown: true, headerTitle: 'Homework', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="HomeworkDetail"
              component={HomeworkDetailScreen}
              options={{ headerShown: true, headerTitle: 'Homework', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Assignments"
              component={AssignmentsScreen}
              options={{ headerShown: true, headerTitle: 'Assignments', headerBackTitle: 'Back' }}
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
              name="PostDetail"
              component={PostDetailScreen}
              options={{ headerShown: true, headerTitle: 'Post', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="EbookReader"
              component={EbookReaderScreen}
              options={{ headerShown: true, headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="ParentSchedule"
              component={ParentScheduleScreen}
              options={{ headerShown: true, headerTitle: 'Schedule', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Tuition"
              component={TuitionScreen}
              options={{ headerShown: true, headerTitle: 'Tuition', headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ headerShown: true, headerBackTitle: 'Back' }}
            />
            <Stack.Screen
              name="ReportBug"
              component={ReportBugScreen}
              options={{ headerShown: true, headerTitle: 'Report a bug', headerBackTitle: 'Back' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
