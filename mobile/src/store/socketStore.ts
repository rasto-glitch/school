import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from './authStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://school-production-3ccc.up.railway.app/api';
const SOCKET_URL = API_URL.replace(/\/api$/, '');

interface SocketState {
  socket: Socket | null;
  connect: (token: string) => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connect: (token: string) => {
    if (get().socket?.connected) return;
    get().socket?.disconnect();
    // No transports restriction — let socket.io do polling first, then upgrade to WS.
    // Forcing websocket-only breaks on some proxies (Railway, etc.) where the
    // initial HTTP handshake is needed before the upgrade can succeed.
    // `auth` as a callback is re-invoked on every (re)connect, so a socket
    // that reconnects after the short-lived access token has rotated picks
    // up the current token instead of the stale one.
    const socket = io(SOCKET_URL, {
      auth: (cb) => cb({ token: useAuthStore.getState().token || token }),
    });
    set({ socket });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
