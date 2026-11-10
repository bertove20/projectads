'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { RangePicker } from '@/components/range-picker';
import { Alert, Button, Card, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime, downloadCsv, money, presetRange } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Conversion } from '@/lib/types';

const STATUSES = ['VERIFIED', 'PENDING_VERIFICATION', 'REJECTED', 'REVOKED', 'OBSERVED'];

export default function ConversionsPage() {
  const { org } = useSession();
  const [preset, setPreset] = useState('7d');
  const [status, setStatus] = useState('');
  const range = useMemo(() => presetRange(preset, org.timezone), [preset, org.timezone]);
  const list = useOrgQuery<Conversion[]>(
    `/conversions?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&limit=200${status ? `&status=${status}` : ''}`,
  );

  const exportCsv = () =>
    downloadCsv(
      `konversi-${preset}.csv`,
      (list.data ?? []).map((c) => ({
        waktu: c.createdAt,
        status: c.status,
        campaign: c.campaign.name,
        offer: c.offer?.name ?? '',
        affiliate: c.affiliateNetwork?.name ?? '',
        goal: c.goal,
        payout: c.payout,
        currency: c.currency,
        transaction_id: c.transactionId ?? '',
        click_id: c.clickId,
        postback: c.deliveries.map((d) => d.status).join('|'),
      })),
    );

  return (
    <RequirePermission permission="conversions.read">
      <PageHeader
        title="Konversi"
        description="VERIFIED = dikonfirmasi postback affiliate network yang terautentikasi. Hanya status ini yang dihitung sebagai revenue."
        actions={
          <>
            <Select aria-label="Status" className="h-8 w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            <RangePicker value={preset} onChange={setPreset} />
            <Button size="sm" variant="secondary" disabled={!list.data?.length} onClick={exportCsv}>
              Ekspor CSV
            </Button>
          </>
        }
      />
      <Card>
        {list.error && <Alert>{errorMessage(list.error)}</Alert>}
        {list.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Waktu', 'Status', 'Campaign', 'Offer', 'Goal', 'Payout', 'Transaction ID', 'Postback']} empty={!list.data?.length}>
            {list.data?.map((c) => (
              <tr key={c.id}>
                <Td className="whitespace-nowrap">{dateTime(c.createdAt, org.timezone)}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td>{c.campaign.name}</Td>
                <Td>{c.offer?.name ?? '—'}</Td>
                <Td>{c.goal}</Td>
                <Td numeric>{money(c.payout, c.currency)}</Td>
                <Td className="max-w-[10rem] truncate text-xs text-muted">{c.transactionId ?? '—'}</Td>
                <Td>{c.deliveries.length ? c.deliveries.map((d) => <StatusBadge key={d.id} status={d.status} />) : <span className="text-xs text-muted">—</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
        {list.data?.length === 200 && <p className="mt-2 text-xs text-muted">Menampilkan 200 terbaru. Persempit rentang tanggal untuk melihat lainnya.</p>}
      </Card>
    </RequirePermission>
  );
}
