import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_TASK_NAME = 'background-location-task';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://school-production-3ccc.up.railway.app/api';

async function getToken(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem('school-auth-mobile');
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch {
    return null;
  }
}

// Must be defined at module level — called by the OS even when app is closed
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) return;
  const { locations } = data;
  if (!locations?.length) return;

  const loc = locations[locations.length - 1];
  const token = await getToken();
  if (!token) return;

  try {
    await fetch(`${API_URL}/driver/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        speed: loc.coords.speed ?? 0,
        heading: loc.coords.heading ?? 0,
        isDriving: true,
      }),
    });
  } catch {}
});
