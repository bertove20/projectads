'use client';

import Link from 'next/link';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Card, Loading, PageHeader, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';

interface SpendRow {
  id: string;
  date: string;
  amount: string;
  currency: string;
  source: string;
  note: string | null;
  campaign: { id: string; name: string };
}

export default function SpendPage() {
  const rows = useOrgQuery<SpendRow[]>('/spend');
  return (
    <RequirePermission permission="analytics.read">
      <PageHeader
        title="Spend"
        description={
          <>
            Spend yang dilaporkan per campaign per hari. Input manual dilakukan di halaman detail campaign. Sinkronisasi otomatis dari API RollerAds menyusul di Phase 2.
          </>
        }
      />
      <Card>
        {rows.error && <Alert>{errorMessage(rows.error)}</Alert>}
        {rows.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Tanggal', 'Campaign', 'Jumlah', 'Sumber', 'Catatan']} empty={!rows.data?.length}>
            {rows.data?.map((r) => (
              <tr key={r.id}>
                <Td>{r.date.slice(0, 10)}</Td>
                <Td>
                  <Link className="text-primary hover:underline" href={`/campaigns/${r.campaign.id}`}>
                    {r.campaign.name}
                  </Link>
                </Td>
                <Td numeric>{money(r.amount, r.currency)}</Td>
                <Td>
                  <Badge tone={r.source === 'API' ? 'green' : 'gray'}>{r.source}</Badge>
                </Td>
                <Td className="text-muted">{r.note ?? ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </RequirePermission>
  );
}
