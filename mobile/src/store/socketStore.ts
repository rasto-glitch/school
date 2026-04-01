import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = API_URL.replace(/\/api$/, '');

interface SocketState {
  socket: Socket | null;
  connect: (token: string) => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connect: (token: string) => {
    get().socket?.disconnect();
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
    set({ socket });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null });
  },
}));
