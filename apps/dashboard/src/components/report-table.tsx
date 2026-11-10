'use client';

import { int, money, pct, signedMoney } from '@/lib/format';
import type { Report, ReportRow } from '@/lib/types';
import { cn, Notes, Table, Td } from './ui';

/** ROI sebagai teks berwarna (bukan pil) agar kolom angka tetap tenang dan sejajar. */
export function RoiBadge({ roi }: { roi: number | null }) {
  if (roi === null) return <span className="text-muted">—</span>;
  return <span className={cn('font-medium tabular', roi > 0 ? 'text-success' : roi < 0 ? 'text-danger' : 'text-muted')}>{pct(roi, 1)}</span>;
}

export function ProfitText({ value, currency }: { value: number; currency: string }) {
  return <span className={cn('tabular', value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-muted')}>{signedMoney(value, currency)}</span>;
}

export function ReportTable({ report, dimension }: { report: Report; dimension: string }) {
  const c = report.currency;
  const row = (r: ReportRow, total = false) => (
    <tr key={r.key ?? (total ? '__total' : '__null')} className={total ? 'border-t-2 border-border-strong font-semibold' : 'hover:bg-surface-2/60'}>
      <Td className="max-w-[18rem] truncate">{r.label}</Td>
      <Td numeric>{int(r.clicks)}</Td>
      <Td numeric className="text-muted">{int(r.botClicks)}</Td>
      <Td numeric>{int(r.conversions)}</Td>
      <Td numeric>{pct(r.cr)}</Td>
      <Td numeric>{money(r.revenue, c)}</Td>
      <Td numeric>
        {money(r.spend, c)}
        {r.spendSource === 'estimated' && <span title="Estimasi dari macro biaya per klik" className="ml-1 text-xs font-normal text-warning">est</span>}
      </Td>
      <Td numeric>
        <ProfitText value={r.profit} currency={c} />
      </Td>
      <Td numeric>{r.cpa === null ? <span className="text-muted">—</span> : money(r.cpa, c)}</Td>
      <Td numeric>{r.epc === null ? <span className="text-muted">—</span> : money(r.epc, c)}</Td>
      <Td numeric>
        <RoiBadge roi={r.roi} />
      </Td>
    </tr>
  );
  return (
    <Table head={[dimension, 'Klik', 'Bot', 'Konversi', 'CR', 'Revenue', 'Spend', 'Profit', 'CPA', 'EPC', 'ROI']} numericFrom={1} empty={report.rows.length === 0}>
      {report.rows.map((r) => row(r))}
      {report.rows.length > 1 && row(report.totals, true)}
    </Table>
  );
}

export function ReportNotes({ notes }: { notes: string[] }) {
  return <Notes items={notes} />;
}
