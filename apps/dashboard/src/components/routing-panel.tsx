'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { int, money, pct } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Campaign, CampaignRouteItem, LandingPage, Offer, RouteConditions, SplitTestReport, Verdict } from '@/lib/types';
import { Alert, Badge, Button, cn, Input, Loading, Notes, Select, Table, Td } from './ui';

/** Bentuk yang diedit di form (daftar dipisah koma untuk kondisi). */
interface DraftVariant {
  label: string;
  offerId: string;
  landingPageId: string;
  weight: number;
  enabled: boolean;
}
interface DraftRoute {
  name: string;
  enabled: boolean;
  countries: string;
  devices: string;
  os: string;
  browsers: string;
  languages: string;
  variants: DraftVariant[];
}

const COND_FIELDS: Array<{ key: keyof RouteConditions; label: string; placeholder: string }> = [
  { key: 'countries', label: 'Negara', placeholder: 'ID, MY' },
  { key: 'devices', label: 'Device', placeholder: 'mobile, tablet' },
  { key: 'os', label: 'OS', placeholder: 'Android, iOS' },
  { key: 'browsers', label: 'Browser', placeholder: 'Chrome' },
  { key: 'languages', label: 'Bahasa', placeholder: 'id, en' },
];

const VERDICT: Record<Verdict, { label: string; tone: 'gray' | 'green' | 'red' | 'blue' | 'yellow' }> = {
  control: { label: 'kontrol', tone: 'gray' },
  insufficient_data: { label: 'data belum cukup', tone: 'yellow' },
  no_difference: { label: 'tidak berbeda nyata', tone: 'gray' },
  better: { label: 'lebih baik', tone: 'green' },
  worse: { label: 'lebih buruk', tone: 'red' },
};

const split = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

function toDraft(r: CampaignRouteItem): DraftRoute {
  const c = r.conditions ?? {};
  return {
    name: r.name,
    enabled: r.enabled,
    countries: (c.countries ?? []).join(', '),
    devices: (c.devices ?? []).join(', '),
    os: (c.os ?? []).join(', '),
    browsers: (c.browsers ?? []).join(', '),
    languages: (c.languages ?? []).join(', '),
    variants: r.variants.map((v) => ({ label: v.label, offerId: v.offerId, landingPageId: v.landingPageId ?? '', weight: v.weight, enabled: v.enabled })),
  };
}

function conditionSummary(r: DraftRoute): string {
  const parts = COND_FIELDS.map((f) => (r[f.key] ? `${f.label}: ${r[f.key]}` : null)).filter(Boolean);
  return parts.length ? parts.join('; ') : 'Semua pengunjung';
}

function RouteEditor({ campaign, routes, onDone }: { campaign: Campaign; routes: CampaignRouteItem[]; onDone: () => void }) {
  const offers = useOrgQuery<Offer[]>('/offers');
  const landers = useOrgQuery<LandingPage[]>('/landing-pages');
  const action = useOrgAction();
  const [draft, setDraft] = useState<DraftRoute[]>(() => routes.map(toDraft));

  const newVariant = (n: number): DraftVariant => ({ label: String.fromCharCode(65 + (n % 26)), offerId: campaign.offerId ?? '', landingPageId: '', weight: 50, enabled: true });
  const update = (i: number, patch: Partial<DraftRoute>) => setDraft(draft.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateVariant = (i: number, k: number, patch: Partial<DraftVariant>) =>
    update(i, { variants: draft[i].variants.map((v, j) => (j === k ? { ...v, ...patch } : v)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };

  async function save() {
    const body = {
      routes: draft.map((r) => ({
        name: r.name.trim() || 'Route',
        enabled: r.enabled,
        conditions: Object.fromEntries(COND_FIELDS.map((f) => [f.key, split(r[f.key])]).filter(([, v]) => (v as string[]).length)),
        variants: r.variants.map((v) => ({ label: v.label.trim() || 'Varian', offerId: v.offerId, landingPageId: v.landingPageId || null, weight: Number(v.weight) || 0, enabled: v.enabled })),
      })),
    };
    await action.mutateAsync({ method: 'PUT', path: `/campaigns/${campaign.id}/routes`, body }).then(onDone, () => undefined);
  }

  if (!offers.data || !landers.data) return <Loading />;
  return (
    <div className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <p className="text-[13px] text-muted">
        Route diperiksa dari atas ke bawah; route pertama yang cocok dipakai. Kolom kondisi yang dikosongkan berarti semua nilai. Pengunjung yang tidak cocok dengan route mana pun diarahkan ke tujuan default
        campaign.
      </p>
      {draft.map((r, i) => {
        const totalWeight = r.variants.filter((v) => v.enabled).reduce((s, v) => s + (Number(v.weight) || 0), 0);
        return (
          <fieldset key={i} className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-sm bg-surface-2 text-xs font-medium tabular text-muted" title="Urutan pemeriksaan">
                {i + 1}
              </span>
              <Input aria-label="Nama route" className="h-8 max-w-56 font-medium" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
              <label className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /> Aktif
              </label>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Naikkan">
                  Naik
                </Button>
                <Button size="sm" variant="ghost" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label="Turunkan">
                  Turun
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                  Hapus
                </Button>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {COND_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-xs text-muted">
                  {f.label}
                  <Input className="h-8" placeholder={f.placeholder} value={r[f.key]} onChange={(e) => update(i, { [f.key]: e.target.value } as Partial<DraftRoute>)} />
                </label>
              ))}
            </div>
            <Table head={['Varian', 'Offer', 'Landing page', 'Bobot', 'Porsi', 'Aktif', '']} numericCols={[3, 4]}>
              {r.variants.map((v, k) => (
                <tr key={k}>
                  <Td>
                    <Input aria-label="Label varian" className="h-7 w-28" value={v.label} onChange={(e) => updateVariant(i, k, { label: e.target.value })} />
                  </Td>
                  <Td>
                    <Select aria-label="Offer" className="h-7 min-w-40" value={v.offerId} onChange={(e) => updateVariant(i, k, { offerId: e.target.value })}>
                      <option value="">— pilih —</option>
                      {offers.data.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Select aria-label="Landing page" className="h-7 min-w-40" value={v.landingPageId} onChange={(e) => updateVariant(i, k, { landingPageId: e.target.value })}>
                      <option value="">langsung ke offer</option>
                      {landers.data.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td numeric>
                    <Input aria-label="Bobot" type="number" min={0} max={1000} className="h-7 w-20 text-right" value={v.weight} onChange={(e) => updateVariant(i, k, { weight: Number(e.target.value) })} />
                  </Td>
                  <Td numeric className="text-muted">
                    {v.enabled && totalWeight > 0 ? pct((Number(v.weight) || 0) / totalWeight, 0) : '—'}
                  </Td>
                  <Td>
                    <input type="checkbox" aria-label="Varian aktif" checked={v.enabled} onChange={(e) => updateVariant(i, k, { enabled: e.target.checked })} />
                  </Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => update(i, { variants: r.variants.filter((_, j) => j !== k) })}>
                      Hapus
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
            <Button size="sm" variant="secondary" disabled={r.variants.length >= 10} onClick={() => update(i, { variants: [...r.variants, newVariant(r.variants.length)] })}>
              Tambah varian
            </Button>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={draft.length >= 20}
          onClick={() => setDraft([...draft, { name: `Route ${draft.length + 1}`, enabled: true, countries: '', devices: '', os: '', browsers: '', languages: '', variants: [newVariant(0)] }])}
        >
          Tambah route
        </Button>
        <Button onClick={save} disabled={action.isPending}>
          {action.isPending ? 'Menyimpan…' : 'Simpan routing'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Batal
        </Button>
      </div>
      <p className="text-xs text-muted">Perubahan berlaku untuk klik baru dalam waktu kurang dari satu menit. Varian yang sudah dilihat pengunjung tetap sama selama varian itu masih aktif.</p>
    </div>
  );
}

function SplitResults({ report }: { report: SplitTestReport }) {
  const c = report.currency;
  if (!report.routes.length) return null;
  return (
    <div className="space-y-4">
      {report.routes.map((r) => (
        <div key={r.id}>
          <p className="mb-1 text-[13px] font-medium">
            {r.name}
            {!r.enabled && <span className="ml-2 text-xs font-normal text-muted">nonaktif</span>}
          </p>
          <Table head={['Varian', 'Tujuan', 'Porsi', 'Klik', 'Konversi', 'CR', 'Interval 95%', 'EPC', 'p-value', 'Hasil']} numericCols={[2, 3, 4, 5, 6, 7, 8]}>
            {r.variants.map((v) => (
              <tr key={v.id}>
                <Td className="font-medium">{v.label}</Td>
                <Td className="text-muted">
                  {v.landingPage ? `${v.landingPage.name} → ` : ''}
                  {v.offer.name}
                </Td>
                <Td numeric>{pct(v.trafficShare, 0)}</Td>
                <Td numeric>{int(v.clicks)}</Td>
                <Td numeric>{int(v.conversions)}</Td>
                <Td numeric>{pct(v.cr)}</Td>
                <Td numeric className="text-muted">
                  {v.crInterval ? `${pct(v.crInterval.low, 1)}–${pct(v.crInterval.high, 1)}` : '—'}
                </Td>
                <Td numeric>{v.epc === null ? '—' : money(v.epc, c)}</Td>
                <Td numeric className="text-muted">
                  {v.pValue === null ? '—' : v.pValue < 0.001 ? '<0,001' : v.pValue.toFixed(3).replace('.', ',')}
                </Td>
                <Td>
                  <Badge tone={VERDICT[v.verdict].tone}>{VERDICT[v.verdict].label}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
      <Notes
        title="Cara membaca"
        items={[
          'Varian pertama di setiap route adalah kontrol; varian lain dibandingkan terhadapnya.',
          `Hasil baru disimpulkan bila setiap varian punya minimal ${report.thresholds.minClicks} klik dan ${report.thresholds.minConversions} konversi, dengan p-value di bawah ${report.thresholds.alpha}.`,
          'Klik bot tidak dihitung. Konversi = VERIFIED dari postback.',
        ]}
      />
    </div>
  );
}

export function RoutingPanel({ campaign }: { campaign: Campaign }) {
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState('30');
  const routes = useOrgQuery<CampaignRouteItem[]>(`/campaigns/${campaign.id}/routes`);
  const report = useOrgQuery<SplitTestReport>(can('analytics.read') ? `/campaigns/${campaign.id}/split-test?days=${days}` : null);
  useEffect(() => setEditing(false), [campaign.id]);

  if (routes.isLoading) return <Loading />;
  if (routes.error) return <Alert>{errorMessage(routes.error)}</Alert>;
  const list = routes.data ?? [];

  if (editing) return <RouteEditor campaign={campaign} routes={list} onDone={() => setEditing(false)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className={cn('text-[13px]', list.length ? 'text-text' : 'text-muted')}>
          {list.length ? `${list.length} route aktif mengatur tujuan klik.` : 'Belum ada routing. Semua klik menuju tujuan default campaign.'}
        </p>
        <span className="ml-auto flex gap-2">
          {list.length > 0 && (
            <Select aria-label="Rentang hasil" className="h-8 w-32" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">7 hari</option>
              <option value="30">30 hari</option>
              <option value="90">90 hari</option>
            </Select>
          )}
          {can('campaigns.manage') && (
            <Button size="sm" variant={list.length ? 'secondary' : 'primary'} onClick={() => setEditing(true)}>
              {list.length ? 'Ubah routing' : 'Atur routing'}
            </Button>
          )}
        </span>
      </div>
      {list.length > 0 && (
        <ol className="space-y-1 text-[13px]">
          {list.map((r, i) => (
            <li key={r.id} className={cn('flex flex-wrap gap-x-2', !r.enabled && 'text-muted line-through')}>
              <span className="tabular text-muted">{i + 1}.</span>
              <span className="font-medium">{r.name}</span>
              <span className="text-muted">{conditionSummary(toDraft(r))}</span>
              <span className="text-muted">({r.variants.length} varian)</span>
            </li>
          ))}
        </ol>
      )}
      {report.data && <SplitResults report={report.data} />}
    </div>
  );
}
