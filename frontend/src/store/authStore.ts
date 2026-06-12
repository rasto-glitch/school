import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthUser, School } from '../types';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  school: School | null;
  rememberMe: boolean;
  setAuth: (token: string, refreshToken: string, user: AuthUser, school: School, rememberMe: boolean) => void;
  setTokens: (token: string, refreshToken: string) => void;
  setProfilePicture: (url: string) => void;
  setEmail: (email: string | null) => void;
  setPhone: (phoneE164: string | null, phoneVerifiedAt: string | null) => void;
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
      refreshToken: null,
      user: null,
      school: null,
      rememberMe: false,
      setAuth: (token, refreshToken, user, school, rememberMe) => set({ token, refreshToken, user, school, rememberMe }),
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      setProfilePicture: (url) => set(s => s.user ? { user: { ...s.user, profilePicture: url } } : {}),
      setEmail: (email) => set(s => s.user ? { user: { ...s.user, email } } : {}),
      setPhone: (phoneE164, phoneVerifiedAt) => set(s => s.user ? { user: { ...s.user, phoneE164, phoneVerifiedAt } } : {}),
      logout: () => {
        // Best-effort server-side revocation of the rotation family before
        // we drop local state. Plain fetch (not the api client) to avoid a
        // circular import; keepalive so it still flushes during unload.
        const rt = get().refreshToken;
        if (rt) {
          const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
          try {
            fetch(`${base}/auth/logout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: rt }),
              keepalive: true,
            }).catch(() => {});
          } catch { /* ignore */ }
        }
        set({ token: null, refreshToken: null, user: null, school: null, rememberMe: false });
      },
      isAuthenticated: () => !!get().token && !!get().user,
    }),
    {
      name: 'school-auth',
      storage: createJSONStorage(() => conditionalStorage),
    }
  )
);
