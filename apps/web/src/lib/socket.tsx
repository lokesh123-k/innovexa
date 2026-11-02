import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthProvider';

const SocketContext = createContext<Socket | null>(null);

/**
 * One Socket.IO connection per signed-in session. Authenticated by the same
 * httpOnly cookie as the API (same origin via the dev proxy). Server events
 * invalidate cached queries so every screen stays live.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const s = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    s.on('notification:new', (n: { title: string; body?: string }) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast(n.title, { description: n.body });
    });
    s.on('message:new', () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
    });
    s.on('message:read', () => void qc.invalidateQueries({ queryKey: ['messages'] }));
    s.on('presence', () => void qc.invalidateQueries({ queryKey: ['conversations'] }));
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [userId, qc]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
