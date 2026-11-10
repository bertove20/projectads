'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { downloadCsv, int, money, pct } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Campaign, ZoneListEntry, ZoneReport } from '@/lib/types';
import { ProfitText, RoiBadge } from './report-table';
import { Alert, Badge, Button, Input, Loading, Notes, Select, Table, Td } from './ui';

const FLAG: Record<string, { label: string; tone: 'red' | 'yellow' | 'green' }> = {
  blacklist_candidate: { label: 'kandidat blacklist', tone: 'red' },
  high_bot_rate: { label: 'bot tinggi', tone: 'yellow' },
  whitelist_candidate: { label: 'kandidat whitelist', tone: 'green' },
};

export function ZonePanel({ campaign }: { campaign: Campaign }) {
  const { can } = useSession();
  const [days, setDays] = useState('7');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('');
  // Rentang dihitung server dalam zona waktu akun jaringan
  const report = useOrgQuery<ZoneReport>(`/campaigns/${campaign.id}/zones?days=${days}`);
  const lists = useOrgQuery<ZoneListEntry[]>(`/zone-lists?campaignId=${campaign.id}&networkAccountId=${campaign.networkAccount.id}`);
  const action = useOrgAction();
  const manage = can('campaigns.manage');

  const rows = (report.data?.rows ?? []).filter((r) => !filter || r.zoneId.includes(filter) || r.flags.some((f) => f.startsWith(filter)));
  const toggle = (z: string) => {
    const next = new Set(selected);
    if (next.has(z)) next.delete(z);
    else next.add(z);
    setSelected(next);
  };

  async function addTo(listType: 'BLACKLIST' | 'WHITELIST') {
    await action
      .mutateAsync({ method: 'POST', path: '/zone-lists', body: { networkAccountId: campaign.networkAccount.id, campaignId: campaign.id, zoneIds: [...selected], listType, ...(reason ? { reason } : {}) } })
      .then(() => {
        setSelected(new Set());
        setReason('');
      }, () => undefined);
  }

  const exportList = (type: 'BLACKLIST' | 'WHITELIST') => {
    const ids = (lists.data ?? []).filter((l) => l.listType === type).map((l) => ({ zone_id: l.zoneId, scope: l.campaign ? 'campaign' : 'account', reason: l.reason ?? '' }));
    downloadCsv(`${type.toLowerCase()}-${campaign.name.replace(/[^a-z0-9]+/gi, '-')}.csv`, ids);
  };
  const blCount = lists.data?.filter((l) => l.listType === 'BLACKLIST').length ?? 0;
  const wlCount = lists.data?.filter((l) => l.listType === 'WHITELIST').length ?? 0;
  const c = report.data?.currency ?? 'USD';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Rentang" className="h-8 w-32" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="1">Hari ini</option>
          <option value="3">3 hari</option>
          <option value="7">7 hari</option>
          <option value="14">14 hari</option>
          <option value="30">30 hari</option>
        </Select>
        <Select aria-label="Filter" className="h-8 w-44" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Semua zone</option>
          <option value="blacklist">Kandidat blacklist</option>
          <option value="high_bot">Bot tinggi</option>
          <option value="whitelist">Kandidat whitelist</option>
        </Select>
        <span className="ml-auto flex flex-wrap gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={!blCount} onClick={() => exportList('BLACKLIST')}>
            Ekspor blacklist ({blCount})
          </Button>
          <Button size="sm" variant="secondary" disabled={!wlCount} onClick={() => exportList('WHITELIST')}>
            Ekspor whitelist ({wlCount})
          </Button>
        </span>
      </div>
      {report.data && (
        <p className="text-xs text-muted">
          Tanggal dalam zona waktu {report.data.timezone}. Target CPA {report.data.targetCpa !== null ? money(report.data.targetCpa, c) : '—'}
          {report.data.targetSource === 'offer_payout' && ' (dari payout offer)'}
          {report.data.networkCurrency && report.data.networkCurrency !== c && <span className="text-warning">. Spend jaringan dalam {report.data.networkCurrency}, revenue dalam {c}</span>}
        </p>
      )}
      {(report.error || action.error) && <Alert>{errorMessage(report.error ?? action.error)}</Alert>}

      {manage && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
          <span className="text-sm font-medium">{selected.size} zone dipilih</span>
          <Input className="h-8 max-w-xs" placeholder="Alasan (opsional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="danger" disabled={action.isPending} onClick={() => addTo('BLACKLIST')}>
            Blacklist
          </Button>
          <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => addTo('WHITELIST')}>
            Whitelist
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Batal
          </Button>
        </div>
      )}

      {report.isLoading ? (
        <Loading />
      ) : (
        <Table
          head={[...(manage ? [''] : []), 'Zone', 'Spend', 'Klik jaringan', 'Klik internal', 'Bot', 'Konversi', 'Revenue', 'Profit', 'CPA', 'ROI', 'Catatan']}
          numericCols={Array.from({ length: 9 }, (_, i) => i + (manage ? 2 : 1))}
          empty={rows.length === 0}
          emptyText="Belum ada data zone. Data muncul setelah ada klik atau sinkronisasi jaringan."
        >
          {rows.map((z) => (
            <tr key={z.zoneId} className={z.listed?.listType === 'BLACKLIST' ? 'opacity-60' : undefined}>
              {manage && (
                <Td>
                  <input type="checkbox" aria-label={`Pilih zone ${z.zoneId}`} checked={selected.has(z.zoneId)} onChange={() => toggle(z.zoneId)} disabled={!z.zoneId} />
                </Td>
              )}
              <Td className="font-medium tabular">{z.zoneId || <span className="text-muted">(kosong)</span>}</Td>
              <Td numeric>
                {money(z.spend, c)}
                {z.spendSource === 'estimated' && <span className="ml-1 text-xs text-warning">est.</span>}
              </Td>
              <Td numeric>{z.networkClicks === null ? '—' : int(z.networkClicks)}</Td>
              <Td numeric>{int(z.clicks)}</Td>
              <Td numeric className={z.botRate !== null && z.botRate >= 0.5 ? 'text-warning' : 'text-muted'}>{pct(z.botRate, 0)}</Td>
              <Td numeric>{int(z.conversions)}</Td>
              <Td numeric>{money(z.revenue, c)}</Td>
              <Td numeric>
                <ProfitText value={z.profit} currency={c} />
              </Td>
              <Td numeric>{z.cpa === null ? '—' : money(z.cpa, c)}</Td>
              <Td numeric>
                <RoiBadge roi={z.roi} />
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {z.listed && <Badge tone={z.listed.listType === 'BLACKLIST' ? 'red' : 'green'}>{z.listed.listType === 'BLACKLIST' ? 'diblokir' : 'whitelist'}{z.listed.scope === 'account' ? ' (akun)' : ''}</Badge>}
                  {z.flags.map((f) => (
                    <Badge key={f} tone={FLAG[f]?.tone ?? 'gray'}>
                      {FLAG[f]?.label ?? f}
                    </Badge>
                  ))}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {report.data && <Notes title="Aturan rekomendasi" items={report.data.notes} />}
    </div>
  );
}
