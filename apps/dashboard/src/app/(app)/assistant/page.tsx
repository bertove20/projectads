'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, KeyboardEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, cn, Loading, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { AiDraft, AiMessage, Conversation, ConversationSummary, REASON_TEXT, RichText, SUGGESTIONS, TOOL_LABEL, usd, Workspace } from '@/lib/ai';
import { dateTime } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { PRIORITY } from '@/lib/tasks';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular">
          {usd(used)}
          {limit != null && <span className="text-muted"> / {usd(limit)}</span>}
        </span>
      </div>
      {limit != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className={cn('h-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function toolArgsText(args: string): string {
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const parts = Object.entries(a).map(([k, v]) => `${k}: ${String(v)}`);
    return parts.length ? parts.join(', ') : '';
  } catch {
    return '';
  }
}

function ToolStep({ call, result }: { call: NonNullable<AiMessage['toolCalls']>[number]; result?: AiMessage }) {
  const failed = result?.content.includes('"error"');
  let pretty = result?.content ?? '';
  try {
    pretty = JSON.stringify(JSON.parse(pretty), null, 2);
  } catch {
    /* biarkan apa adanya */
  }
  const args = toolArgsText(call.function.arguments);
  return (
    <details className="group rounded-md border border-border bg-surface-2/60 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
        <span className={cn('size-1.5 rounded-full', failed ? 'bg-warning' : 'bg-success')} aria-hidden="true" />
        <span className="font-medium">{TOOL_LABEL[call.function.name] ?? call.function.name}</span>
        {args && <span className="truncate text-muted">{args}</span>}
        <span className="ml-auto shrink-0 text-muted group-open:hidden">Lihat data</span>
        <span className="ml-auto hidden shrink-0 text-muted group-open:inline">Tutup</span>
      </summary>
      <pre className="max-h-72 overflow-auto border-t border-border px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">{pretty.slice(0, 6000) || 'Tidak ada hasil.'}</pre>
    </details>
  );
}

function MessageList({ conv, pendingText }: { conv: Conversation | null; pendingText: string | null }) {
  const items = conv?.messages ?? [];
  const results = new Map(items.filter((m) => m.role === 'TOOL').map((m) => [m.toolCallId, m]));
  return (
    <ol className="space-y-4">
      {items.map((m) => {
        if (m.role === 'TOOL') return null;
        if (m.role === 'USER')
          return (
            <li key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-[13.5px] whitespace-pre-wrap text-primary-fg">{m.content}</div>
            </li>
          );
        if (m.toolCalls?.length)
          return (
            <li key={m.id} className="space-y-1.5 pl-1">
              {m.content && <p className="text-[13px] text-muted">{m.content}</p>}
              {m.toolCalls.map((c) => (
                <ToolStep key={c.id} call={c} result={results.get(c.id)} />
              ))}
            </li>
          );
        return (
          <li key={m.id} className="max-w-[92%]">
            <RichText text={m.content} />
            {m.modelId && <p className="mt-1 text-[11px] text-muted">{m.modelId}</p>}
          </li>
        );
      })}
      {pendingText && (
        <>
          <li className="flex justify-end">
            <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary/80 px-3 py-2 text-[13.5px] whitespace-pre-wrap text-primary-fg">{pendingText}</div>
          </li>
          <li className="flex items-center gap-2 text-[13px] text-muted" role="status">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            Menganalisis, mungkin mengambil data…
          </li>
        </>
      )}
    </ol>
  );
}

function Drafts({ drafts, onChanged }: { drafts: AiDraft[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Record<string, { boardId: string; cardId: string; number: number }>>({});
  if (!drafts.length) return null;
  async function act(d: AiDraft, action: 'accept' | 'dismiss') {
    setBusy(d.id);
    setErr(null);
    try {
      const r = await api<{ cardId: string; boardId: string; number: number }>(`/ai/drafts/${d.id}/${action}`, { method: 'POST', body: {} });
      if (action === 'accept') setMade((m) => ({ ...m, [d.id]: r }));
      onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="rounded-lg border border-border bg-surface p-3" aria-label="Draft task dari AI">
      <h3 className="mb-2 text-[13px] font-semibold">Draft task dari AI</h3>
      <p className="mb-2 text-xs text-muted">AI hanya mengusulkan. Kartu baru dibuat di board default setelah Anda setujui.</p>
      {err && <Alert>{err}</Alert>}
      <ul className="space-y-2">
        {drafts.map((d) => (
          <li key={d.id} className={cn('rounded-md border border-border p-2.5', d.status !== 'PENDING' && 'opacity-70')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{d.title}</span>
              <Badge tone={PRIORITY[d.priority].tone}>{PRIORITY[d.priority].label}</Badge>
              {d.dueDate && <span className="text-xs text-muted">tenggat {d.dueDate.slice(0, 10)}</span>}
            </div>
            {d.description && <p className="mt-1 text-xs whitespace-pre-wrap text-muted">{d.description}</p>}
            <div className="mt-2 flex items-center gap-2">
              {d.status === 'PENDING' ? (
                <>
                  <Button size="sm" disabled={busy === d.id} onClick={() => act(d, 'accept')}>
                    Buat kartu
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => act(d, 'dismiss')}>
                    Abaikan
                  </Button>
                </>
              ) : d.status === 'ACCEPTED' ? (
                <span className="text-xs text-success">
                  Kartu dibuat
                  {made[d.id] ? (
                    <>
                      {' '}
                      <Link className="font-medium text-primary underline" href={`/boards/${made[d.id].boardId}?card=${made[d.id].cardId}`}>
                        T-{made[d.id].number}
                      </Link>
                    </>
                  ) : null}
                </span>
              ) : (
                <span className="text-xs text-muted">Diabaikan</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AssistantInner() {
  const { org } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const search = useSearchParams();
  const activeId = search.get('c');
  const [position, setPosition] = useState<string>('');
  const ws = useOrgQuery<Workspace>(`/ai/workspace${position ? `?position=${position}` : ''}`);
  const list = useOrgQuery<ConversationSummary[]>('/ai/conversations');
  const conv = useOrgQuery<Conversation>(activeId ? `/ai/conversations/${activeId}` : null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const w = ws.data;
  const convPosition = conv.data?.position;
  const positionLabel = useMemo(() => w?.positions.find((p) => p.key === (convPosition ?? w.position))?.agent ?? w?.agent, [w, convPosition]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [conv.data?.messages.length, pending]);

  const open = (id: string | null) => router.replace(id ? `/assistant?c=${id}` : '/assistant', { scroll: false });

  async function send(message: string) {
    const m = message.trim();
    if (!m || pending) return;
    setErr(null);
    setPending(m);
    setText('');
    try {
      const r = await api<Conversation>('/ai/chat', { method: 'POST', body: { message: m, ...(activeId ? { conversationId: activeId } : position ? { position } : {}) } });
      qc.setQueryData([org.id, `/ai/conversations/${r.id}`], r);
      if (r.id !== activeId) open(r.id);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === org.id && typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith('/ai/') && q.queryKey[1] !== `/ai/conversations/${r.id}` });
    } catch (e) {
      setErr(errorMessage(e));
      setText(m);
    } finally {
      setPending(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  }

  if (ws.isLoading) return <Loading rows={6} />;
  if (!w) return <Alert>{errorMessage(ws.error)}</Alert>;
  const reason = w.reason ? REASON_TEXT[w.reason] : null;
  const suggestions = (w.position && SUGGESTIONS[w.position]) || [];

  return (
    <div className="-mx-4 -my-5 grid h-[calc(100dvh-3rem)] grid-cols-1 lg:-mx-8 lg:-my-6 lg:grid-cols-[260px_1fr]">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-surface lg:flex" aria-label="Riwayat percakapan">
        <div className="p-3">
          <Button className="w-full" variant="secondary" onClick={() => open(null)}>
            + Percakapan baru
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {list.data?.length ? (
            <ul className="space-y-0.5">
              {list.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    aria-current={c.id === activeId ? 'page' : undefined}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-2', c.id === activeId && 'bg-primary-soft text-primary')}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c._count.drafts > 0 && <Badge tone="blue">{c._count.drafts}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-4 text-xs text-muted">Belum ada percakapan.</p>
          )}
        </nav>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-3 md:px-6">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold">{positionLabel ?? 'AI Assistant'}</h1>
            <p className="truncate text-xs text-muted">
              {w.model ? `${w.model.name}${w.fallback ? `, fallback ${w.fallback.name}` : ''}` : 'Model belum dipilih'}
              {w.skills?.length ? `, ${w.skills.length} skill aktif` : ''}
            </p>
          </div>
          {w.positions.length > 1 && !activeId && (
            <Select aria-label="Jabatan" className="w-52" value={position || w.position || ''} onChange={(e) => setPosition(e.target.value)}>
              {w.positions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
          <div className="ml-auto grid w-full grid-cols-2 gap-4 sm:w-80">
            <Meter label="Hari ini" used={w.spent.today} limit={w.limits?.dailyBudgetUsd ?? null} />
            <Meter label="Bulan ini" used={w.spent.month} limit={w.limits?.monthlyBudgetUsd ?? null} />
          </div>
          <div className="w-full lg:hidden">
            <Select aria-label="Percakapan" value={activeId ?? ''} onChange={(e) => open(e.target.value || null)}>
              <option value="">+ Percakapan baru</option>
              {list.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {reason ? (
              <div className="rounded-lg border border-border bg-surface p-6 text-center">
                <h2 className="text-[15px] font-semibold">{reason.title}</h2>
                <p className="mt-1 text-[13px] text-muted">{reason.body}</p>
              </div>
            ) : !activeId && !pending ? (
              <div className="py-6">
                <h2 className="text-lg font-semibold">Apa yang ingin Anda periksa?</h2>
                <p className="mt-1 max-w-xl text-[13px] text-muted">
                  {positionLabel} membaca data campaign yang boleh Anda akses lewat tool server, lalu menjawab dengan angka yang bisa dicek. AI tidak mengubah campaign; tindakan diusulkan sebagai draft task.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-md border border-border bg-surface px-3 py-2.5 text-left text-[13px] hover:border-primary hover:text-primary">
                      {s}
                    </button>
                  ))}
                </div>
                {w.tools?.length ? <p className="mt-4 text-xs text-muted">Data yang bisa diambil: {w.tools.map((t) => TOOL_LABEL[t] ?? t).join(', ')}.</p> : null}
              </div>
            ) : conv.isLoading && !pending ? (
              <Loading rows={5} />
            ) : (
              <MessageList conv={activeId ? (conv.data ?? null) : null} pendingText={pending} />
            )}
            {conv.data && activeId && <Drafts drafts={conv.data.drafts} onChanged={() => conv.refetch()} />}
            {err && <Alert>{err}</Alert>}
            <div ref={endRef} />
          </div>
        </div>

        <form onSubmit={onSubmit} className="border-t border-border bg-surface px-4 py-3 md:px-6">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              maxLength={4000}
              disabled={!!reason}
              aria-label="Pesan untuk AI Assistant"
              placeholder={reason ? 'AI belum tersedia' : 'Tanyakan performa, zone, tracking… (Enter kirim, Shift+Enter baris baru)'}
              className="min-h-[44px] flex-1 resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-[13.5px] placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft disabled:opacity-60"
            />
            <Button type="submit" className="h-[44px] px-4" disabled={!text.trim() || !!pending || !!reason}>
              Kirim
            </Button>
          </div>
          <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted">
            Jawaban AI bisa keliru. Periksa angka di laporan sebelum mengambil keputusan. Percakapan AI dapat diaudit oleh Owner untuk transparansi.
            {conv.data && ` Percakapan dimulai ${dateTime(conv.data.messages[0]?.createdAt, org.timezone)}.`}
          </p>
        </form>
      </section>
    </div>
  );
}

export default function AssistantPage() {
  return (
    <RequirePermission permission="ai.use">
      <Suspense fallback={<Loading rows={6} />}>
        <AssistantInner />
      </Suspense>
    </RequirePermission>
  );
}
