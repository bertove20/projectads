'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/session';

export default function MfaPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode = me.data?.mfaSetupRequired ? 'setup' : me.data?.mfaRequired ? 'verify' : 'done';

  useEffect(() => {
    if (me.error) router.replace('/login');
    if (me.data && mode === 'done') router.replace('/');
  }, [me.data, me.error, mode, router]);

  useEffect(() => {
    if (mode !== 'setup' || setup) return;
    api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST', org: false })
      .then(async (r) => setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 200 }) }))
      .catch((err) => setError(errorMessage(err)));
  }, [mode, setup]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(mode === 'setup' ? '/auth/mfa/enable' : '/auth/mfa/verify', { method: 'POST', body: { code }, org: false });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', org: false }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }

  if (!me.data || mode === 'done') return <Loading />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6">
        <div>
          <h1 className="text-lg font-semibold">{mode === 'setup' ? 'Aktifkan verifikasi 2 langkah' : 'Verifikasi 2 langkah'}</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === 'setup'
              ? 'Akun administrator wajib memakai aplikasi authenticator (Google Authenticator, Authy, 1Password, dll.).'
              : 'Masukkan 6 digit kode dari aplikasi authenticator Anda.'}
          </p>
        </div>
        {error && <Alert>{error}</Alert>}
        {mode === 'setup' &&
          (setup ? (
            <div className="space-y-2">
              <p className="text-sm">1. Pindai QR code ini:</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR code MFA" width={200} height={200} className="rounded border border-border bg-white p-1" />
              <p className="text-xs text-muted">
                Atau masukkan kunci manual: <code className="break-all">{setup.secret}</code>
              </p>
              <p className="text-sm">2. Masukkan kode yang muncul:</p>
            </div>
          ) : (
            <Loading label="Menyiapkan…" />
          ))}
        <Field label="Kode 6 digit">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? 'Memeriksa…' : mode === 'setup' ? 'Aktifkan' : 'Verifikasi'}
        </Button>
        <button type="button" onClick={logout} className="w-full text-center text-sm text-muted hover:underline">
          Keluar
        </button>
      </form>
    </main>
  );
}
