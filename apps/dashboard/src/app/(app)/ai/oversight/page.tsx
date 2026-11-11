'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Drawer, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { AiDraft, AiMessage, RichText, TOOL_LABEL } from '@/lib/ai';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { POSITION_LABEL, Position } from '@/lib/tasks';

interface Row {
  id: string;
  title: string;
  position: Position;
  updatedAt: string;
  member: { id: string; name: string };
  messages: number;
  drafts: number;
}
interface Detail {
  id: string;
  title: string;
  position: Position;
  member: { id: string; name: string };
  messages: AiMessage[];
  drafts: AiDraft[];
}

const DRAFT_STATUS: Record<string, { label: string; tone: 'blue' | 'green' | 'gray' }> = {
  PENDING: { label: 'Menunggu', tone: 'blue' },
  ACCEPTED: { label: 'Jadi kartu', tone: 'green' },
  DISMISSED: { label: 'Diabaikan', tone: 'gray' },
};

function ConversationView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useOrgQuery<Detail>(id ? `/ai/oversight/conversations/${id}` : null);
  const c = q.data;
  return (
    <Drawer open={!!id} title={c ? `${c.member.name} — ${c.title}` : 'Percakapan'} onClose={onClose} wide>
      {q.isLoading && <Loading rows={3} />}
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {c && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            {POSITION_LABEL[c.position]} · Hanya baca. Pembukaan percakapan ini tercatat di audit log, dan karyawan diberi tahu bahwa percakapan AI dapat diaudit.
          </p>
          <ol className="space-y-3">
            {c.messages.map((m) =>
              m.role === 'USER' ? (
                <li key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-2 px-3 py-2 text-[13.5px] whitespace-pre-wrap">
                    <p className="mb-0.5 text-xs font-medium text-muted">{c.member.name}</p>
                    {m.content}
                  </div>
                </li>
              ) : m.role === 'TOOL' ? (
                <li key={m.id}>
                  <details className="rounded-md border border-border bg-surface-2/60 text-xs">
                    <summary className="cursor-pointer px-2.5 py-1.5">Data: {TOOL_LABEL[m.toolName ?? ''] ?? m.toolName}</summary>
                    <pre className="max-h-64 overflow-auto border-t border-border px-2.5 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted">{m.content.slice(0, 6000)}</pre>
                  </details>
                </li>
              ) : m.content ? (
                <li key={m.id} className="space-y-2 text-[13.5px]">
                  <p className="text-xs text-muted">AI · {dateTime(m.createdAt)}</p>
                  <RichText text={m.content} />
                </li>
              ) : null,
            )}
          </ol>
          {c.drafts.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Draft tugas dari percakapan ini</p>
              <ul className="space-y-1">
                {c.drafts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-[13px]">
                    <Badge tone={DRAFT_STATUS[d.status]?.tone ?? 'gray'}>{DRAFT_STATUS[d.status]?.label ?? d.status}</Badge>
                    {d.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function OversightPage() {
  const [member, setMember] = useState('');
  const [position, setPosition] = useState('');
  const all = useOrgQuery<Row[]>('/ai/oversight/conversations');
  const params = new URLSearchParams();
  if (member) params.set('membershipId', member);
  if (position) params.set('position', position);
  const q = useOrgQuery<Row[]>(member || position ? `/ai/oversight/conversations?${params}` : '/ai/oversight/conversations');
  const [open, setOpen] = useState<string | null>(null);
  const members = useMemo(() => [...new Map((all.data ?? []).map((r) => [r.member.id, r.member.name])).entries()], [all.data]);
  return (
    <>
      <PageHeader
        title="Pengawasan percakapan AI"
        description="Percakapan karyawan dengan AI Assistant, terbuka untuk owner demi transparansi. Karyawan melihat pemberitahuan bahwa percakapannya dapat diaudit."
        actions={
          <>
            <Select value={member} onChange={(e) => setMember(e.target.value)} className="w-48" aria-label="Karyawan">
              <option value="">Semua karyawan</option>
              {members.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <Select value={position} onChange={(e) => setPosition(e.target.value)} className="w-48" aria-label="Jabatan">
              <option value="">Semua jabatan</option>
              {Object.entries(POSITION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </>
        }
      />
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table head={['Percakapan', 'Karyawan', 'Jabatan', 'Pesan', 'Draft', 'Terakhir']} empty={!q.data?.length} emptyText="Belum ada percakapan AI." numericCols={[3, 4]}>
            {q.data?.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setOpen(r.id)}>
                <Td>
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(r.id)}>
                    {r.title}
                  </button>
                </Td>
                <Td>{r.member.name}</Td>
                <Td>{POSITION_LABEL[r.position]}</Td>
                <Td numeric>{r.messages}</Td>
                <Td numeric>{r.drafts}</Td>
                <Td>{dateTime(r.updatedAt)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <ConversationView id={open} onClose={() => setOpen(null)} />
    </>
  );
}

export default function Page() {
  return (
    <RequirePermission permission="ai.supervise">
      <OversightPage />
    </RequirePermission>
  );
}
