import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Role } from '@innovexa/shared';
import { api, setSessionExpiredHandler, type ApiEnvelope } from '@/lib/api';
import type { User } from '@/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

export const PORTAL_HOME: Record<Role, string> = {
  [Role.ADMIN]: '/admin/dashboard',
  [Role.PARTNER]: '/partner/dashboard',
  [Role.CLIENT]: '/client/dashboard',
};

async function fetchMe(): Promise<User | null> {
  try {
    const res = await api.get<ApiEnvelope<{ user: User }>>('/auth/me');
    return res.data.data.user;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const setUser = useCallback((user: User | null) => qc.setQueryData(ME_KEY, user), [qc]);

  /**
   * Signs the user out locally. The /auth/me query is never removed: removing it
   * would leave the observer holding the previous user, so guards would still
   * treat the visitor as signed in. Instead it is set to null and every other
   * cached query (all user-scoped data) is cancelled and dropped.
   */
  const resetSession = useCallback(() => {
    const isOther = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== ME_KEY[0];
    void qc.cancelQueries({ predicate: isOther });
    qc.setQueryData(ME_KEY, null);
    qc.removeQueries({ predicate: isOther });
  }, [qc]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      resetSession();
    }
  }, [resetSession]);

  useEffect(() => {
    setSessionExpiredHandler(resetSession);
  }, [resetSession]);

  const value = useMemo(
    () => ({ user: data ?? null, isLoading, setUser, logout }),
    [data, isLoading, setUser, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
