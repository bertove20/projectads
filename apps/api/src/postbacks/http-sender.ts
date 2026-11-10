import { lookup as dnsLookup, LookupAddress, LookupOneOptions } from 'dns';
import http from 'http';
import https from 'https';
import { isPrivateIp, UnsafeUrlError } from '../common/url';

export interface SendResult {
  statusCode: number;
  body: string;
}

const MAX_BODY = 4096;

/**
 * GET ke URL postback dengan perlindungan SSRF pada level koneksi:
 * IP hasil resolve DNS diperiksa saat socket dibuka (mencegah DNS rebinding),
 * redirect tidak diikuti, body respons dibatasi.
 */
export function sendPostback(
  url: URL,
  opts: { allowPrivate: boolean; timeoutMs?: number; userAgent?: string },
): Promise<SendResult> {
  const lib = url.protocol === 'https:' ? https : http;
  // Node >= 20 memanggil lookup dengan { all: true } (autoSelectFamily) dan mengharapkan array;
  // keduanya didukung. Setiap alamat diperiksa sebelum socket dibuka.
  const guardedLookup = (
    hostname: string,
    options: LookupOneOptions & { all?: boolean },
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, options.all ? [] : '', 0);
      const list = addresses ?? [];
      if (!list.length) return callback(new UnsafeUrlError(`Host ${hostname} tidak memiliki alamat`), options.all ? [] : '', 0);
      if (!opts.allowPrivate && list.some((a) => isPrivateIp(a.address))) {
        return callback(new UnsafeUrlError(`Host ${hostname} mengarah ke alamat internal`), options.all ? [] : '', 0);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'GET',
        timeout: opts.timeoutMs ?? 10_000,
        lookup: guardedLookup as unknown as typeof dnsLookup,
        headers: { 'User-Agent': opts.userAgent ?? 'EAIP-Postback/1.0', Accept: '*/*' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (size < MAX_BODY) {
            chunks.push(c);
            size += c.length;
          }
        });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}
