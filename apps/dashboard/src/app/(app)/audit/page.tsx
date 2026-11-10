'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Card, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { AuditLog } from '@/lib/types';

const ENTITY_TYPES = ['', 'campaign', 'network_account', 'affiliate_network', 'offer', 'membership', 'organization', 'postback_delivery', 'spend_entry', 'user'];

export default function AuditPage() {
  const { org } = useSession();
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const logs = useOrgQuery<AuditLog[]>(`/audit-logs?limit=200${entityType ? `&entityType=${entityType}` : ''}`);
  return (
    <RequirePermission permission="audit.read">
      <PageHeader
        title="Audit Log"
        description="Riwayat aksi administratif. Field rahasia disensor otomatis."
        actions={
          <Select aria-label="Jenis entitas" className="h-8 w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t || 'Semua entitas'}
              </option>
            ))}
          </Select>
        }
      />
      <Card>
        {logs.error && <Alert>{errorMessage(logs.error)}</Alert>}
        {logs.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Waktu', 'Aksi', 'Entitas', 'Pelaku', 'Detail']} empty={!logs.data?.length}>
            {logs.data?.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{dateTime(l.createdAt, org.timezone)}</Td>
                <Td className="font-medium">{l.action}</Td>
                <Td className="text-xs text-muted">
                  {l.entityType}
                  {l.entityId ? ` ${l.entityId.slice(0, 8)}` : ''}
                </Td>
                <Td className="text-xs text-muted">{l.actorUserId?.slice(0, 8) ?? 'sistem'}</Td>
                <Td>
                  {(l.before !== null || l.after !== null) && (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOpen(open === l.id ? null : l.id)}>
                      {open === l.id ? 'Sembunyikan' : 'Lihat'}
                    </button>
                  )}
                  {open === l.id && (
                    <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify({ before: l.before, after: l.after }, null, 2)}</pre>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </RequirePermission>
  );
}
