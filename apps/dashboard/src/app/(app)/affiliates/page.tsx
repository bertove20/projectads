'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Button, Card, CopyText, Drawer, Field, Input, Loading, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { AffiliateNetwork } from '@/lib/types';

interface TokenResult {
  postbackToken: string;
  postbackUrl: string;
}

function TokenReveal({ result }: { result: TokenResult }) {
  return (
    <div className="space-y-3">
      <Alert tone="yellow">URL ini hanya ditampilkan SEKALI. Simpan sekarang dan pasang di pengaturan postback affiliate network.</Alert>
      <CopyText value={result.postbackUrl} />
      <p className="text-sm text-muted">
        Ganti <code>{'{click_id}'}</code>, <code>{'{payout}'}</code>, <code>{'{status}'}</code>, dan <code>{'{txid}'}</code> dengan macro dari affiliate network. Nilai{' '}
        <code>click_id</code> adalah sub-ID yang Anda kirim lewat URL offer.
      </p>
    </div>
  );
}

function CreateAffiliate({ onCreated }: { onCreated: (r: TokenResult) => void }) {
  const action = useOrgAction<TokenResult>();
  const [name, setName] = useState('');
  const [ips, setIps] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const allowedIps = ips.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    await action.mutateAsync({ method: 'POST', path: '/affiliate-networks', body: { name, allowedIps } }).then(onCreated, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama affiliate network">
        <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="IP pengirim yang diizinkan" hint="opsional; pisahkan dengan koma. Kosong = tidak dibatasi IP (tetap dilindungi token).">
        <Input value={ips} onChange={(e) => setIps(e.target.value)} />
      </Field>
      <Button type="submit" disabled={action.isPending}>
        Buat & tampilkan URL postback
      </Button>
    </form>
  );
}

export default function AffiliatesPage() {
  const { can } = useSession();
  const list = useOrgQuery<AffiliateNetwork[]>('/affiliate-networks');
  const rotate = useOrgAction<TokenResult>();
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<TokenResult | null>(null);

  return (
    <RequirePermission permission="affiliates.read">
      <PageHeader
        title="Affiliate Networks"
        description="Sumber offer. Mengirim postback masuk yang menjadi konversi VERIFIED."
        actions={can('affiliates.manage') && <Button onClick={() => { setRevealed(null); setCreating(true); }}>+ Affiliate</Button>}
      />
      {rotate.error && <Alert>{errorMessage(rotate.error)}</Alert>}
      <Card>
        {list.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Nama', 'IP allowlist', 'Dibuat', 'Status', '']} empty={!list.data?.length}>
            {list.data?.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td>{a.allowedIps.length ? a.allowedIps.join(', ') : <span className="text-muted">tidak dibatasi</span>}</Td>
                <Td>{dateTime(a.createdAt)}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>
                  {can('affiliates.manage') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (!confirm('Buat token baru? URL postback lama langsung berhenti berfungsi.')) return;
                        rotate.mutateAsync({ method: 'POST', path: `/affiliate-networks/${a.id}/rotate-token` }).then((r) => {
                          setRevealed(r);
                          setCreating(true);
                        }, () => undefined);
                      }}
                    >
                      Rotasi token
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Drawer open={creating} title={revealed ? 'URL postback masuk' : 'Affiliate network baru'} onClose={() => { setCreating(false); setRevealed(null); }}>
        {revealed ? <TokenReveal result={revealed} /> : <CreateAffiliate onCreated={setRevealed} />}
      </Drawer>
    </RequirePermission>
  );
}
