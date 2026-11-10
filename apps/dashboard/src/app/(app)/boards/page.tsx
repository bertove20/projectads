'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { BoardSummary, TeamItem } from '@/lib/tasks';

function BoardForm({ onDone }: { onDone: (id: string) => void }) {
  const action = useOrgAction<{ id: string }>();
  const teams = useOrgQuery<TeamItem[]>('/teams');
  const [f, setF] = useState({ name: '', description: '', teamId: '' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { name: f.name.trim(), ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.teamId ? { teamId: f.teamId } : {}) };
    await action.mutateAsync({ method: 'POST', path: '/boards', body }).then((b) => onDone(b.id), () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama board">
        <Input required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Optimasi Push Indonesia" />
      </Field>
      <Field label="Deskripsi" hint="Opsional">
        <Input maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Field label="Tim" hint="Kartu baru di board ini otomatis milik tim tersebut.">
        <Select value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
          <option value="">Tanpa tim</option>
          {teams.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted">Kolom default: Backlog, To Do, In Progress, Review, Waiting Approval, Blocked, Done. Kolom tambahan bisa dibuat setelahnya.</p>
      <Button type="submit" disabled={action.isPending}>
        Buat board
      </Button>
    </form>
  );
}

export default function BoardsPage() {
  const { can } = useSession();
  const [archived, setArchived] = useState(false);
  const boards = useOrgQuery<BoardSummary[]>(`/boards${archived ? '?archived=1' : ''}`);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  return (
    <RequirePermission permission="tasks.read">
      <PageHeader
        title="Board"
        description="Papan Kanban tim. Incident card dari alert serius masuk ke board default."
        actions={
          <>
            <Select aria-label="Status board" className="w-36" value={archived ? '1' : ''} onChange={(e) => setArchived(e.target.value === '1')}>
              <option value="">Aktif</option>
              <option value="1">Diarsipkan</option>
            </Select>
            {can('boards.manage') && <Button onClick={() => setAdding(true)}>+ Board</Button>}
          </>
        }
      />
      {created && (
        <div className="mb-4">
          <Alert tone="green">
            Board dibuat.{' '}
            <Link className="font-medium text-primary underline" href={`/boards/${created}`}>
              Buka board
            </Link>
          </Alert>
        </div>
      )}
      {boards.isLoading ? (
        <Loading />
      ) : !boards.data?.length ? (
        <Card>
          <p className="py-8 text-center text-[13px] text-muted">{archived ? 'Tidak ada board yang diarsipkan.' : 'Belum ada board. Buat board pertama untuk mulai membagi tugas tim.'}</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {boards.data.map((b) => {
            const total = b.openCards + b.doneCards;
            return (
              <Link key={b.id} href={`/boards/${b.id}`} className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[15px] font-semibold group-hover:text-primary">{b.name}</h2>
                  {b.isDefault && <Badge tone="blue">default</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{b.description || (b.team ? `Board tim ${b.team.name}` : 'Board organisasi')}</p>
                <div className="mt-3 flex items-baseline gap-4 text-[13px]">
                  <span>
                    <span className="tabular text-lg font-semibold">{b.openCards}</span> <span className="text-muted">aktif</span>
                  </span>
                  <span>
                    <span className="tabular text-lg font-semibold text-muted">{b.doneCards}</span> <span className="text-muted">selesai</span>
                  </span>
                  {b.team && <span className="ml-auto truncate text-xs text-muted">{b.team.name}</span>}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                  <div className="h-full bg-success" style={{ width: `${total ? (b.doneCards / total) * 100 : 0}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <Drawer open={adding} title="Board baru" onClose={() => setAdding(false)}>
        <BoardForm
          onDone={(id) => {
            setAdding(false);
            setCreated(id);
          }}
        />
      </Drawer>
    </RequirePermission>
  );
}
