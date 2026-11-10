'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { CardDrawer } from '@/components/card-drawer';
import { Avatar, DueChip, KanbanBoard, MoveRequest } from '@/components/kanban';
import { Alert, Badge, Button, cn, Drawer, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { BoardDetail, CardSummary, dueState, LiveState, Person, PRIORITIES, PRIORITY, TaskPriority, useTaskStream } from '@/lib/tasks';
import type { Campaign } from '@/lib/types';

interface Filters {
  q: string;
  person: string;
  priority: string;
  campaign: string;
  overdue: boolean;
}
const EMPTY: Filters = { q: '', person: '', priority: '', campaign: '', overdue: false };

function LiveDot({ state }: { state: LiveState }) {
  const label = state === 'live' ? 'Real-time aktif' : state === 'connecting' ? 'Menyambungkan' : 'Terputus, mencoba lagi';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={label} role="status">
      <span className={cn('size-2 rounded-full', state === 'live' ? 'bg-success' : state === 'connecting' ? 'bg-warning' : 'bg-danger')} aria-hidden="true" />
      <span className="hidden sm:inline">{state === 'live' ? 'Live' : label}</span>
    </span>
  );
}

function NewCardForm({ board, people, campaigns, defaultColumn, onDone }: { board: BoardDetail; people: Person[]; campaigns: Campaign[]; defaultColumn?: string; onDone: (id: string) => void }) {
  const action = useOrgAction<{ id: string }>();
  const me = people.find((p) => p.isMe);
  const [f, setF] = useState({
    title: '',
    columnId: defaultColumn ?? board.columns.find((c) => c.kind === 'TODO')?.id ?? board.columns[0]?.id ?? '',
    priority: 'MEDIUM' as TaskPriority,
    ownerMembershipId: me?.id ?? '',
    campaignId: '',
    dueDate: '',
    description: '',
    approvalRequired: false,
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      boardId: board.id,
      title: f.title.trim(),
      columnId: f.columnId,
      priority: f.priority,
      ownerMembershipId: f.ownerMembershipId || null,
      approvalRequired: f.approvalRequired,
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
      ...(f.dueDate ? { dueDate: f.dueDate } : {}),
      ...(f.description.trim() ? { description: f.description.trim() } : {}),
    };
    await action.mutateAsync({ method: 'POST', path: '/cards', body }).then((c) => onDone(c.id), () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Judul">
        <Input required autoFocus minLength={2} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="mis. Turunkan bid zone 5552 ke 0.8" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kolom">
          <Select value={f.columnId} onChange={(e) => setF({ ...f, columnId: e.target.value })}>
            {board.columns
              .filter((c) => c.kind !== 'DONE')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Prioritas">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TaskPriority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={f.ownerMembershipId} onChange={(e) => setF({ ...f, ownerMembershipId: e.target.value })}>
            <option value="">Belum ada</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isMe ? ' (saya)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tenggat">
          <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Campaign" hint="Anggota dengan cakupan campaign tertentu hanya melihat kartu campaign miliknya.">
        <Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
          <option value="">Tidak terkait</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Deskripsi" hint="Opsional">
        <textarea rows={3} className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={f.approvalRequired} onChange={(e) => setF({ ...f, approvalRequired: e.target.checked })} className="accent-[var(--primary)]" />
        Wajib disetujui Owner/Team Leader sebelum Done
      </label>
      <Button type="submit" disabled={action.isPending}>
        Buat kartu
      </Button>
    </form>
  );
}

function BoardSettings({ board, onClose }: { board: BoardDetail; onClose: () => void }) {
  const action = useOrgAction();
  const router = useRouter();
  const [name, setName] = useState(board.name);
  const [col, setCol] = useState({ name: '', wipLimit: '' });
  const run = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => action.mutateAsync({ method, path, body }).catch(() => undefined);
  return (
    <div className="space-y-5">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run('PATCH', `/boards/${board.id}`, { name: name.trim() });
        }}
      >
        <Field label="Nama board" className="flex-1">
          <Input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" disabled={name.trim() === board.name || action.isPending}>
          Simpan
        </Button>
      </form>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold">Kolom</h3>
        <ul className="divide-y divide-border rounded-md border border-border">
          {board.columns.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
              <span className="flex-1 font-medium">{c.name}</span>
              {c.kind !== 'CUSTOM' && <Badge>bawaan</Badge>}
              <Input
                aria-label={`Batas WIP ${c.name}`}
                type="number"
                min={1}
                max={500}
                placeholder="WIP"
                defaultValue={c.wipLimit ?? ''}
                className="h-7 w-20"
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== c.wipLimit) void run('PATCH', `/columns/${c.id}`, { wipLimit: v });
                }}
              />
              <Button size="sm" variant="ghost" aria-label={`Geser ${c.name} ke kiri`} disabled={i === 0 || action.isPending} onClick={() => run('PATCH', `/columns/${c.id}`, { position: i - 1 })}>
                ←
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Geser ${c.name} ke kanan`} disabled={i === board.columns.length - 1 || action.isPending} onClick={() => run('PATCH', `/columns/${c.id}`, { position: i + 1 })}>
                →
              </Button>
              {c.kind === 'CUSTOM' && (
                <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => run('DELETE', `/columns/${c.id}`)}>
                  Hapus
                </Button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await run('POST', `/boards/${board.id}/columns`, { name: col.name.trim(), ...(col.wipLimit ? { wipLimit: Number(col.wipLimit) } : {}) });
            setCol({ name: '', wipLimit: '' });
          }}
        >
          <Input required maxLength={40} value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} placeholder="Nama kolom baru, mis. QA" />
          <Input type="number" min={1} max={500} value={col.wipLimit} onChange={(e) => setCol({ ...col, wipLimit: e.target.value })} placeholder="WIP" className="w-24" />
          <Button type="submit" variant="secondary" disabled={action.isPending}>
            Tambah
          </Button>
        </form>
        <p className="mt-1 text-xs text-muted">Kolom baru disisipkan sebelum Done. Kolom bawaan bisa diganti urutan & batas WIP, tetapi tidak dihapus.</p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {!board.isDefault && (
          <Button variant="secondary" size="sm" onClick={() => run('PATCH', `/boards/${board.id}`, { isDefault: true })}>
            Jadikan board default
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:text-danger"
          onClick={async () => {
            if (!window.confirm('Arsipkan board ini? Kartu tetap tersimpan.')) return;
            await run('PATCH', `/boards/${board.id}`, { archived: true });
            onClose();
            router.push('/boards');
          }}
        >
          Arsipkan board
        </Button>
      </div>
    </div>
  );
}

function ListView({ board, cards, onOpen }: { board: BoardDetail; cards: CardSummary[]; onOpen: (id: string) => void }) {
  const colName = new Map(board.columns.map((c) => [c.id, c]));
  const order = new Map(board.columns.map((c, i) => [c.id, i]));
  const sorted = [...cards].sort((a, b) => (order.get(a.columnId)! - order.get(b.columnId)!) || a.rank - b.rank);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <Table head={['#', 'Judul', 'Kolom', 'Prioritas', 'Owner', 'Tenggat', 'Campaign', 'Checklist']} empty={!sorted.length} emptyText="Tidak ada kartu yang cocok dengan filter.">
        {sorted.map((c) => {
          const col = colName.get(c.columnId);
          return (
            <tr key={c.id} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(c.id)}>
              <Td className="tabular text-muted">T-{c.number}</Td>
              <Td>
                <button type="button" className="text-left font-medium hover:text-primary" onClick={() => onOpen(c.id)}>
                  {c.title}
                </button>
              </Td>
              <Td className="whitespace-nowrap">{col?.name}</Td>
              <Td>
                <Badge tone={PRIORITY[c.priority].tone}>{PRIORITY[c.priority].label}</Badge>
              </Td>
              <Td className="whitespace-nowrap">
                {c.owner ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={c.owner.name} className="size-5 text-[9.5px]" />
                    {c.owner.name}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td>
                <DueChip due={c.dueDate} done={col?.kind === 'DONE'} />
              </Td>
              <Td className="max-w-48 truncate text-muted">{c.campaign?.name ?? '—'}</Td>
              <Td numeric>{c.checklistTotal ? `${c.checklistDone}/${c.checklistTotal}` : '—'}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

function BoardPageInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { can, org } = useSession();
  const qc = useQueryClient();
  const live = useTaskStream();
  const board = useOrgQuery<BoardDetail>(`/boards/${id}`);
  const people = useOrgQuery<Person[]>('/people');
  const campaigns = useOrgQuery<Campaign[]>(can('campaigns.read') ? '/campaigns' : null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [f, setF] = useState<Filters>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const openId = search.get('card');

  const setOpen = (cardId: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (cardId) sp.set('card', cardId);
    else sp.delete('card');
    router.replace(`/boards/${id}${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };

  const all = board.data?.cards ?? [];
  const meId = people.data?.find((p) => p.isMe)?.id;
  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return all.filter((c) => {
      if (q && !`t-${c.number} ${c.title} ${c.campaign?.name ?? ''}`.toLowerCase().includes(q)) return false;
      if (f.priority && c.priority !== f.priority) return false;
      if (f.campaign && c.campaign?.id !== f.campaign) return false;
      if (f.person) {
        const pid = f.person === 'me' ? meId : f.person;
        if (c.owner?.id !== pid && !c.assignees.some((a) => a.id === pid)) return false;
      }
      if (f.overdue && dueState(c.dueDate, !!c.completedAt, org.timezone) !== 'overdue') return false;
      return true;
    });
  }, [all, f, meId, org.timezone]);
  const campaignsOnBoard = useMemo(() => [...new Map(all.filter((c) => c.campaign).map((c) => [c.campaign!.id, c.campaign!])).values()], [all]);
  const filtering = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const canWrite = can('tasks.write');

  async function onMove(m: MoveRequest): Promise<boolean> {
    setMoveErr(null);
    try {
      await api(`/cards/${m.card.id}/move`, { method: 'POST', body: { columnId: m.columnId, index: m.index, version: m.card.version } });
      await qc.invalidateQueries({ queryKey: [org.id, `/boards/${id}`] });
      return true;
    } catch (e) {
      await qc.invalidateQueries({ queryKey: [org.id, `/boards/${id}`] });
      if (e instanceof ApiError && ['EVIDENCE_REQUIRED', 'DEPENDENCY_OPEN'].includes(e.code)) {
        setMoveErr(`T-${m.card.number}: ${e.message}. Lengkapi di detail kartu.`);
        setOpen(m.card.id);
      } else setMoveErr(`T-${m.card.number}: ${errorMessage(e)}`);
      return false;
    }
  }

  async function onQuickAdd(columnId: string, title: string) {
    setMoveErr(null);
    try {
      await api('/cards', { method: 'POST', body: { boardId: id, columnId, title } });
      await qc.invalidateQueries({ queryKey: [org.id, `/boards/${id}`] });
    } catch (e) {
      setMoveErr(errorMessage(e));
    }
  }

  if (board.isLoading) return <Loading rows={6} />;
  if (board.error || !board.data) return <Alert>{errorMessage(board.error ?? new Error('Board tidak ditemukan'))}</Alert>;
  const b = board.data;

  return (
    <>
      <PageHeader
        title={b.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/boards" className="text-primary hover:underline">
              Semua board
            </Link>
            {b.team && <span>Tim {b.team.name}</span>}
            {b.isDefault && <Badge tone="blue">default</Badge>}
            <LiveDot state={live} />
          </span>
        }
        actions={
          <>
            <div className="inline-flex rounded-md border border-border-strong p-0.5" role="group" aria-label="Tampilan">
              {(['board', 'list'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('h-7 rounded px-2.5 text-[12.5px] font-medium', view === v ? 'bg-primary-soft text-primary' : 'text-muted hover:text-text')}>
                  {v === 'board' ? 'Board' : 'Daftar'}
                </button>
              ))}
            </div>
            {can('boards.manage') && (
              <Button variant="secondary" onClick={() => setSettings(true)}>
                Atur board
              </Button>
            )}
            {canWrite && <Button onClick={() => setAdding(true)}>+ Kartu</Button>}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Cari kartu" className="w-full sm:w-56" placeholder="Cari judul, T-nomor, campaign" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select aria-label="Orang" className="w-[calc(50%-4px)] sm:w-44" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}>
          <option value="">Semua orang</option>
          <option value="me">Tugas saya</option>
          {people.data
            ?.filter((p) => !p.isMe)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        <Select aria-label="Prioritas" className="w-[calc(50%-4px)] sm:w-40" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="">Semua prioritas</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY[p].label}
            </option>
          ))}
        </Select>
        {campaignsOnBoard.length > 0 && (
          <Select aria-label="Campaign" className="w-full sm:w-48" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })}>
            <option value="">Semua campaign</option>
            {campaignsOnBoard.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <label className="inline-flex h-8 items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} className="accent-[var(--primary)]" />
          Lewat tenggat
        </label>
        {filtering && (
          <>
            <span className="text-xs text-muted tabular">
              {filtered.length} dari {all.length} kartu
            </span>
            <Button size="sm" variant="ghost" onClick={() => setF(EMPTY)}>
              Reset
            </Button>
          </>
        )}
      </div>

      {moveErr && (
        <div className="mb-3">
          <Alert tone="yellow">{moveErr}</Alert>
        </div>
      )}

      {view === 'board' ? (
        <KanbanBoard columns={b.columns} cards={filtered} allCards={all} canWrite={canWrite} onOpen={setOpen} onMove={onMove} onQuickAdd={onQuickAdd} />
      ) : (
        <ListView board={b} cards={filtered} onOpen={setOpen} />
      )}

      <CardDrawer cardId={openId} columns={b.columns} boardCards={all} onClose={() => setOpen(null)} />
      <Drawer open={adding} title="Kartu baru" onClose={() => setAdding(false)}>
        {adding && (
          <NewCardForm
            board={b}
            people={people.data ?? []}
            campaigns={campaigns.data ?? []}
            onDone={(cardId) => {
              setAdding(false);
              setOpen(cardId);
            }}
          />
        )}
      </Drawer>
      <Drawer open={settings} title="Atur board" onClose={() => setSettings(false)}>
        {settings && <BoardSettings board={b} onClose={() => setSettings(false)} />}
      </Drawer>
    </>
  );
}

export default function BoardPage() {
  return (
    <RequirePermission permission="tasks.read">
      <Suspense fallback={<Loading rows={6} />}>
        <BoardPageInner />
      </Suspense>
    </RequirePermission>
  );
}
