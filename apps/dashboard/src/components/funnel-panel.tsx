'use client';

import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { int, pct } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import type { FunnelReport } from '@/lib/types';
import { Alert, Badge, Loading, Notes } from './ui';

const SOURCE: Record<FunnelReport['stages'][number]['source'], { label: string; tone: 'gray' | 'blue' | 'green' }> = {
  tracker: { label: 'tracker', tone: 'gray' },
  sdk_observed: { label: 'observed', tone: 'blue' },
  postback_verified: { label: 'verified', tone: 'green' },
};

/**
 * Funnel per klik unik. Satu warna (series-1) karena semua batang mengukur hal yang sama (jumlah klik);
 * label dan angka ditulis langsung di sebelah batang, tabel tidak diperlukan.
 */
export function FunnelPanel({ campaignId, from, to }: { campaignId: string; from: string; to: string }) {
  const q = useOrgQuery<FunnelReport>(`/analytics/funnel?campaignId=${campaignId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  const f = q.data!;
  const max = Math.max(1, ...f.stages.map((s) => s.count));
  return (
    <div className="space-y-3">
      {!f.sdkActive && (
        <Alert tone="blue">
          Tahap landing dan registrasi muncul setelah JS SDK dipasang di landing page. Buka <Link href="/websites" className="underline">Websites & landing</Link> untuk kode pemasangannya.
        </Alert>
      )}
      <ol className="space-y-2" aria-label="Funnel konversi">
        {f.stages.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[minmax(0,15rem)_1fr_auto]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{s.label}</span>
              <Badge tone={SOURCE[s.source].tone}>{SOURCE[s.source].label}</Badge>
            </span>
            <span className="order-3 col-span-2 h-5 rounded-sm bg-surface-2 sm:order-none sm:col-span-1" aria-hidden>
              <span className="block h-full rounded-sm" style={{ width: `${(s.count / max) * 100}%`, background: 'var(--series-1)', minWidth: s.count > 0 ? 2 : 0 }} />
            </span>
            <span className="whitespace-nowrap text-right tabular sm:w-40">
              <span className="font-medium">{int(s.count)}</span>
              {i > 0 && <span className="ml-2 text-xs text-muted">{s.rateFromPrevious === null ? '—' : `${pct(s.rateFromPrevious, 1)} lanjut`}</span>}
            </span>
          </li>
        ))}
      </ol>
      <Notes items={f.notes} />
    </div>
  );
}
