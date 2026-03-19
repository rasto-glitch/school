import './src/i18n';
import './src/tasks/locationTask'; // register background task before anything renders
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import Navigation from './src/navigation';
import { usePushNotifications } from './src/hooks/usePushNotifications';

function AppInner() {
  usePushNotifications();
  const notifListener = useRef<any>();

  useEffect(() => {
    // Show in-app alert when a notification arrives while the app is open
    notifListener.current = Notifications.addNotificationReceivedListener(notification => {
      const { title, body } = notification.request.content;
      if (title) Alert.alert(title, body ?? '');
    });
    return () => {
      if (notifListener.current) Notifications.removeNotificationSubscription(notifListener.current);
    };
  }, []);

  return <Navigation />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppInner />
    </SafeAreaProvider>
  );
}
