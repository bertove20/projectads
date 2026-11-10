'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { activityText, BoardColumn, CardDetail, CardSummary, minutes, Person, PRIORITIES, PRIORITY, renderMentions, TaskPriority, todayIn } from '@/lib/tasks';
import type { Campaign } from '@/lib/types';
import { Avatar, DueChip, Icons } from './kanban';
import { Alert, Badge, Button, cn, Drawer, Input, Loading, Select } from './ui';

const TEXTAREA = 'w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] text-text placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft';

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside && <div className="text-xs text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[108px_1fr] items-center gap-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Detail & edit kartu. Setiap perubahan memakai versi kartu; bentrok (409) memuat ulang data terbaru. */
export function CardDrawer({
  cardId,
  columns,
  boardCards,
  onClose,
}: {
  cardId: string | null;
  columns: BoardColumn[];
  boardCards: CardSummary[];
  onClose: () => void;
}) {
  const { can, org } = useSession();
  const q = useOrgQuery<CardDetail>(cardId ? `/cards/${cardId}` : null);
  const people = useOrgQuery<Person[]>(cardId ? '/people' : null);
  const campaigns = useOrgQuery<Campaign[]>(cardId && can('campaigns.read') ? '/campaigns' : null);
  const action = useOrgAction<unknown>();
  const [err, setErr] = useState<string | null>(null);
  const card = q.data;
  const canWrite = can('tasks.write');
  const canApprove = can('tasks.approve');

  useEffect(() => setErr(null), [cardId]);

  async function run(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<boolean> {
    setErr(null);
    try {
      await action.mutateAsync({ method, path, body });
      await q.refetch();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await q.refetch();
        setErr('Kartu baru saja diubah orang lain. Data terbaru sudah dimuat, silakan ulangi.');
      } else setErr(errorMessage(e));
      return false;
    }
  }
  const patch = (body: Record<string, unknown>) => run('PATCH', `/cards/${card!.id}`, { version: card!.version, ...body });

  return (
    <Drawer open={!!cardId} wide title={card ? `T-${card.number}` : 'Kartu'} onClose={onClose}>
      {q.isLoading || !card ? (
        q.error ? <Alert>{errorMessage(q.error)}</Alert> : <Loading rows={8} />
      ) : (
        <CardBody key={card.id} card={card} columns={columns} boardCards={boardCards} people={people.data ?? []} campaigns={campaigns.data ?? []} canWrite={canWrite} canApprove={canApprove} canManage={can('boards.manage')} tz={org.timezone} err={err} busy={action.isPending} run={run} patch={patch} onClose={onClose} />
      )}
    </Drawer>
  );
}

function CardBody({
  card,
  columns,
  boardCards,
  people,
  campaigns,
  canWrite,
  canApprove,
  canManage,
  tz,
  err,
  busy,
  run,
  patch,
  onClose,
}: {
  card: CardDetail;
  columns: BoardColumn[];
  boardCards: CardSummary[];
  people: Person[];
  campaigns: Campaign[];
  canWrite: boolean;
  canApprove: boolean;
  canManage: boolean;
  tz: string;
  err: string | null;
  busy: boolean;
  run: (m: 'POST' | 'PATCH' | 'PUT' | 'DELETE', p: string, b?: unknown) => Promise<boolean>;
  patch: (b: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description ?? '');
  const [evidence, setEvidence] = useState(card.completionEvidence ?? '');
  const [check, setCheck] = useState('');
  const [comment, setComment] = useState('');
  const [link, setLink] = useState({ title: '', url: '' });
  const [time, setTime] = useState({ minutes: '', date: todayIn(tz), note: '' });
  const [dep, setDep] = useState('');
  const commentRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTitle(card.title), [card.title]);
  useEffect(() => setEvidence(card.completionEvidence ?? ''), [card.completionEvidence]);

  const doneCol = columns.find((c) => c.kind === 'DONE');
  const isDone = card.column.kind === 'DONE';
  const assigneeIds = card.assignees.map((a) => a.id);
  const depCandidates = useMemo(() => boardCards.filter((c) => c.id !== card.id && !card.dependsOn.some((d) => d.id === c.id)), [boardCards, card]);
  const openDeps = card.dependsOn.filter((d) => !d.completedAt).length;

  async function moveTo(columnId: string) {
    await run('POST', `/cards/${card.id}/move`, { columnId, index: 100_000, version: card.version });
  }

  function toggleAssignee(id: string) {
    const next = assigneeIds.includes(id) ? assigneeIds.filter((x) => x !== id) : [...assigneeIds, id];
    void patch({ assigneeIds: next });
  }

  function insertMention(p: Person) {
    const token = `@[${p.name}](${p.id}) `;
    const el = commentRef.current;
    const pos = el?.selectionStart ?? comment.length;
    setComment(comment.slice(0, pos) + token + comment.slice(pos));
    requestAnimationFrame(() => el?.focus());
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    if (await run('POST', `/cards/${card.id}/comments`, { body: comment.trim() })) setComment('');
  }

  // Panduan langkah berikut: apa yang masih menghalangi kartu masuk Done.
  const blockers: string[] = [];
  if (!isDone) {
    if (!card.completionEvidence?.trim()) blockers.push('isi bukti penyelesaian');
    if (openDeps) blockers.push(`${openDeps} dependensi belum selesai`);
    if (card.approvalRequired && !canApprove) blockers.push('perlu approval Owner/Team Leader');
  }

  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      {card.archivedAt && <Alert tone="yellow">Kartu ini diarsipkan {dateTime(card.archivedAt, tz)}.</Alert>}
      {card.alert && (
        <Alert tone="yellow">
          Dibuat otomatis dari alert <strong>{card.alert.type.replace(/_/g, ' ').toLowerCase()}</strong> (severity {card.alert.severity.toLowerCase()}, status alert {card.alert.status.toLowerCase()}).{' '}
          <a className="text-primary underline" href="/alerts">
            Lihat alert
          </a>
        </Alert>
      )}

      <div>
        {canWrite ? (
          <textarea
            aria-label="Judul kartu"
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim().length >= 2 && title.trim() !== card.title && void patch({ title: title.trim() })}
            className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[17px] leading-snug font-semibold hover:border-border focus:border-primary focus:outline-none"
          />
        ) : (
          <h2 className="text-[17px] font-semibold">{card.title}</h2>
        )}
        <p className="px-1 text-xs text-muted">
          di {card.board.name}, kolom <span className="font-medium text-text">{card.column.name}</span>
          {card.completedAt && <>, selesai {dateTime(card.completedAt, tz)}</>}
        </p>
      </div>

      <div className="grid gap-2.5 rounded-lg border border-border p-3">
        <Prop label="Kolom">
          <Select aria-label="Pindah kolom" className="h-7" disabled={!canWrite || busy} value={card.columnId} onChange={(e) => moveTo(e.target.value)}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Prop>
        <Prop label="Prioritas">
          <Select aria-label="Prioritas" className="h-7" disabled={!canWrite || busy} value={card.priority} onChange={(e) => patch({ priority: e.target.value as TaskPriority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY[p].label}
              </option>
            ))}
          </Select>
        </Prop>
        <Prop label="Owner">
          <Select aria-label="Owner" className="h-7" disabled={!canWrite || busy} value={card.ownerMembershipId ?? ''} onChange={(e) => patch({ ownerMembershipId: e.target.value || null })}>
            <option value="">Belum ada</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isMe ? ' (saya)' : ''}
              </option>
            ))}
          </Select>
        </Prop>
        <Prop label="Kolaborator">
          <details className="group relative">
            <summary className="flex min-h-7 cursor-pointer list-none flex-wrap items-center gap-1 rounded-md border border-border-strong px-2 py-0.5 text-[13px] [&::-webkit-details-marker]:hidden">
              {card.assignees.length ? (
                card.assignees.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded bg-surface-2 py-px pr-1.5 pl-0.5">
                    <Avatar name={a.name} className="size-5 text-[9.5px]" />
                    {a.name}
                  </span>
                ))
              ) : (
                <span className="text-muted">Tambah kolaborator</span>
              )}
            </summary>
            {canWrite && (
              <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border-strong bg-surface p-1 shadow-lg">
                {people.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-surface-2">
                    <input type="checkbox" checked={assigneeIds.includes(p.id)} disabled={busy} onChange={() => toggleAssignee(p.id)} className="accent-[var(--primary)]" />
                    {p.name}
                    <span className="ml-auto text-xs text-muted">{p.primaryPosition ? p.primaryPosition.replace(/_/g, ' ').toLowerCase() : p.role.name}</span>
                  </label>
                ))}
              </div>
            )}
          </details>
        </Prop>
        <Prop label="Campaign">
          <Select aria-label="Campaign" className="h-7" disabled={!canWrite || busy} value={card.campaignId ?? ''} onChange={(e) => patch({ campaignId: e.target.value || null })}>
            <option value="">Tidak terkait</option>
            {card.campaign && !campaigns.some((c) => c.id === card.campaign!.id) && <option value={card.campaign.id}>{card.campaign.name}</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Prop>
        {card.networkAccount && (
          <Prop label="Akun jaringan">
            <span>
              {card.networkAccount.name} <span className="text-muted">({card.networkAccount.network.toLowerCase()})</span>
            </span>
          </Prop>
        )}
        <Prop label="Jadwal">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="Tanggal mulai" className="h-7 w-36" disabled={!canWrite || busy} value={card.startDate?.slice(0, 10) ?? ''} onChange={(e) => patch({ startDate: e.target.value || null })} />
            <span className="text-muted">sampai</span>
            <Input type="date" aria-label="Tenggat" className="h-7 w-36" disabled={!canWrite || busy} value={card.dueDate?.slice(0, 10) ?? ''} onChange={(e) => patch({ dueDate: e.target.value || null })} />
            <DueChip due={card.dueDate} done={isDone} />
          </div>
        </Prop>
        <Prop label="Approval">
          <label className="inline-flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={card.approvalRequired}
              disabled={!canWrite || busy || (card.approvalRequired && !canApprove)}
              onChange={(e) => patch({ approvalRequired: e.target.checked })}
              className="accent-[var(--primary)]"
            />
            Wajib disetujui Owner/Team Leader sebelum Done
          </label>
        </Prop>
      </div>

      <Section title="Deskripsi">
        {canWrite ? (
          <div className="space-y-2">
            <textarea rows={4} className={TEXTAREA} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Konteks, langkah, hasil yang diharapkan" />
            {desc !== (card.description ?? '') && (
              <div className="flex gap-1">
                <Button size="sm" disabled={busy} onClick={() => patch({ description: desc || null })}>
                  Simpan deskripsi
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDesc(card.description ?? '')}>
                  Batal
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px] whitespace-pre-wrap text-muted">{card.description || 'Tidak ada deskripsi.'}</p>
        )}
      </Section>

      <Section title="Checklist" aside={card.checklist.length ? `${card.checklist.filter((i) => i.done).length}/${card.checklist.length}` : undefined}>
        {card.checklist.length > 0 && (
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-success transition-[width]" style={{ width: `${(card.checklist.filter((i) => i.done).length / card.checklist.length) * 100}%` }} />
          </div>
        )}
        <ul className="space-y-0.5">
          {card.checklist.map((i) => (
            <li key={i.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-2">
              <input type="checkbox" aria-label={i.text} checked={i.done} disabled={!canWrite || busy} onChange={(e) => run('PATCH', `/checklist/${i.id}`, { done: e.target.checked })} className="accent-[var(--primary)]" />
              <span className={cn('flex-1 text-[13px]', i.done && 'text-muted line-through')}>{i.text}</span>
              {canWrite && (
                <button type="button" className="text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100" onClick={() => run('DELETE', `/checklist/${i.id}`)}>
                  Hapus
                </button>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (check.trim() && (await run('POST', `/cards/${card.id}/checklist`, { text: check.trim() }))) setCheck('');
            }}
          >
            <Input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="Tambah item" maxLength={300} />
            <Button size="md" variant="secondary" type="submit" disabled={!check.trim() || busy}>
              Tambah
            </Button>
          </form>
        )}
      </Section>

      <Section title="Bukti penyelesaian" aside={blockers.length && doneCol ? `Sebelum Done: ${blockers.join(', ')}` : isDone ? 'Selesai' : undefined}>
        {canWrite ? (
          <div className="space-y-2">
            <textarea rows={2} className={TEXTAREA} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Apa buktinya tugas ini selesai? mis. tautan laporan, angka sebelum/sesudah, ID postback" />
            <div className="flex flex-wrap gap-1">
              {evidence !== (card.completionEvidence ?? '') && (
                <Button size="sm" variant="secondary" disabled={busy || (isDone && !evidence.trim())} onClick={() => patch({ completionEvidence: evidence.trim() || null })}>
                  Simpan bukti
                </Button>
              )}
              {!isDone && doneCol && blockers.length === 0 && evidence === (card.completionEvidence ?? '') && (
                <Button size="sm" disabled={busy} onClick={() => moveTo(doneCol.id)}>
                  {card.approvalRequired ? 'Setujui & selesaikan' : 'Tandai selesai'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[13px] whitespace-pre-wrap text-muted">{card.completionEvidence || 'Belum ada.'}</p>
        )}
      </Section>

      <Section title="Dependensi" aside={openDeps ? `${openDeps} belum selesai` : undefined}>
        <ul className="space-y-1 text-[13px]">
          {card.dependsOn.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Badge tone={d.completedAt ? 'green' : 'yellow'}>{d.completedAt ? 'selesai' : 'menunggu'}</Badge>
              <span className="tabular text-muted">T-{d.number}</span>
              <span className="flex-1 truncate">{d.title}</span>
              {canWrite && (
                <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => run('DELETE', `/cards/${card.id}/dependencies/${d.id}`)}>
                  Lepas
                </button>
              )}
            </li>
          ))}
          {card.blocks.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-muted">
              <Icons.lock className="size-3" /> menghalangi <span className="tabular">T-{d.number}</span> <span className="truncate">{d.title}</span>
            </li>
          ))}
          {!card.dependsOn.length && !card.blocks.length && <li className="text-muted">Tidak ada.</li>}
        </ul>
        {canWrite && depCandidates.length > 0 && (
          <div className="mt-2 flex gap-2">
            <Select aria-label="Tambah dependensi" value={dep} onChange={(e) => setDep(e.target.value)}>
              <option value="">Kartu ini menunggu…</option>
              {depCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  T-{c.number} {c.title}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!dep || busy} onClick={async () => (await run('POST', `/cards/${card.id}/dependencies`, { dependsOnCardId: dep })) && setDep('')}>
              Tambah
            </Button>
          </div>
        )}
      </Section>

      <Section title="Tautan">
        <ul className="space-y-1 text-[13px]">
          {card.links.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <Icons.link className="text-muted" />
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="flex-1 truncate text-primary hover:underline">
                {l.title}
              </a>
              {canWrite && (
                <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => run('DELETE', `/links/${l.id}`)}>
                  Hapus
                </button>
              )}
            </li>
          ))}
          {!card.links.length && <li className="text-muted">Belum ada tautan (laporan, creative, dokumen).</li>}
        </ul>
        {canWrite && (
          <form
            className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run('POST', `/cards/${card.id}/links`, link)) setLink({ title: '', url: '' });
            }}
          >
            <Input required value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Judul" maxLength={120} />
            <Input required type="url" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://" />
            <Button variant="secondary" type="submit" disabled={busy}>
              Tambah
            </Button>
          </form>
        )}
      </Section>

      <Section title="Catatan waktu" aside={card.totalMinutes ? `Total ${minutes(card.totalMinutes)}` : undefined}>
        <ul className="space-y-1 text-[13px]">
          {card.timeEntries.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span className="w-20 tabular font-medium">{minutes(t.minutes)}</span>
              <span className="text-muted">{t.date.slice(0, 10)}</span>
              <span className="truncate">{t.member?.name}</span>
              {t.note && <span className="truncate text-muted">{t.note}</span>}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form
            className="mt-2 grid gap-2 sm:grid-cols-[110px_150px_1fr_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run('POST', `/cards/${card.id}/time`, { minutes: Number(time.minutes), date: time.date, ...(time.note ? { note: time.note } : {}) })) setTime({ ...time, minutes: '', note: '' });
            }}
          >
            <Input required type="number" min={1} max={1440} value={time.minutes} onChange={(e) => setTime({ ...time, minutes: e.target.value })} placeholder="Menit" aria-label="Menit" />
            <Input required type="date" value={time.date} onChange={(e) => setTime({ ...time, date: e.target.value })} aria-label="Tanggal" />
            <Input value={time.note} onChange={(e) => setTime({ ...time, note: e.target.value })} placeholder="Catatan (opsional)" maxLength={300} />
            <Button variant="secondary" type="submit" disabled={busy}>
              Catat
            </Button>
          </form>
        )}
      </Section>

      <Section title="Diskusi" aside={card.comments.length ? `${card.comments.length} komentar` : undefined}>
        <ul className="space-y-3">
          {card.comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.authorName} className="size-7 text-[11px]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-semibold">{c.authorName}</span> <span className="text-muted">{dateTime(c.createdAt, tz)}</span>
                </p>
                <p className="mt-0.5 text-[13px] break-words whitespace-pre-wrap">{renderMentions(c.body)}</p>
              </div>
            </li>
          ))}
        </ul>
        {canWrite && (
          <form className="mt-3 space-y-2" onSubmit={submitComment}>
            <textarea ref={commentRef} rows={3} className={TEXTAREA} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tulis komentar. Sebut rekan dengan tombol Mention." maxLength={5000} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" type="submit" disabled={!comment.trim() || busy}>
                Kirim
              </Button>
              <Select
                aria-label="Mention anggota"
                className="h-7 w-44"
                value=""
                onChange={(e) => {
                  const p = people.find((x) => x.id === e.target.value);
                  if (p) insertMention(p);
                }}
              >
                <option value="">@ Mention…</option>
                {people
                  .filter((p) => !p.isMe)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </div>
          </form>
        )}
      </Section>

      <Section title="Aktivitas">
        <ol className="space-y-1.5 border-l border-border pl-3 text-xs">
          {card.activities.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute top-1.5 -left-[15.5px] size-1.5 rounded-full bg-border-strong" aria-hidden="true" />
              <span className="font-medium text-text">{a.actorName}</span> <span className="text-muted">{activityText(a)}</span> <span className="text-muted">{dateTime(a.createdAt, tz)}</span>
            </li>
          ))}
        </ol>
      </Section>

      {canWrite && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => patch({ archived: !card.archivedAt })}>
            {card.archivedAt ? 'Pulihkan dari arsip' : 'Arsipkan'}
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              disabled={busy}
              onClick={async () => {
                if (window.confirm(`Hapus permanen T-${card.number}? Riwayat kartu ikut terhapus.`) && (await run('DELETE', `/cards/${card.id}`))) onClose();
              }}
            >
              Hapus permanen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
