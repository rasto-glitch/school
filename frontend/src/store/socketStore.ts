import { create } from 'zustand';
import { io as socketIO, Socket } from 'socket.io-client';
import { useAuthStore } from './authStore';

interface SocketState {
  socket: Socket | null;
  connect: (token: string) => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connect: (token: string) => {
    if (get().socket?.connected) return;
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const socketUrl = apiBase.replace(/\/api$/, '');
    // `auth` as a callback is re-invoked on every (re)connect, so a socket
    // that drops and reconnects after the short-lived access token has
    // rotated picks up the current token instead of the stale one.
    const socket = socketIO(socketUrl, {
      auth: (cb) => cb({ token: useAuthStore.getState().token || token }),
      transports: ['websocket'],
    });
    set({ socket });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
