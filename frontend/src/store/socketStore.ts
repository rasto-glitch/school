import { create } from 'zustand';
import { io as socketIO, Socket } from 'socket.io-client';

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
    const socket = socketIO(socketUrl, { auth: { token }, transports: ['websocket'] });
    set({ socket });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
