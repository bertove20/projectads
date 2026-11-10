import type { Env } from '../config/env';

const trim = (u: string) => u.replace(/\/$/, '');

/** Base URL tracking link (klik, click-out, JS SDK). */
export function trackerBase(env: Pick<Env, 'TRACKER_PUBLIC_URL'>): string {
  return trim(env.TRACKER_PUBLIC_URL);
}

/** Base URL postback masuk dari affiliate network (subdomain terpisah, mis. pb.example.com). */
export function postbackBase(env: Pick<Env, 'TRACKER_PUBLIC_URL' | 'POSTBACK_PUBLIC_URL'>): string {
  return trim(env.POSTBACK_PUBLIC_URL ?? env.TRACKER_PUBLIC_URL);
}

/** Host (tanpa port) domain tracking utama — target CNAME untuk domain kustom. */
export function trackerHost(env: Pick<Env, 'TRACKER_PUBLIC_URL'>): string {
  return new URL(env.TRACKER_PUBLIC_URL).hostname;
}

/** Base URL untuk domain tracking kustom (selalu HTTPS; sertifikat diterbitkan Caddy). */
export function customDomainBase(hostname: string): string {
  return `https://${hostname}`;
}
