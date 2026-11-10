'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useOrgAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { WebsiteWithSdk } from '@/lib/types';
import { Alert, Button, CopyText, Field, Input } from './ui';

const EXAMPLES = `<!-- Saat pengunjung mulai mengisi form -->
<form onfocusin="eaip('track', 'registration_started')" onsubmit="eaip('track', 'registration_submitted')">

<!-- Di halaman "terima kasih" setelah registrasi -->
<script>eaip('track', 'registration_success_observed')</script>

<!-- Tombol menuju offer: href diisi otomatis dengan link click-out -->
<a data-eaip-clickout href="#">Daftar sekarang</a>

<!-- Bila website mewajibkan consent: panggil setelah pengunjung setuju -->
<script>eaip('consent', true)</script>`;

export function SdkSetup({ site }: { site: WebsiteWithSdk }) {
  const { can } = useSession();
  const action = useOrgAction<WebsiteWithSdk>();
  const [domains, setDomains] = useState(site.extraDomains.join(', '));
  const [msg, setMsg] = useState<string | null>(null);
  const manage = can('websites.manage');

  const run = async (method: 'POST' | 'PATCH', path: string, body: unknown, ok: string) => {
    setMsg(null);
    await action.mutateAsync({ method, path, body }).then(() => setMsg(ok), () => undefined);
  };

  return (
    <div className="space-y-5">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {msg && <Alert tone="green">{msg}</Alert>}

      {!site.sdkKey ? (
        <div className="space-y-2">
          <p className="text-[13px] text-muted">Buat kunci SDK untuk mendapatkan kode pemasangan. Event hanya diterima dari {site.domain} dan subdomain-nya.</p>
          {manage && (
            <Button onClick={() => run('POST', `/websites/${site.id}/sdk-key`, {}, 'Kunci SDK dibuat.')} disabled={action.isPending}>
              Buat kunci SDK
            </Button>
          )}
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold">1. Pasang di &lt;head&gt; setiap halaman</h3>
            <CopyText value={site.sdkSnippet ?? ''} />
            <p className="text-xs text-muted">SDK otomatis mencatat page_view, dan landing_view bila pengunjung datang dari tracking link (parameter cid).</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold">2. Tandai langkah registrasi</h3>
            <pre className="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed break-words whitespace-pre-wrap">{EXAMPLES}</pre>
            <p className="text-xs text-muted">
              Event dari browser berstatus <b>observed</b>: dipakai untuk funnel, tidak pernah dihitung sebagai konversi. Konversi tetap hanya dari postback affiliate network. Data seperti email atau nomor telepon
              otomatis dibuang.
            </p>
          </section>
          {manage && (
            <section className="space-y-3 border-t border-border pt-4">
              <h3 className="text-[13px] font-semibold">Pengaturan</h3>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={site.requireConsent}
                  onChange={(e) => run('PATCH', `/websites/${site.id}`, { requireConsent: e.target.checked }, e.target.checked ? 'Consent sekarang wajib.' : 'Consent tidak lagi wajib.')}
                />
                <span>
                  Wajibkan consent
                  <span className="block text-xs text-muted">Event ditahan sampai halaman memanggil eaip(&apos;consent&apos;, true). Disarankan untuk pengunjung dari EU/EEA dan Inggris.</span>
                </span>
              </label>
              <Field label="Domain tambahan" hint={`Selain ${site.domain} dan subdomain-nya. Pisahkan dengan koma.`}>
                <div className="flex gap-2">
                  <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="promo-lain.com" />
                  <Button
                    variant="secondary"
                    disabled={action.isPending}
                    onClick={() => run('PATCH', `/websites/${site.id}`, { extraDomains: domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean) }, 'Domain tambahan disimpan.')}
                  >
                    Simpan
                  </Button>
                </div>
              </Field>
              <div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm('Buat kunci baru? Kode yang sudah terpasang dengan kunci lama berhenti mengirim event sampai diganti.')) {
                      void run('POST', `/websites/${site.id}/sdk-key`, {}, 'Kunci baru dibuat. Ganti kode yang terpasang di website.');
                    }
                  }}
                >
                  Rotasi kunci SDK
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
