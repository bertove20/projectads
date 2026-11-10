'use client';

import {
  closestCorners,
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { BoardColumn, CardSummary, dueState, initials, PRIORITY, shortDate } from '@/lib/tasks';
import { Badge, Button, cn, Input } from './ui';

// ───────────── ikon kecil (inline, mengikuti currentColor) ─────────────

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn('size-3.5 shrink-0', className)} aria-hidden="true">
      {children}
    </svg>
  );
}
export const Icons = {
  check: (p: { className?: string }) => (
    <Svg {...p}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="m5.5 8 1.8 1.8L10.5 6.5" />
    </Svg>
  ),
  comment: (p: { className?: string }) => (
    <Svg {...p}>
      <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />
    </Svg>
  ),
  link: (p: { className?: string }) => (
    <Svg {...p}>
      <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7" />
    </Svg>
  ),
  lock: (p: { className?: string }) => (
    <Svg {...p}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Svg>
  ),
  calendar: (p: { className?: string }) => (
    <Svg {...p}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </Svg>
  ),
  bolt: (p: { className?: string }) => (
    <Svg {...p}>
      <path d="M9 1.5 3.5 9h4L7 14.5 12.5 7h-4z" />
    </Svg>
  ),
  shield: (p: { className?: string }) => (
    <Svg {...p}>
      <path d="M8 1.75 13 3.5v4c0 3-2.2 5.3-5 6.75C5.2 12.8 3 10.5 3 7.5v-4z" />
      <path d="m5.75 8 1.6 1.6 2.9-3" />
    </Svg>
  ),
  plus: (p: { className?: string }) => (
    <Svg {...p}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  ),
};

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span title={name} className={cn('inline-flex size-6 items-center justify-center rounded-full border border-surface bg-surface-2 text-[10.5px] font-semibold text-muted ring-1 ring-border', className)}>
      {initials(name)}
    </span>
  );
}

export function DueChip({ due, done }: { due: string | null; done: boolean }) {
  const { org } = useSession();
  if (!due) return null;
  const s = dueState(due, done, org.timezone);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1 text-xs tabular',
        s === 'overdue' && 'bg-danger/12 font-medium text-danger',
        s === 'today' && 'bg-warning/14 font-medium text-warning',
        (s === 'soon' || s === 'later' || s === null) && 'text-muted',
      )}
      title={s === 'overdue' ? 'Lewat tenggat' : s === 'today' ? 'Tenggat hari ini' : 'Tenggat'}
    >
      <Icons.calendar className="size-3" />
      {shortDate(due)}
    </span>
  );
}

// ───────────── kartu ─────────────

export function CardTile({ card, isDone, onOpen, dragging, overlay }: { card: CardSummary; isDone: boolean; onOpen?: () => void; dragging?: boolean; overlay?: boolean }) {
  const p = PRIORITY[card.priority];
  const people = [...(card.owner ? [card.owner] : []), ...card.assignees.filter((a) => a.id !== card.owner?.id)];
  return (
    <div
      className={cn(
        'group relative rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-[border-color,box-shadow]',
        'hover:border-border-strong',
        card.priority === 'URGENT' && 'border-l-[3px] border-l-danger',
        card.priority === 'HIGH' && 'border-l-[3px] border-l-warning',
        dragging && 'opacity-40',
        overlay && 'rotate-[1.5deg] border-primary shadow-lg',
      )}
    >
      <button type="button" onClick={onOpen} className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Buka T-${card.number}: ${card.title}`} />
      <div className="pointer-events-none relative z-[1]">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <span className="tabular font-medium">T-{card.number}</span>
          {card.source === 'ALERT' && (
            <span className="inline-flex items-center gap-0.5 font-medium text-danger" title="Dibuat otomatis dari alert">
              <Icons.bolt className="size-3" />
              insiden
            </span>
          )}
          {(card.priority === 'URGENT' || card.priority === 'HIGH') && (
            <Badge tone={p.tone} className="ml-auto">
              {p.label}
            </Badge>
          )}
        </div>
        <p className={cn('text-[13px] leading-snug font-medium text-text', isDone && 'text-muted line-through decoration-border-strong')}>{card.title}</p>
        {card.campaign && <p className="mt-1 truncate text-xs text-muted">{card.campaign.name}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          <DueChip due={card.dueDate} done={isDone} />
          {card.checklistTotal > 0 && (
            <span className={cn('inline-flex items-center gap-1 tabular', card.checklistDone === card.checklistTotal && 'text-success')}>
              <Icons.check className="size-3" />
              {card.checklistDone}/{card.checklistTotal}
            </span>
          )}
          {card.comments > 0 && (
            <span className="inline-flex items-center gap-1 tabular">
              <Icons.comment className="size-3" />
              {card.comments}
            </span>
          )}
          {card.links > 0 && (
            <span className="inline-flex items-center gap-1 tabular">
              <Icons.link className="size-3" />
              {card.links}
            </span>
          )}
          {card.blockedBy > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-warning" title={`Menunggu ${card.blockedBy} kartu lain`}>
              <Icons.lock className="size-3" />
              {card.blockedBy}
            </span>
          )}
          {card.approvalRequired && !isDone && (
            <span className="inline-flex items-center gap-1 text-primary" title="Perlu approval Owner/Team Leader">
              <Icons.shield className="size-3" />
              approval
            </span>
          )}
          {people.length > 0 && (
            <span className="ml-auto flex -space-x-1.5">
              {people.slice(0, 3).map((m) => (
                <Avatar key={m.id} name={m.name} />
              ))}
              {people.length > 3 && <span className="pl-2 text-xs">+{people.length - 3}</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableCard({ card, isDone, onOpen, disabled }: { card: CardSummary; isDone: boolean; onOpen: () => void; disabled: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card' }, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners} className="touch-manipulation">
      <CardTile card={card} isDone={isDone} onOpen={onOpen} dragging={isDragging} />
    </li>
  );
}

// ───────────── kolom ─────────────

const KIND_ACCENT: Partial<Record<BoardColumn['kind'], string>> = {
  IN_PROGRESS: 'bg-primary',
  REVIEW: 'bg-muted',
  WAITING_APPROVAL: 'bg-warning',
  BLOCKED: 'bg-danger',
  DONE: 'bg-success',
};

function Column({
  column,
  cards,
  total,
  canWrite,
  onOpen,
  onQuickAdd,
}: {
  column: BoardColumn;
  cards: CardSummary[];
  total: number;
  canWrite: boolean;
  onOpen: (id: string) => void;
  onQuickAdd: (columnId: string, title: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}`, data: { type: 'column', columnId: column.id } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const overWip = column.wipLimit != null && total > column.wipLimit;
  const atWip = column.wipLimit != null && total >= column.wipLimit;
  const isDone = column.kind === 'DONE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    await onQuickAdd(column.id, title.trim());
    setTitle('');
  }

  return (
    <section className="flex w-[272px] shrink-0 flex-col rounded-lg bg-surface-2/70" aria-label={`Kolom ${column.name}`}>
      <header className="flex h-10 items-center gap-2 px-3">
        <span className={cn('size-2 rounded-full', KIND_ACCENT[column.kind] ?? 'bg-border-strong')} aria-hidden="true" />
        <h3 className="truncate text-[13px] font-semibold">{column.name}</h3>
        <span className={cn('tabular text-xs text-muted', (overWip || atWip) && 'font-medium text-warning')} title={column.wipLimit ? `Batas WIP ${column.wipLimit}` : undefined}>
          {total}
          {column.wipLimit ? `/${column.wipLimit}` : ''}
        </span>
        {canWrite && !isDone && (
          <button type="button" onClick={() => setAdding((v) => !v)} className="ml-auto rounded p-1 text-muted hover:bg-surface hover:text-text" aria-label={`Tambah kartu di ${column.name}`}>
            <Icons.plus />
          </button>
        )}
      </header>
      <SortableContext id={column.id} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={cn('flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2', isOver && 'rounded-md bg-primary-soft')}>
          {adding && (
            <li>
              <form onSubmit={submit} className="space-y-1.5 rounded-md border border-primary bg-surface p-2">
                <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul kartu, Enter untuk simpan" maxLength={200} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
                <div className="flex gap-1">
                  <Button size="sm" type="submit" disabled={title.trim().length < 2}>
                    Tambah
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    Batal
                  </Button>
                </div>
              </form>
            </li>
          )}
          {cards.map((c) => (
            <SortableCard key={c.id} card={c} isDone={isDone} onOpen={() => onOpen(c.id)} disabled={!canWrite} />
          ))}
          {!cards.length && !adding && <li className="px-1 py-6 text-center text-xs text-muted">{isDone ? 'Butuh bukti penyelesaian' : 'Kosong'}</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

// ───────────── board ─────────────

type Layout = Record<string, string[]>;

/**
 * Utamakan target di bawah pointer (kartu atau kolom kosong); closestCorners saja cenderung memilih kartu
 * kolom tetangga saat kolom tujuan kosong dan tinggi. Fallback untuk keyboard (tanpa pointer).
 */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCorners(args);
};

function layoutFrom(columns: BoardColumn[], cards: CardSummary[]): Layout {
  const out: Layout = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  for (const c of [...cards].sort((a, b) => a.rank - b.rank)) out[c.columnId]?.push(c.id);
  return out;
}

export interface MoveRequest {
  card: CardSummary;
  columnId: string;
  /** posisi di antara SEMUA kartu kolom tujuan (bukan hanya yang lolos filter) */
  index: number;
}

/**
 * Board Kanban dengan drag & drop (mouse, sentuh, keyboard: Spasi untuk angkat, panah, Spasi untuk taruh).
 * `cards` = kartu yang lolos filter; `allCards` = semua kartu, untuk menghitung posisi sebenarnya di server.
 */
export function KanbanBoard({
  columns,
  cards,
  allCards,
  canWrite,
  onOpen,
  onMove,
  onQuickAdd,
}: {
  columns: BoardColumn[];
  cards: CardSummary[];
  allCards: CardSummary[];
  canWrite: boolean;
  onOpen: (id: string) => void;
  onMove: (m: MoveRequest) => Promise<boolean>;
  onQuickAdd: (columnId: string, title: string) => Promise<void>;
}) {
  const serverLayout = useMemo(() => layoutFrom(columns, cards), [columns, cards]);
  const [layout, setLayout] = useState<Layout>(serverLayout);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId) setLayout(serverLayout);
  }, [serverLayout, activeId]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of allCards) t[c.columnId] = (t[c.columnId] ?? 0) + 1;
    return t;
  }, [allCards]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const containerOf = (id: string, l: Layout = layout): string | undefined => {
    if (id.startsWith('col:')) return id.slice(4);
    return Object.keys(l).find((k) => l[k].includes(id));
  };

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    setOrigin(containerOf(id) ?? null);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = containerOf(String(active.id));
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;
    setLayout((l) => {
      const src = l[from].filter((x) => x !== active.id);
      const dst = [...l[to]];
      const overIdx = dst.indexOf(String(over.id));
      dst.splice(overIdx >= 0 ? overIdx : dst.length, 0, String(active.id));
      return { ...l, [from]: src, [to]: dst };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const id = String(active.id);
    setActiveId(null);
    if (!over) {
      setLayout(serverLayout);
      return;
    }
    const to = containerOf(id);
    if (!to) return;
    let list = layout[to];
    const overId = String(over.id);
    if (!overId.startsWith('col:') && list.includes(overId) && overId !== id) {
      const oldIdx = list.indexOf(id);
      const newIdx = list.indexOf(overId);
      list = [...list];
      list.splice(oldIdx, 1);
      list.splice(newIdx, 0, id);
      setLayout((l) => ({ ...l, [to]: list }));
    }
    const card = byId.get(id);
    if (!card) return;
    const unchanged = to === origin && serverLayout[to]?.join() === list.join();
    if (unchanged) return;

    // Terjemahkan posisi di daftar terfilter ke posisi di seluruh kartu kolom (server).
    const siblings = allCards
      .filter((c) => c.columnId === to && c.id !== id)
      .sort((a, b) => a.rank - b.rank)
      .map((c) => c.id);
    const pos = list.indexOf(id);
    const prev = pos > 0 ? list[pos - 1] : null;
    const next = pos < list.length - 1 ? list[pos + 1] : null;
    const index = prev ? siblings.indexOf(prev) + 1 : next ? Math.max(0, siblings.indexOf(next)) : siblings.length;
    const ok = await onMove({ card, columnId: to, index });
    if (!ok) setLayout(serverLayout);
  }

  const active = activeId ? byId.get(activeId) : null;
  const doneCol = new Set(columns.filter((c) => c.kind === 'DONE').map((c) => c.id));

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setActiveId(null), setLayout(serverLayout))}>
      <div className="-mx-4 flex min-h-[calc(100dvh-14rem)] gap-3 overflow-x-auto px-4 pb-3 md:-mx-6 md:px-6">
        {columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            cards={(layout[col.id] ?? []).map((id) => byId.get(id)).filter((c): c is CardSummary => !!c)}
            total={totals[col.id] ?? 0}
            canWrite={canWrite}
            onOpen={onOpen}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>{active ? <CardTile card={active} isDone={doneCol.has(containerOf(active.id) ?? '')} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
