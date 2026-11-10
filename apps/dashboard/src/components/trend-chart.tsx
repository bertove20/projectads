'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/format';
import type { ReportRow } from '@/lib/types';

/**
 * Revenue vs Spend per hari. Satu sumbu (keduanya mata uang yang sama), garis 2px,
 * tooltip crosshair, legend selalu ada untuk 2 seri. Tabel data tersedia di bawah chart.
 */
export function TrendChart({ rows, currency }: { rows: ReportRow[]; currency: string }) {
  const data = rows.map((r) => ({ day: r.key ?? '', revenue: r.revenue, spend: r.spend }));
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted">Belum ada data pada rentang ini.</p>;
  return (
    <div className="h-64 w-full" role="img" aria-label="Grafik revenue dan spend per hari">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickFormatter={(d: string) => d.slice(5)}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--text)' }}
            formatter={(v: number, name: string) => [money(v, currency), name]}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
          <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--series-1)" strokeWidth={2} dot={data.length === 1 ? { r: 4 } : false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
          <Line type="monotone" dataKey="spend" name="Spend" stroke="var(--series-2)" strokeWidth={2} dot={data.length === 1 ? { r: 4 } : false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
