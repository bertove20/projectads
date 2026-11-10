'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { RangePicker } from '@/components/range-picker';
import { ReportTable } from '@/components/report-table';
import { TrendChart } from '@/components/trend-chart';
import { Alert, Card, cn, Loading, Notes, PageHeader } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { int, money, pct, presetRange, signedMoney } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Report, ReportRow } from '@/lib/types';

const RANGE_LABEL: Record<string, string> = { today: 'hari ini', yesterday: 'kemarin', '7d': '7 hari terakhir', '30d': '30 hari terakhir', '90d': '90 hari terakhir' };

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-lg font-semibold tabular">{value}</dd>
      {detail && <dd className="truncate text-xs text-muted">{detail}</dd>}
    </div>
  );
}

/** Baris laba-rugi: profit sebagai angka utama, metrik pendukung di sampingnya. */
function PnlLine({ t, currency, range }: { t: ReportRow; currency: string; range: string }) {
  const tone = t.profit > 0 ? 'text-success' : t.profit < 0 ? 'text-danger' : 'text-text';
  const spendDetail = t.spendSource === 'reported' ? 'dari laporan jaringan / input' : t.spendSource === 'estimated' ? 'estimasi dari biaya per klik' : 'belum ada data spend';
  return (
    <section aria-label="Laba rugi" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <div className="border-b border-border px-5 py-4 lg:border-r lg:border-b-0">
          <p className="text-[13px] text-muted">Profit {RANGE_LABEL[range] ?? ''}</p>
          <p className={cn('mt-1 text-[34px] leading-none font-semibold tracking-tight tabular', tone)}>{signedMoney(t.profit, currency)}</p>
          <p className="mt-2 text-[13px] text-muted">
            ROI <span className={cn('font-medium tabular', tone)}>{pct(t.roi, 1)}</span>
            {t.cpa !== null && (
              <>
                <span className="mx-2 text-border-strong">|</span>CPA <span className="font-medium text-text tabular">{money(t.cpa, currency)}</span>
              </>
            )}
          </p>
        </div>
        <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x [&>div:nth-child(-n+2)]:border-b [&>div:nth-child(-n+2)]:border-border sm:[&>div:nth-child(-n+2)]:border-b-0">
          <Metric label="Revenue" value={money(t.revenue, currency)} detail="konversi verified" />
          <Metric label="Spend" value={money(t.spend, currency)} detail={spendDetail} />
          <Metric label="Klik" value={int(t.clicks)} detail={`${int(t.botClicks)} bot dipisahkan`} />
          <Metric label="Konversi" value={int(t.conversions)} detail={`CR ${pct(t.cr)}, ${int(t.pendingConversions)} pending`} />
        </dl>
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const { org } = useSession();
  const [preset, setPreset] = useState('7d');
  const range = useMemo(() => presetRange(preset, org.timezone), [preset, org.timezone]);
  const qs = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const byDay = useOrgQuery<Report>(`/analytics/report?groupBy=day&${qs}`, { refetchInterval: 60_000 });
  const byCampaign = useOrgQuery<Report>(`/analytics/report?groupBy=campaign&${qs}`, { refetchInterval: 60_000 });
  const report = byCampaign.data;

  return (
    <RequirePermission permission="analytics.read">
      <PageHeader
        title="Overview"
        description={report ? `Zona waktu laporan ${report.timezone}, diperbarui setiap menit.` : undefined}
        actions={<RangePicker value={preset} onChange={setPreset} />}
      />
      {byCampaign.error && <Alert>{errorMessage(byCampaign.error)}</Alert>}
      {!report ? (
        <Loading rows={6} />
      ) : (
        <div className="space-y-5">
          <PnlLine t={report.totals} currency={report.currency} range={preset} />
          <Card title="Revenue dan spend per hari">{byDay.data ? <TrendChart rows={byDay.data.rows} currency={byDay.data.currency} /> : <Loading />}</Card>
          <Card
            title="Campaign"
            actions={
              <Link href="/reports" className="text-[13px] font-medium text-primary hover:underline">
                Buka analytics
              </Link>
            }
          >
            <ReportTable report={report} dimension="Campaign" />
            <Notes items={report.notes} />
          </Card>
        </div>
      )}
    </RequirePermission>
  );
}
