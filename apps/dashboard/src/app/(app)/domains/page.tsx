'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { compact, useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { DomainsResponse, TrackingDomainItem, Website } from '@/lib/types';

const STATUS: Record<TrackingDomainItem['status'], { label: string; tone: 'green' | 'yellow' | 'red' }> = {
  ACTIVE: { label: 'aktif', tone: 'green' },
  PENDING: { label: 'menunggu DNS', tone: 'yellow' },
  FAILED: { label: 'DNS berubah', tone: 'red' },
};

function DnsInstructions({ hostname, target }: { hostname: string; target: string }) {
  return (
    <div className="space-y-2 text-[13px]">
      <p>Buat record DNS berikut di penyedia domain Anda (Cloudflare, Niagahoster, dll.):</p>
      <Table head={['Tipe', 'Nama / host', 'Nilai / target']}>
        <tr>
          <Td className="font-medium">CNAME</Td>
          <Td className="font-mono text-xs break-all">{hostname}</Td>
          <Td className="font-mono text-xs break-all">{target}</Td>
        </tr>
      </Table>
      <p className="text-xs text-muted">
        Untuk domain utama tanpa subdomain (mis. brand.com) yang tidak bisa memakai CNAME, buat A record yang mengarah ke IP yang sama dengan {target}. Bila memakai Cloudflare, matikan proxy (awan abu-abu)
        agar sertifikat HTTPS bisa diterbitkan. Perubahan DNS bisa memerlukan beberapa menit sampai beberapa jam.
      </p>
    </div>
  );
}

function AddDomain({ target, onDone }: { target: string; onDone: () => void }) {
  const websites = useOrgQuery<Website[]>('/websites');
  const action = useOrgAction<TrackingDomainItem>();
  const [hostname, setHostname] = useState('');
  const [websiteId, setWebsiteId] = useState('');
  const [created, setCreated] = useState<TrackingDomainItem | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await action.mutateAsync({ method: 'POST', path: '/domains', body: compact({ hostname: hostname.trim().toLowerCase(), websiteId }) }).catch(() => null);
    if (r) setCreated(r);
  }

  if (created) {
    return (
      <div className="space-y-4">
        {created.status === 'ACTIVE' ? (
          <Alert tone="green">DNS {created.hostname} sudah benar. Domain aktif dan bisa dipilih di campaign.</Alert>
        ) : (
          <Alert tone="yellow">Domain ditambahkan. {created.lastError}</Alert>
        )}
        {created.status !== 'ACTIVE' && <DnsInstructions hostname={created.hostname} target={target} />}
        <Button onClick={onDone}>Selesai</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Domain" hint="Disarankan subdomain khusus tracking, mis. go.brandanda.com">
        <Input required value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="go.brandanda.com" />
      </Field>
      <Field label="Website pemilik (opsional)" hint="Bila dipilih, kode JS SDK website itu memakai domain ini (first-party, lebih jarang diblokir).">
        <Select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)}>
          <option value="">— tidak ada —</option>
          {websites.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.domain})
            </option>
          ))}
        </Select>
      </Field>
      {hostname && <DnsInstructions hostname={hostname.trim().toLowerCase()} target={target} />}
      <Button type="submit" disabled={action.isPending}>
        {action.isPending ? 'Memeriksa DNS…' : 'Tambah & periksa DNS'}
      </Button>
    </form>
  );
}

export default function DomainsPage() {
  const { can, org } = useSession();
  const q = useOrgQuery<DomainsResponse>('/domains');
  const action = useOrgAction<{ status: string; detail: string }>();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'green' | 'yellow'; text: string } | null>(null);
  const [showDns, setShowDns] = useState<string | null>(null);
  const manage = can('websites.manage');
  const p = q.data?.platform;

  return (
    <RequirePermission permission="websites.read">
      <PageHeader
        title="Domain"
        description="Domain platform dipisah per fungsi. Domain tracking kustom membuat tracking link dan JS SDK memakai domain milik Anda."
        actions={manage && p && <Button onClick={() => setAdding(true)}>Tambah domain</Button>}
      />
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {!q.data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <Card title="Domain platform">
            <Table head={['Fungsi', 'Domain', 'Dipakai untuk', 'Dibagikan ke']}>
              <tr>
                <Td className="font-medium">Admin</Td>
                <Td className="font-mono text-xs">{p!.adminHost}</Td>
                <Td>Login dan dashboard tim</Td>
                <Td className="text-muted">Tim internal saja</Td>
              </tr>
              <tr>
                <Td className="font-medium">Tracking</Td>
                <Td className="font-mono text-xs">{p!.trackerHost}</Td>
                <Td>Tracking link, click-out, JS SDK</Td>
                <Td className="text-muted">Jaringan iklan, landing page</Td>
              </tr>
              <tr>
                <Td className="font-medium">Postback</Td>
                <Td className="font-mono text-xs">{p!.postbackHost}</Td>
                <Td>Postback masuk dari affiliate network</Td>
                <Td className="text-muted">Affiliate network</Td>
              </tr>
            </Table>
            <p className="mt-3 text-xs text-muted">Diatur saat instalasi lewat ADMIN_DOMAIN, TRACKER_DOMAIN, dan POSTBACK_DOMAIN. Setiap domain hanya membuka endpoint sesuai fungsinya.</p>
          </Card>

          <Card title="Domain tracking kustom">
            {action.error && <Alert>{errorMessage(action.error)}</Alert>}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Table head={['Domain', 'Website', 'Status', 'Campaign', 'Diperiksa', '']} numericCols={[3]} empty={!q.data.domains.length} emptyText="Belum ada domain kustom. Tracking link memakai domain tracking platform.">
              {q.data.domains.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <div className="font-mono text-xs">{d.hostname}</div>
                    {d.status !== 'ACTIVE' && d.lastError && <div className="mt-0.5 max-w-md text-xs text-muted">{d.lastError}</div>}
                    {showDns === d.id && (
                      <div className="mt-2">
                        <DnsInstructions hostname={d.hostname} target={d.dns.value} />
                      </div>
                    )}
                  </Td>
                  <Td>{d.website?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                  </Td>
                  <Td numeric>{d.campaignCount}</Td>
                  <Td className="whitespace-nowrap text-muted">{dateTime(d.lastCheckAt, org.timezone)}</Td>
                  <Td>
                    {manage && (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate(
                              { method: 'POST', path: `/domains/${d.id}/verify` },
                              { onSuccess: (r) => setMsg(r.status === 'ACTIVE' ? { tone: 'green', text: `${d.hostname} aktif.` } : { tone: 'yellow', text: `${d.hostname}: ${r.detail}` }) },
                            )
                          }
                        >
                          Verifikasi
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowDns(showDns === d.id ? null : d.id)}>
                          DNS
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action.isPending}
                          onClick={() => {
                            if (confirm(`Hapus ${d.hostname}?`)) action.mutate({ method: 'DELETE', path: `/domains/${d.id}` });
                          }}
                        >
                          Hapus
                        </Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-muted">
              Status diperiksa ulang otomatis setiap 6 jam. Bila DNS berubah, tracking link campaign kembali memakai domain tracking platform dan alert dikirim.
            </p>
          </Card>
        </div>
      )}
      <Drawer open={adding} title="Tambah domain tracking" onClose={() => setAdding(false)}>
        {p && <AddDomain target={p.trackerHost} onDone={() => setAdding(false)} />}
      </Drawer>
    </RequirePermission>
  );
}
