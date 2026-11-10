'use client';

import Link from 'next/link';
import { RequirePermission } from '@/components/app-shell';
import { Avatar, DueChip, Icons } from '@/components/kanban';
import { Badge, Card, cn, Loading, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dueState, MyTasks, PRIORITY, renderMentions, useTaskStream } from '@/lib/tasks';

type Group = { key: string; title: string; hint: string; cards: MyTasks['cards'] };

export default function MyTasksPage() {
  const { org } = useSession();
  useTaskStream();
  const q = useOrgQuery<MyTasks>('/tasks/mine', { refetchInterval: 120_000 });
  const cards = q.data?.cards ?? [];
  const open = cards.filter((c) => c.column.kind !== 'DONE');
  const groups: Group[] = [
    { key: 'overdue', title: 'Lewat tenggat', hint: 'Selesaikan atau ubah tenggatnya', cards: open.filter((c) => dueState(c.dueDate, false, org.timezone) === 'overdue') },
    { key: 'today', title: 'Hari ini', hint: '', cards: open.filter((c) => dueState(c.dueDate, false, org.timezone) === 'today') },
    { key: 'soon', title: '3 hari ke depan', hint: '', cards: open.filter((c) => dueState(c.dueDate, false, org.timezone) === 'soon') },
    { key: 'later', title: 'Nanti & tanpa tenggat', hint: '', cards: open.filter((c) => ['later', null].includes(dueState(c.dueDate, false, org.timezone))) },
    { key: 'done', title: 'Selesai 7 hari terakhir', hint: '', cards: cards.filter((c) => c.column.kind === 'DONE') },
  ];
  const overdue = groups[0].cards.length;
  const waiting = open.filter((c) => c.column.kind === 'WAITING_APPROVAL').length;

  return (
    <RequirePermission permission="tasks.read">
      <PageHeader title="Tugas saya" description="Kartu yang Anda pegang atau ikuti di semua board, dan komentar yang menyebut Anda." />
      {q.isLoading ? (
        <Loading rows={6} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-5">
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
              {[
                { label: 'Aktif', value: open.length, tone: '' },
                { label: 'Lewat tenggat', value: overdue, tone: overdue ? 'text-danger' : '' },
                { label: 'Menunggu approval', value: waiting, tone: '' },
              ].map((s) => (
                <div key={s.label} className="bg-surface px-4 py-3">
                  <div className="text-xs text-muted">{s.label}</div>
                  <div className={cn('tabular text-2xl font-semibold', s.tone)}>{s.value}</div>
                </div>
              ))}
            </div>
            {!cards.length && (
              <Card>
                <p className="py-8 text-center text-[13px] text-muted">
                  Belum ada tugas untuk Anda. Lihat{' '}
                  <Link href="/boards" className="text-primary underline">
                    board tim
                  </Link>
                  .
                </p>
              </Card>
            )}
            {groups
              .filter((g) => g.cards.length)
              .map((g) => (
                <Card key={g.key} flush title={<span className={cn(g.key === 'overdue' && 'text-danger')}>{`${g.title} (${g.cards.length})`}</span>}>
                  <ul className="divide-y divide-border">
                    {g.cards.map((c) => (
                      <li key={c.id}>
                        <Link href={`/boards/${c.board.id}?card=${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                          <span className="w-14 shrink-0 tabular text-xs text-muted">T-{c.number}</span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate text-[13px] font-medium', c.column.kind === 'DONE' && 'text-muted line-through')}>{c.title}</span>
                            <span className="block truncate text-xs text-muted">
                              {c.board.name}, {c.column.name}
                              {c.campaign ? `, ${c.campaign.name}` : ''}
                            </span>
                          </span>
                          {c.source === 'ALERT' && (
                            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-danger">
                              <Icons.bolt className="size-3" />
                              insiden
                            </span>
                          )}
                          {(c.priority === 'URGENT' || c.priority === 'HIGH') && <Badge tone={PRIORITY[c.priority].tone}>{PRIORITY[c.priority].label}</Badge>}
                          {c.checklistTotal > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted tabular">
                              <Icons.check className="size-3" />
                              {c.checklistDone}/{c.checklistTotal}
                            </span>
                          )}
                          <DueChip due={c.dueDate} done={c.column.kind === 'DONE'} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
          </div>
          <Card title="Disebut dalam komentar" flush className="self-start">
            {q.data?.mentions.length ? (
              <ul className="divide-y divide-border">
                {q.data.mentions.map((m) => (
                  <li key={m.id}>
                    <Link href={`/boards/${m.card.boardId}?card=${m.card.id}`} className="flex gap-2.5 px-4 py-3 hover:bg-surface-2">
                      <Avatar name={m.authorName} className="size-7 text-[11px]" />
                      <span className="min-w-0">
                        <span className="block text-xs">
                          <span className="font-semibold">{m.authorName}</span> <span className="text-muted">di T-{m.card.number}</span>
                        </span>
                        <span className="line-clamp-2 text-[13px]">{renderMentions(m.body)}</span>
                        <span className="text-xs text-muted">{dateTime(m.createdAt, org.timezone)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-muted">Tidak ada mention 14 hari terakhir.</p>
            )}
          </Card>
        </div>
      )}
    </RequirePermission>
  );
}
