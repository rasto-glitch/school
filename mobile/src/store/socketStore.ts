import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';

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
    const socket = io(SOCKET_URL, { auth: { token } });
    set({ socket });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
