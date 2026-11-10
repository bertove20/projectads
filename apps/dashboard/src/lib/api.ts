/** Klien API: same-origin (/api/v1), cookie session httpOnly, header organisasi aktif. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const ORG_KEY = 'eaip.org';

export function getActiveOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrg(id: string) {
  try {
    localStorage.setItem(ORG_KEY, id);
  } catch {
    /* penyimpanan tidak tersedia: org tetap dipakai selama sesi halaman */
  }
  memoryOrg = id;
}

let memoryOrg: string | null = null;

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; org?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.org !== false) {
    const org = memoryOrg ?? getActiveOrg();
    if (org) headers['X-Organization-Id'] = org;
  }
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? `HTTP ${res.status}`, err.details);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details) && err.details.length) return `${err.message}: ${err.details.join('; ')}`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Terjadi kesalahan';
}
