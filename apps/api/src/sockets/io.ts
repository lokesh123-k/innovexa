import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { Role } from '@innovexa/shared';
import { env } from '../config/env.js';
import { resolveUserFromToken } from '../middleware/authenticate.js';
import { ACCESS_COOKIE } from '../modules/auth/auth.cookies.js';
import { logger } from '../utils/logger.js';

let io: Server | undefined;
/** userId -> number of open sockets, for online indicators. */
const online = new Map<string, number>();

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Socket.IO shares the HTTP server and authenticates with the same httpOnly
 * access cookie as the REST API. Each socket joins `user:<id>` and `role:<ROLE>`.
 */
export function initSockets(server: HttpServer): Server {
  const cfg = env();
  io = new Server(server, {
    cors: { origin: cfg.CORS_ORIGINS, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !cfg.CORS_ORIGINS.includes(origin)) throw new Error('Origin not allowed');
      const token = cookieValue(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (!token) throw new Error('Unauthenticated');
      socket.data.user = await resolveUserFromToken(token);
      next();
    } catch {
      next(new Error('Unauthenticated'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; role: Role };
    void socket.join([`user:${user.id}`, `role:${user.role}`]);
    const count = (online.get(user.id) ?? 0) + 1;
    online.set(user.id, count);
    if (count === 1)
      io?.to(`role:${Role.ADMIN}`).emit('presence', { userId: user.id, online: true });

    socket.on('disconnect', () => {
      const left = (online.get(user.id) ?? 1) - 1;
      if (left <= 0) {
        online.delete(user.id);
        io?.to(`role:${Role.ADMIN}`).emit('presence', { userId: user.id, online: false });
      } else online.set(user.id, left);
    });
  });

  logger.info('Socket.IO ready');
  return io;
}

export const isOnline = (userId: string) => online.has(userId);

/** No-ops when sockets are not initialised (tests, scripts). */
export function emitToUsers(userIds: readonly string[], event: string, payload: unknown): void {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
}

export function emitToRole(role: Role, event: string, payload: unknown): void {
  io?.to(`role:${role}`).emit(event, payload);
}
