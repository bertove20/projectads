'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { AlertItem, NotificationChannel, Severity } from '@/lib/types';

const SEV_TONE: Record<Severity, 'gray' | 'yellow' | 'red' | 'blue'> = { INFO: 'blue', WARNING: 'yellow', HIGH: 'red', CRITICAL: 'red' };
const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'];
const SEV_LABEL: Record<Severity, string> = { INFO: 'Info', WARNING: 'Peringatan', HIGH: 'Tinggi', CRITICAL: 'Kritis' };

function DeliverySummary({ deliveries }: { deliveries: AlertItem['deliveries'] }) {
  if (!deliveries.length) return <span className="text-muted">—</span>;
  const sent = deliveries.filter((d) => d.status === 'SENT').length;
  const failed = deliveries.filter((d) => d.status === 'FAILED');
  return (
    <span title={deliveries.map((d) => `${d.channel.name}: ${d.status.toLowerCase()}${d.error ? ` (${d.error})` : ''}`).join('\n')} className="whitespace-nowrap">
      {sent > 0 && <span className="text-success">{sent} terkirim</span>}
      {failed.length > 0 && <span className="ml-2 text-danger">{failed.length} gagal</span>}
      {sent === 0 && failed.length === 0 && <span className="text-muted">antre</span>}
    </span>
  );
}

function ChannelForm({ onDone }: { onDone: () => void }) {
  const action = useOrgAction();
  const [f, setF] = useState({ name: '', target: '', botToken: '', minSeverity: 'WARNING' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action.mutateAsync({ method: 'POST', path: '/notification-channels', body: f }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Buat bot lewat @BotFather di Telegram dan salin token-nya.</li>
        <li>Tambahkan bot ke grup tim (atau jadikan admin channel).</li>
        <li>Isi chat ID grup/channel (grup biasanya diawali -100…).</li>
      </ol>
      <Field label="Nama">
        <Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Grup Tim Ads" />
      </Field>
      <Field label="Chat ID" hint="Angka (mis. -1001234567890) atau @namachannel">
        <Input required value={f.target} onChange={(e) => setF({ ...f, target: e.target.value.trim() })} />
      </Field>
      <Field label="Token bot" hint="Disimpan terenkripsi; tidak akan ditampilkan lagi.">
        <Input required type="password" autoComplete="off" value={f.botToken} onChange={(e) => setF({ ...f, botToken: e.target.value.trim() })} />
      </Field>
      <Field label="Kirim mulai severity">
        <Select value={f.minSeverity} onChange={(e) => setF({ ...f, minSeverity: e.target.value })}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEV_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={action.isPending}>
        Simpan
      </Button>
    </form>
  );
}

function Channels() {
  const { org } = useSession();
  const channels = useOrgQuery<NotificationChannel[]>('/notification-channels');
  const action = useOrgAction();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Channel Telegram" actions={<Button size="sm" onClick={() => setAdding(true)}>+ Channel</Button>}>
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {msg && <Alert tone="green">{msg}</Alert>}
      {channels.isLoading ? (
        <Loading />
      ) : (
        <Table head={['Nama', 'Chat ID', 'Token', 'Mulai severity', 'Uji terakhir', 'Status', '']} empty={!channels.data?.length}>
          {channels.data?.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td className="tabular">{c.target}</Td>
              <Td className="text-muted">{c.secretHint}</Td>
              <Td>
                <Badge tone={SEV_TONE[c.minSeverity]}>{SEV_LABEL[c.minSeverity]}</Badge>
              </Td>
              <Td>{dateTime(c.lastTestAt, org.timezone)}</Td>
              <Td>{c.enabled ? <Badge tone="green">aktif</Badge> : <Badge>nonaktif</Badge>}</Td>
              <Td>
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ method: 'POST', path: `/notification-channels/${c.id}/test` }, { onSuccess: () => setMsg(`Pesan uji dikirim ke ${c.name}. Periksa Telegram.`) })}>
                    Kirim uji
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => action.mutate({ method: 'PATCH', path: `/notification-channels/${c.id}`, body: { enabled: !c.enabled } })}>
                    {c.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Drawer open={adding} title="Channel Telegram baru" onClose={() => setAdding(false)}>
        <ChannelForm onDone={() => setAdding(false)} />
      </Drawer>
    </Card>
  );
}

export default function AlertsPage() {
  const { can, org } = useSession();
  const [status, setStatus] = useState('OPEN');
  const alerts = useOrgQuery<AlertItem[]>(`/alerts${status ? `?status=${status}` : ''}`, { refetchInterval: 30_000 });
  const action = useOrgAction();
  const manage = can('alerts.manage');

  return (
    <RequirePermission permission="alerts.read">
      <PageHeader
        title="Alerts"
        description="Masalah operasional yang terdeteksi otomatis: sinkronisasi gagal, selisih rekonsiliasi, postback gagal permanen."
        actions={
          <Select aria-label="Status" className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="OPEN">Terbuka</option>
            <option value="ACKNOWLEDGED">Diakui</option>
            <option value="RESOLVED">Selesai</option>
            <option value="">Semua</option>
          </Select>
        }
      />
      <div className="space-y-5">
        <Card>
          {action.error && <Alert>{errorMessage(action.error)}</Alert>}
          {alerts.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Severity', 'Alert', 'Terakhir terlihat', 'Kejadian', 'Telegram', '']} empty={!alerts.data?.length}>
              {alerts.data?.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Badge tone={SEV_TONE[a.severity]}>{SEV_LABEL[a.severity]}</Badge>
                  </Td>
                  <Td>
                    <div className="font-medium">{a.title}</div>
                    <div className="max-w-xl text-xs text-muted">{a.body}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{dateTime(a.lastSeenAt, org.timezone)}</Td>
                  <Td numeric>{a.occurrences}</Td>
                  <Td>
                    <DeliverySummary deliveries={a.deliveries} />
                  </Td>
                  <Td>
                    {manage && a.status !== 'RESOLVED' && (
                      <span className="flex gap-1">
                        {a.status === 'OPEN' && (
                          <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ method: 'POST', path: `/alerts/${a.id}/acknowledge` })}>
                            Akui
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ method: 'POST', path: `/alerts/${a.id}/resolve` })}>
                          Selesai
                        </Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {can('notifications.manage') && <Channels />}
      </div>
    </RequirePermission>
  );
}
