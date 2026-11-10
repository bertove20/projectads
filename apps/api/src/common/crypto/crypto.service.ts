import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ENV, Env } from '../../config/env';

/**
 * Enkripsi kredensial (AES-256-GCM), hash token, dan hash IP.
 * Format ciphertext: v<keyVersion>:<iv>:<tag>:<data> (base64).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly keyVersion: number;
  private readonly ipSecret: string;

  constructor(@Inject(ENV) env: Pick<Env, 'APP_ENCRYPTION_KEY' | 'APP_ENCRYPTION_KEY_VERSION' | 'IP_HASH_SECRET'>) {
    this.key = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
    this.keyVersion = env.APP_ENCRYPTION_KEY_VERSION;
    this.ipSecret = env.IP_HASH_SECRET;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v${this.keyVersion}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ver, ivB64, tagB64, dataB64] = payload.split(':');
    if (!ver?.startsWith('v') || !ivB64 || !tagB64 || dataB64 === undefined) {
      throw new Error('Format ciphertext tidak valid');
    }
    if (Number(ver.slice(1)) !== this.keyVersion) {
      // Rotasi kunci: tambahkan dukungan multi-key di sini saat diperlukan.
      throw new Error(`Ciphertext memakai versi kunci ${ver}, kunci aktif v${this.keyVersion}`);
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Token acak url-safe. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Hash IP dengan HMAC agar tidak bisa dibalik tanpa secret. */
  hashIp(ip: string | undefined | null): string | null {
    if (!ip) return null;
    return createHmac('sha256', this.ipSecret).update(ip).digest('hex').slice(0, 32);
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }

  /** Petunjuk aman untuk UI, mis. "…a1b2". */
  hint(secret: string): string {
    return secret.length <= 4 ? '…' : `…${secret.slice(-4)}`;
  }
}
