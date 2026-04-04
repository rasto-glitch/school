import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthUser, School } from '../types';

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
      logout: () => set({ token: null, user: null, school: null, selectedSchool: null }),
      isAuthenticated: () => !!get().token && !!get().user,
    }),
    {
      name: 'school-auth-mobile',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
