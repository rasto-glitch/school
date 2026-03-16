import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthUser, School } from '../types';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  school: School | null;
  rememberMe: boolean;
  setAuth: (token: string, user: AuthUser, school: School, rememberMe: boolean) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

// Writes to localStorage when rememberMe=true, sessionStorage otherwise.
// On read, checks both so either path is found.
const conditionalStorage = {
  getItem: (name: string) => {
    return localStorage.getItem(name) ?? sessionStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    try {
      const remember = JSON.parse(value)?.state?.rememberMe;
      if (remember) {
        localStorage.setItem(name, value);
        sessionStorage.removeItem(name);
      } else {
        sessionStorage.setItem(name, value);
        localStorage.removeItem(name);
      }
    } catch {
      sessionStorage.setItem(name, value);
    }
  },
  removeItem: (name: string) => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      school: null,
      rememberMe: false,
      setAuth: (token, user, school, rememberMe) => set({ token, user, school, rememberMe }),
      logout: () => set({ token: null, user: null, school: null, rememberMe: false }),
      isAuthenticated: () => !!get().token && !!get().user,
    }),
    {
      name: 'school-auth',
      storage: createJSONStorage(() => conditionalStorage),
    }
  )
);
