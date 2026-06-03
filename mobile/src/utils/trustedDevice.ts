import AsyncStorage from '@react-native-async-storage/async-storage';

// Mobile mirror of the web's trusted-device persistence. The token is
// keyed by username so the same physical device shared between accounts
// keeps them apart. AsyncStorage is asynchronous so all the helpers are
// async too — callers `await` before sending the token in /auth/login.

const KEY_PREFIX = 'scholify.trusted_device.';

function key(username: string): string {
  return KEY_PREFIX + username.trim().toLowerCase();
}

export async function getTrustedDeviceToken(username: string): Promise<string | undefined> {
  try {
    const v = await AsyncStorage.getItem(key(username));
    return v || undefined;
  } catch { return undefined; }
}

export async function setTrustedDeviceToken(username: string, token: string): Promise<void> {
  try { await AsyncStorage.setItem(key(username), token); } catch { /* ignore */ }
}

export async function clearTrustedDeviceToken(username: string): Promise<void> {
  try { await AsyncStorage.removeItem(key(username)); } catch { /* ignore */ }
}
