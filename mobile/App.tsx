import './src/i18n';
import './src/tasks/locationTask'; // register background task before anything renders
import { useEffect, useRef } from 'react';
import { Alert, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import Navigation from './src/navigation';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useRTL } from './src/hooks/useRTL';

function AppInner() {
  usePushNotifications();
  const notifListener = useRef<ReturnType<typeof Notifications.addNotificationReceivedListener> | null>(null);
  const isRTL = useRTL();

  useEffect(() => {
    // Show in-app alert when a notification arrives while the app is open
    notifListener.current = Notifications.addNotificationReceivedListener(notification => {
      const { title, body } = notification.request.content;
      if (title) Alert.alert(title, body ?? '');
    });
    return () => {
      notifListener.current?.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr' }}>
      <Navigation />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppInner />
    </SafeAreaProvider>
  );
}
