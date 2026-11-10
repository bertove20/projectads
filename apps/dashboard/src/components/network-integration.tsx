'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { NetworkAccount, RemoteCampaign, SyncRun } from '@/lib/types';
import { Alert, Badge, Button, Input, Loading, Table, Td } from './ui';

const SYNC_TONE = { SUCCESS: 'green', PARTIAL: 'yellow', FAILED: 'red', RUNNING: 'blue' } as const;

export function SyncBadge({ status }: { status: NetworkAccount['lastSyncStatus'] }) {
  if (!status) return <Badge>belum</Badge>;
  return <Badge tone={SYNC_TONE[status]}>{status.toLowerCase()}</Badge>;
}

/** Panel integrasi API (saat ini hanya RollerAds — read.md Bagian 20). */
export function NetworkIntegration({ account }: { account: NetworkAccount }) {
  const { can, org } = useSession();
  const action = useOrgAction<{ account?: { title: string; timezone: string; currency: string }; timezoneRecognized?: boolean }>();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [showRemote, setShowRemote] = useState(false);
  const runs = useOrgQuery<SyncRun[]>(account.apiConfigured ? `/network-accounts/${account.id}/sync-runs` : null, { refetchInterval: 10_000 });
  const remote = useOrgQuery<RemoteCampaign[]>(showRemote ? `/network-accounts/${account.id}/remote-campaigns` : null);

  if (account.network !== 'ROLLERADS') {
    return (
      <Alert tone="yellow">
        Integrasi API untuk jaringan ini belum tersedia karena dokumentasi API resminya belum diverifikasi. Catat spend secara manual di halaman campaign.
      </Alert>
    );
  }

  async function saveToken() {
    setMsg(null);
    const r = await action.mutateAsync({ method: 'PUT', path: `/network-accounts/${account.id}/api-token`, body: { token } }).catch(() => null);
    if (r) {
      setToken('');
      setMsg(`Terhubung ke akun "${r.account?.title}". Zona waktu ${r.account?.timezone}${r.timezoneRecognized ? '' : ' (tidak dikenali, rekonsiliasi memakai UTC)'}, mata uang ${r.account?.currency}.`);
    }
  }

  return (
    <div className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {msg && <Alert tone="green">{msg}</Alert>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Status API</dt>
        <dd>{account.apiConfigured ? <Badge tone="green">terhubung</Badge> : <Badge tone="yellow">belum</Badge>}</dd>
        {account.apiConfigured && (
          <>
            <dt className="text-muted">ID akun RollerAds</dt>
            <dd className="tabular">{account.externalAccountId}</dd>
            <dt className="text-muted">Zona waktu laporan</dt>
            <dd>{account.networkTimezone ?? <span className="text-warning">tidak dikenali → UTC</span>}</dd>
            <dt className="text-muted">Mata uang</dt>
            <dd>{account.networkCurrency ?? '—'}</dd>
            <dt className="text-muted">Sinkronisasi terakhir</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <SyncBadge status={account.lastSyncStatus} /> {dateTime(account.lastSyncAt, org.timezone)}
            </dd>
          </>
        )}
      </dl>
      {account.lastSyncError && <Alert tone="yellow">{account.lastSyncError}</Alert>}

      {can('networks.credentials') && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Access token diminta ke account manager RollerAds. Disimpan terenkripsi, dikirim lewat header <code>X-ACCESS-TOKEN</code>, dan tidak akan ditampilkan lagi.
          </p>
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" placeholder={account.apiConfigured ? 'Ganti token…' : 'Tempel access token'} value={token} onChange={(e) => setToken(e.target.value)} />
            <Button size="sm" disabled={token.length < 8 || action.isPending} onClick={saveToken}>
              {action.isPending ? 'Menguji…' : 'Simpan & uji'}
            </Button>
          </div>
        </div>
      )}

      {account.apiConfigured && can('networks.manage') && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ method: 'POST', path: `/network-accounts/${account.id}/sync` }, { onSuccess: () => setMsg('Sinkronisasi diantrikan. Hasilnya muncul di riwayat di bawah.') })}>
            Sinkronkan sekarang
          </Button>
          <Button size="sm" variant="ghost" onClick={() => action.mutate({ method: 'PUT', path: `/network-accounts/${account.id}/sync-settings`, body: { syncEnabled: !account.syncEnabled } })}>
            {account.syncEnabled ? 'Matikan sinkronisasi otomatis' : 'Aktifkan sinkronisasi otomatis'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowRemote(!showRemote)}>
            {showRemote ? 'Sembunyikan' : 'Lihat'} campaign di RollerAds
          </Button>
        </div>
      )}

      {showRemote && (
        <div>
          <p className="mb-2 text-xs text-muted">Isi “ID campaign di jaringan” pada campaign internal agar spend & statistik tersambung.</p>
          {remote.error && <Alert>{errorMessage(remote.error)}</Alert>}
          {remote.isLoading ? (
            <Loading />
          ) : (
            <Table head={['ID', 'Nama di RollerAds', 'Status', 'Dipetakan ke']} empty={!remote.data?.length}>
              {remote.data?.map((r) => (
                <tr key={r.campaign_id}>
                  <Td numeric>{r.campaign_id}</Td>
                  <Td>{r.campaign_title}</Td>
                  <Td>{r.campaign_status}</Td>
                  <Td>{r.mappedTo ? r.mappedTo.name : <Badge tone="yellow">belum</Badge>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      {account.apiConfigured && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Riwayat sinkronisasi</h4>
          {runs.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Mulai', 'Pemicu', 'Status', 'Request', 'Baris', 'Belum dipetakan']} empty={!runs.data?.length}>
              {runs.data?.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{dateTime(r.startedAt, org.timezone)}</Td>
                  <Td>{r.trigger}</Td>
                  <Td>
                    <SyncBadge status={r.status} />
                    {r.error && <p className="mt-1 max-w-xs text-xs text-muted">{r.error}</p>}
                  </Td>
                  <Td numeric>{r.requestCount}</Td>
                  <Td numeric>{r.rowsUpserted}</Td>
                  <Td className="text-xs">{r.unmappedCampaigns.length ? r.unmappedCampaigns.join(', ') : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
