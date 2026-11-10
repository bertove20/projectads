'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { compact, useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { LandingPage, Website, WebsiteWithSdk } from '@/lib/types';
import { SdkSetup } from '@/components/sdk-setup';

function WebsiteForm({ onDone }: { onDone: () => void }) {
  const action = useOrgAction();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action.mutateAsync({ method: 'POST', path: '/websites', body: { name, domain: domain.trim().toLowerCase() } }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama">
        <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Domain" hint="tanpa https://, mis. promo.example.com">
        <Input required value={domain} onChange={(e) => setDomain(e.target.value)} />
      </Field>
      <Button type="submit" disabled={action.isPending}>
        Simpan
      </Button>
    </form>
  );
}

function LandingForm({ websites, onDone }: { websites: Website[]; onDone: () => void }) {
  const action = useOrgAction();
  const [f, setF] = useState({ name: '', url: '', websiteId: '' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action.mutateAsync({ method: 'POST', path: '/landing-pages', body: compact(f) }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama">
        <Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="URL landing page" hint="Tracker menambahkan ?cid=<click id>. Tombol CTA diarahkan ke URL click-out pada halaman campaign.">
        <Input required type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </Field>
      <Field label="Website">
        <Select value={f.websiteId} onChange={(e) => setF({ ...f, websiteId: e.target.value })}>
          <option value="">— tidak ada —</option>
          {websites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.domain})
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

export default function WebsitesPage() {
  const { can } = useSession();
  const websites = useOrgQuery<WebsiteWithSdk[]>('/websites');
  const [sdkFor, setSdkFor] = useState<string | null>(null);
  const sdkSite = websites.data?.find((w) => w.id === sdkFor) ?? null;
  const landers = useOrgQuery<LandingPage[]>('/landing-pages');
  const [open, setOpen] = useState<'website' | 'landing' | null>(null);
  const manage = can('websites.manage');
  return (
    <RequirePermission permission="websites.read">
      <PageHeader title="Websites & Landing Pages" />
      <div className="space-y-5">
        <Card title="Landing pages" actions={manage && <Button size="sm" onClick={() => setOpen('landing')}>+ Landing page</Button>}>
          {landers.error && <Alert>{errorMessage(landers.error)}</Alert>}
          {landers.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Nama', 'URL', 'Website', 'Status']} empty={!landers.data?.length}>
              {landers.data?.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td className="max-w-md truncate text-muted">{l.url}</Td>
                  <Td>{l.website?.name ?? '—'}</Td>
                  <Td>
                    <StatusBadge status={l.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Websites" actions={manage && <Button size="sm" variant="secondary" onClick={() => setOpen('website')}>+ Website</Button>}>
          {websites.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Nama', 'Domain', 'JS SDK', 'Status', '']} empty={!websites.data?.length} emptyText="Belum ada website. Tambahkan domain landing page Anda untuk memasang JS SDK.">
              {websites.data?.map((w) => (
                <tr key={w.id}>
                  <Td className="font-medium">{w.name}</Td>
                  <Td>{w.domain}</Td>
                  <Td>{w.sdkKey ? <Badge tone="green">siap dipasang</Badge> : <Badge>belum</Badge>}</Td>
                  <Td>
                    <StatusBadge status={w.status} />
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setSdkFor(w.id)}>
                      Pasang SDK
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Drawer open={!!sdkSite} title={sdkSite ? `JS SDK — ${sdkSite.name}` : ''} onClose={() => setSdkFor(null)}>
        {sdkSite && <SdkSetup key={sdkSite.id} site={sdkSite} />}
      </Drawer>
      <Drawer open={open === 'website'} title="Website baru" onClose={() => setOpen(null)}>
        <WebsiteForm onDone={() => setOpen(null)} />
      </Drawer>
      <Drawer open={open === 'landing'} title="Landing page baru" onClose={() => setOpen(null)}>
        <LandingForm websites={websites.data ?? []} onDone={() => setOpen(null)} />
      </Drawer>
    </RequirePermission>
  );
}
