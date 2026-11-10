'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, getActiveOrg, setActiveOrg } from './api';
import type { Me, OrgSummary } from './types';

interface SessionValue {
  me: Me;
  org: OrgSummary;
  can: (permission: string) => boolean;
  switchOrg: (id: string) => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession harus dipakai di dalam <SessionProvider>');
  return ctx;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me', { org: false }),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

/** Membungkus halaman terautentikasi: memastikan login, MFA, dan organisasi aktif. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: (state: 'loading' | 'login' | 'mfa' | 'no-org') => ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useMe();
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    const me = meQuery.data;
    if (!me) return;
    const stored = getActiveOrg();
    const valid = me.organizations.find((o) => o.id === stored) ?? me.organizations[0];
    if (valid) {
      setActiveOrg(valid.id);
      setOrgId(valid.id);
    }
  }, [meQuery.data]);

  const switchOrg = useCallback(
    (id: string) => {
      setActiveOrg(id);
      setOrgId(id);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [qc],
  );

  const value = useMemo<SessionValue | null>(() => {
    const me = meQuery.data;
    if (!me || me.mfaRequired || me.mfaSetupRequired) return null;
    const org = me.organizations.find((o) => o.id === orgId);
    if (!org) return null;
    const perms = new Set(org.permissions);
    return {
      me,
      org,
      can: (p: string) => perms.has('*') || perms.has(p),
      switchOrg,
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: ['me'] });
      },
    };
  }, [meQuery.data, orgId, switchOrg, qc]);

  if (meQuery.isLoading) return <>{fallback('loading')}</>;
  if (meQuery.error) return <>{fallback(meQuery.error instanceof ApiError && meQuery.error.status === 401 ? 'login' : 'loading')}</>;
  const me = meQuery.data!;
  if (me.mfaRequired || me.mfaSetupRequired) return <>{fallback('mfa')}</>;
  if (!me.organizations.length) return <>{fallback('no-org')}</>;
  if (!value) return <>{fallback('loading')}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
