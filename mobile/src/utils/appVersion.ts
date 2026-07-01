import { Platform, Linking } from 'react-native';
import * as Updates from 'expo-updates';
import { API_URL } from '../services/api';

// Store listings — same URLs the landing page links to.
export const STORE_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/us/app/scholify/id6764818420'
    : 'https://play.google.com/store/apps/details?id=com.rastoelkurdi.schoolportal';

export function openStore(): void {
  Linking.openURL(STORE_URL).catch(() => {});
}

// Compare dotted numeric version strings ("1.2" vs "1.3"). Returns true when a < b.
function isLower(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// True ONLY when we're confident the installed native build is below the
// server-required minimum runtimeVersion. Every uncertain case fails OPEN
// (dev client, unknown runtime, network/parse error, missing config) so a
// hiccup can never lock a user out of the app.
export async function isUpdateRequired(): Promise<boolean> {
  if (__DEV__) return false;
  try {
    const current = Updates.runtimeVersion;
    if (!current) return false; // Expo Go / unknown — don't gate
    const base = API_URL.replace(/\/api\/?$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`${base}/app-version`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return false;
    const data = await res.json();
    const min = typeof data?.minRuntimeVersion === 'string' ? data.minRuntimeVersion : '0';
    return isLower(current, min);
  } catch {
    return false;
  }
}
