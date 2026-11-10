'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { RangePicker } from '@/components/range-picker';
import { Alert, Badge, Button, Card, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime, presetRange } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Delivery, InboundLog } from '@/lib/types';

export default function PostbacksPage() {
  const { can, org } = useSession();
  const [tab, setTab] = useState<'out' | 'in'>('out');
  const [preset, setPreset] = useState('7d');
  const [status, setStatus] = useState('');
  const range = useMemo(() => presetRange(preset, org.timezone), [preset, org.timezone]);
  const qs = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&limit=200`;
  const deliveries = useOrgQuery<Delivery[]>(tab === 'out' ? `/postbacks/deliveries?${qs}${status ? `&status=${status}` : ''}` : null, { refetchInterval: 15_000 });
  const inbound = useOrgQuery<InboundLog[]>(tab === 'in' ? `/postbacks/inbound?${qs}` : null, { refetchInterval: 15_000 });
  const retry = useOrgAction();

  return (
    <RequirePermission permission="postbacks.read">
      <PageHeader
        title="Postbacks"
        description="Postback keluar ke jaringan iklan dan postback masuk dari affiliate network."
        actions={<RangePicker value={preset} onChange={setPreset} />}
      />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'out' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('out')}>
          Keluar (ke jaringan iklan)
        </Button>
        <Button variant={tab === 'in' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('in')}>
          Masuk (dari affiliate)
        </Button>
      </div>
      {retry.error && <Alert>{errorMessage(retry.error)}</Alert>}

      {tab === 'out' ? (
        <Card
          title="Pengiriman postback"
          actions={
            <Select aria-label="Filter status" className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua status</option>
              {['QUEUED', 'DELIVERED', 'FAILED', 'DEAD', 'TEST_SKIPPED'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          }
        >
          {deliveries.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Waktu', 'Jaringan', 'Status', 'Diterima provider', 'Percobaan', 'HTTP', 'Host', 'Error', '']} empty={!deliveries.data?.length}>
              {deliveries.data?.map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap">{dateTime(d.createdAt, org.timezone)}</Td>
                  <Td>{d.networkAccount.name}</Td>
                  <Td>
                    <StatusBadge status={d.status} />
                  </Td>
                  <Td>{d.providerAccepted === null ? <span className="text-muted" title="Atur pola respons sukses di Jaringan Iklan">tidak diketahui</span> : d.providerAccepted ? <Badge tone="green">ya</Badge> : <Badge tone="red">tidak</Badge>}</Td>
                  <Td numeric>{d.attempts}</Td>
                  <Td numeric>{d.lastStatusCode ?? '—'}</Td>
                  <Td>{d.targetHost ?? '—'}</Td>
                  <Td className="max-w-xs truncate text-xs text-muted">{d.lastError ?? ''}</Td>
                  <Td>
                    {can('postbacks.retry') && ['FAILED', 'DEAD'].includes(d.status) && (
                      <Button size="sm" variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate({ method: 'POST', path: `/postbacks/deliveries/${d.id}/retry` })}>
                        Kirim ulang
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <Card title="Log postback masuk">
          {inbound.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Waktu', 'Affiliate', 'Hasil', 'Pesan', 'Parameter']} empty={!inbound.data?.length}>
              {inbound.data?.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{dateTime(r.receivedAt, org.timezone)}</Td>
                  <Td>{r.affiliateNetwork.name}</Td>
                  <Td>
                    <StatusBadge status={r.result} />
                  </Td>
                  <Td className="text-xs text-muted">{r.message ?? ''}</Td>
                  <Td>
                    <code className="block max-w-md truncate text-xs">{new URLSearchParams(r.params).toString()}</code>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </RequirePermission>
  );
}
