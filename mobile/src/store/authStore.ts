import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthUser, School } from '../types';
import { authApi } from '../services/api';
import { getRegisteredPushToken } from '../hooks/usePushNotifications';
import { useThemeStore } from './themeStore';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  school: School | null;
  selectedSchool: School | null;
  setAuth: (token: string, user: AuthUser, school: School) => void;
  setSelectedSchool: (school: School) => void;
  setProfilePicture: (url: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      school: null,
      selectedSchool: null,
      setAuth: (token, user, school) => set({ token, user, school }),
      setSelectedSchool: (school) => set({ selectedSchool: school }),
      setProfilePicture: (url) => set(s => s.user ? { user: { ...s.user, profilePicture: url } } : {}),
      logout: () => {
        // Unsubscribe this device from push before clearing auth. Fire and
        // forget — the axios request picks up the auth header synchronously,
        // so it goes out with the soon-to-be-cleared JWT still attached.
        const pushToken = getRegisteredPushToken();
        if (pushToken) authApi.removeDeviceToken(pushToken).catch(() => {});
        // Theme is device-persisted; reset it so the next person to sign in
        // on this device doesn't inherit the previous user's dark-mode choice.
        useThemeStore.getState().reset();
        set({ token: null, user: null, school: null, selectedSchool: null });
      },
      isAuthenticated: () => !!get().token && !!get().user,
    }),
    {
      name: 'school-auth-mobile',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
