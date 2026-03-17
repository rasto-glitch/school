import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

// How foreground notifications are presented
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushStatus = 'idle' | 'registered' | 'denied' | 'error';

// Module-level so MeScreen can read it without prop drilling
let _setStatus: ((s: PushStatus) => void) | null = null;
let _currentStatus: PushStatus = 'idle';

export function getPushStatus() { return _currentStatus; }

async function doRegister(): Promise<PushStatus> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return 'denied';

  // Use projectId from app.json, or fall back to the hardcoded value
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    '41cd079b-7217-4df8-be77-3cce354e6f3f';

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  await authApi.registerDeviceToken(tokenData.data);
  return 'registered';
}

export function usePushNotifications() {
  const { token: authToken } = useAuthStore();
  const registered = useRef(false);
  const [status, setStatus] = useState<PushStatus>('idle');

  // Share setter so MeScreen can trigger a retry
  _setStatus = setStatus;

  useEffect(() => {
    if (!authToken || registered.current) return;
    doRegister()
      .then(s => {
        _currentStatus = s;
        setStatus(s);
        if (s === 'registered') registered.current = true;
      })
      .catch(() => {
        _currentStatus = 'error';
        setStatus('error');
      });
  }, [authToken]);

  return status;
}

export async function retryPushRegistration(): Promise<{ status: PushStatus; error?: string }> {
  try {
    const s = await doRegister();
    _currentStatus = s;
    _setStatus?.(s);
    return { status: s };
  } catch (e: any) {
    _currentStatus = 'error';
    _setStatus?.('error');
    return { status: 'error', error: e?.message ?? String(e) };
  }
}
