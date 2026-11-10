'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { RangePicker } from '@/components/range-picker';
import { ReportNotes, ReportTable } from '@/components/report-table';
import { Alert, Button, Card, Loading, PageHeader, Select } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { downloadCsv, presetRange } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Campaign, Report } from '@/lib/types';

const DIMENSIONS = [
  ['campaign', 'Campaign'],
  ['offer', 'Offer'],
  ['landing', 'Landing page'],
  ['network', 'Akun jaringan'],
  ['zone', 'Zone'],
  ['country', 'Negara'],
  ['device', 'Device'],
  ['os', 'OS'],
  ['day', 'Hari'],
] as const;

export default function ReportsPage() {
  const { org } = useSession();
  const [groupBy, setGroupBy] = useState('campaign');
  const [campaignId, setCampaignId] = useState('');
  const [preset, setPreset] = useState('7d');
  const range = useMemo(() => presetRange(preset, org.timezone), [preset, org.timezone]);
  const campaigns = useOrgQuery<Campaign[]>('/campaigns');
  const report = useOrgQuery<Report>(
    `/analytics/report?groupBy=${groupBy}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${campaignId ? `&campaignId=${campaignId}` : ''}`,
  );
  const dimLabel = DIMENSIONS.find(([k]) => k === groupBy)?.[1] ?? groupBy;

  const exportCsv = () =>
    downloadCsv(
      `laporan-${groupBy}-${preset}.csv`,
      (report.data?.rows ?? []).map((r) => ({
        [dimLabel]: r.label,
        klik: r.clicks,
        klik_bot: r.botClicks,
        konversi: r.conversions,
        pending: r.pendingConversions,
        cr: r.cr ?? '',
        revenue: r.revenue,
        spend: r.spend,
        sumber_spend: r.spendSource,
        profit: r.profit,
        cpa: r.cpa ?? '',
        epc: r.epc ?? '',
        roi: r.roi ?? '',
        mata_uang: report.data?.currency,
      })),
    );

  return (
    <RequirePermission permission="analytics.read">
      <PageHeader
        title="Analytics"
        description="Laporan ROI dengan pengelompokan bebas. Semua metrik memakai definisi di catatan bawah tabel."
        actions={
          <>
            <Select aria-label="Kelompokkan berdasarkan" className="h-8 w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {DIMENSIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  per {l}
                </option>
              ))}
            </Select>
            <Select aria-label="Campaign" className="h-8 w-48" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Semua campaign</option>
              {campaigns.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <RangePicker value={preset} onChange={setPreset} />
            <Button size="sm" variant="secondary" disabled={!report.data?.rows.length} onClick={exportCsv}>
              Ekspor CSV
            </Button>
          </>
        }
      />
      <Card>
        {report.error && <Alert>{errorMessage(report.error)}</Alert>}
        {report.data ? (
          <>
            <ReportTable report={report.data} dimension={dimLabel} />
            <ReportNotes notes={report.data.notes} />
          </>
        ) : (
          <Loading />
        )}
      </Card>
    </RequirePermission>
  );
}
