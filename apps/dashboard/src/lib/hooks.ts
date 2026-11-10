'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

/** GET berbasis organisasi aktif; key otomatis menyertakan org agar cache tidak tercampur. */
export function useOrgQuery<T>(path: string | null, opts: { refetchInterval?: number } = {}) {
  const { org } = useSession();
  return useQuery({
    queryKey: [org.id, path],
    queryFn: () => api<T>(path!),
    enabled: !!path,
    refetchInterval: opts.refetchInterval,
  });
}

export interface ActionInput {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

/** Aksi tulis; meng-invalidate cache organisasi aktif setelah berhasil. */
export function useOrgAction<TResult = unknown>() {
  const { org } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ActionInput) => api<TResult>(a.path, { method: a.method, body: a.method === 'DELETE' ? undefined : (a.body ?? {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [org.id] }),
  });
}

/** Hapus field kosong agar validasi server tidak menolak string kosong. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as Partial<T>;
}
