'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ mfaRequired: boolean; mfaSetupRequired: boolean }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        org: false,
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(r.mfaRequired || r.mfaSetupRequired ? '/mfa' : '/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6">
        <div>
          <h1 className="text-lg font-semibold">Masuk ke EAIP</h1>
          <p className="text-sm text-muted">Enterprise Ads Intelligence Platform</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Memproses…' : 'Masuk'}
        </Button>
      </form>
    </main>
  );
}
