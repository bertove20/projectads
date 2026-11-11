'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, CopyText, Drawer, Field, Input, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { NotificationChannel } from '@/lib/types';

interface Identity {
  id: string;
  platform: 'TELEGRAM' | 'DISCORD';
  username: string | null;
  linkedAt: string;
  member: { id: string; name: string };
  mine: boolean;
}

function LinkAccount() {
  const ids = useOrgQuery<Identity[]>('/chat/identities');
  const act = useOrgAction();
  const [code, setCode] = useState<{ code: string; expiresAt: string; telegram: string; discord: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function make() {
    setErr(null);
    try {
      setCode(await api('/chat/link-code', { method: 'POST' }));
    } catch (e) {
      setErr(errorMessage(e));
    }
  }
  const mine = (ids.data ?? []).filter((i) => i.mine);
  const others = (ids.data ?? []).filter((i) => !i.mine);
  return (
    <Card title="Akun chat saya">
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Tautkan akun Telegram/Discord Anda agar bisa memerintah Tim AI dari grup. Izin tetap mengikuti role Anda di EAIP.</p>
        {mine.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {mine.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2">
                <Badge tone={i.platform === 'TELEGRAM' ? 'blue' : 'gray'}>{i.platform === 'TELEGRAM' ? 'Telegram' : 'Discord'}</Badge>
                <span className="font-medium">{i.username ?? '—'}</span>
                <span className="text-xs text-muted">sejak {dateTime(i.linkedAt)}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => confirm('Putuskan tautan akun ini?') && act.mutate({ method: 'DELETE', path: `/chat/identities/${i.id}` })}>
                  Putuskan
                </Button>
              </li>
            ))}
          </ul>
        )}
        {code ? (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary-soft/30 p-3">
            <p>
              Kode berlaku sampai <b>{dateTime(code.expiresAt)}</b> dan hanya bisa dipakai sekali. Kirim di grup atau chat pribadi dengan bot:
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs text-muted">Telegram</p>
                <CopyText value={code.telegram} />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">Discord</p>
                <CopyText value={code.discord} />
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setCode(null); ids.refetch(); }}>
              Sudah, perbarui daftar
            </Button>
          </div>
        ) : (
          <Button onClick={make}>Buat kode tautan</Button>
        )}
        {err && <Alert>{err}</Alert>}
        {others.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted">Akun tertaut anggota lain ({others.length})</summary>
            <ul className="mt-1 space-y-1">
              {others.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-[12.5px]">
                  <Badge>{i.platform === 'TELEGRAM' ? 'Telegram' : 'Discord'}</Badge>
                  {i.member.name} · {i.username ?? '—'}
                  <button type="button" className="ml-auto text-xs text-muted hover:text-danger" onClick={() => confirm('Putuskan tautan akun ini?') && act.mutate({ method: 'DELETE', path: `/chat/identities/${i.id}` })}>
                    Putuskan
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function DiscordForm({ onDone }: { onDone: (r: { id: string; interactionsUrl: string }) => void }) {
  const [f, setF] = useState({ name: 'Discord tim', guildId: '', webhookUrl: '', applicationId: '', publicKey: '', botToken: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
      onDone(await api('/notification-channels/discord', { method: 'POST', body }));
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nama">
        <Input value={f.name} onChange={set('name')} required />
      </Field>
      <Field label="Server (guild) ID" hint="Discord → Pengaturan → Advanced → Developer Mode, lalu klik kanan server → Copy Server ID.">
        <Input value={f.guildId} onChange={set('guildId')} inputMode="numeric" required />
      </Field>
      <Field label="URL webhook channel" hint="Channel → Edit Channel → Integrations → Webhooks → Copy Webhook URL. Untuk kabar tim & alert.">
        <Input value={f.webhookUrl} onChange={set('webhookUrl')} placeholder="https://discord.com/api/webhooks/…" required />
      </Field>
      <p className="pt-1 text-xs font-medium text-muted">Untuk perintah slash /eaip (opsional, dari Discord Developer Portal → aplikasi Anda)</p>
      <Field label="Application ID">
        <Input value={f.applicationId} onChange={set('applicationId')} inputMode="numeric" />
      </Field>
      <Field label="Public key" hint="General Information → Public Key (64 karakter hex).">
        <Input value={f.publicKey} onChange={set('publicKey')} />
      </Field>
      <Field label="Bot token" hint="Hanya dipakai server untuk mendaftarkan perintah; disimpan terenkripsi, tidak pernah ditampilkan lagi.">
        <Input type="password" value={f.botToken} onChange={set('botToken')} autoComplete="off" />
      </Field>
      {err && <Alert>{err}</Alert>}
      <Button type="submit" disabled={busy}>
        Simpan channel Discord
      </Button>
    </form>
  );
}

function Channels() {
  const channels = useOrgQuery<NotificationChannel[]>('/notification-channels');
  const act = useOrgAction();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const interactionsUrl = (id: string) => `${window.location.origin}/api/v1/integrations/discord/${id}/interactions`;
  const toggle = (c: NotificationChannel, body: Record<string, boolean>) => act.mutate({ method: 'PATCH', path: `/notification-channels/${c.id}`, body });
  async function register(c: NotificationChannel) {
    setMsg(null);
    try {
      await api(`/notification-channels/${c.id}/discord/commands`, { method: 'POST' });
      setMsg({ tone: 'green', text: `Perintah /eaip terdaftar di server Discord "${c.name}".` });
    } catch (e) {
      setMsg({ tone: 'red', text: errorMessage(e) });
    }
  }
  return (
    <Card
      title="Grup Telegram & Discord"
      actions={
        <>
          <Link href="/alerts" className="inline-flex h-7 items-center rounded-md border border-border-strong px-2.5 text-[12.5px] font-medium hover:bg-surface-2">
            + Telegram
          </Link>
          <Button size="sm" onClick={() => setAdding(true)}>
            + Discord
          </Button>
        </>
      }
      flush
    >
      {channels.isLoading ? (
        <Loading rows={2} />
      ) : !channels.data?.length ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Belum ada channel. Tambahkan bot Telegram (halaman Alerts) atau Discord.</p>
      ) : (
        <ul className="divide-y divide-border">
          {channels.data.map((c) => (
            <li key={c.id} className="space-y-2 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={c.type === 'TELEGRAM' ? 'blue' : 'gray'}>{c.type === 'TELEGRAM' ? 'Telegram' : 'Discord'}</Badge>
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs text-muted">{c.target}</span>
                {!c.enabled && <Badge>Nonaktif</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={c.commandsEnabled} onChange={(e) => toggle(c, { commandsEnabled: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
                  Terima perintah dari grup ini
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={c.teamUpdates} onChange={(e) => toggle(c, { teamUpdates: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
                  Kirim kabar Tim AI (rapat selesai, usulan menunggu)
                </label>
              </div>
              {c.type === 'DISCORD' && (
                <div className="space-y-1.5 rounded-md bg-surface-2/60 p-2.5 text-xs">
                  <p className="text-muted">Interactions Endpoint URL (tempel di Developer Portal → General Information):</p>
                  <CopyText value={interactionsUrl(c.id)} />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" variant="secondary" onClick={() => register(c)} disabled={!c.config?.applicationId}>
                      Daftarkan perintah /eaip
                    </Button>
                    {!c.config?.publicKey && <span className="text-warning">Public key belum diisi — perintah slash tidak bisa diverifikasi.</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <div className="border-t border-border p-3">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <Drawer open={adding} title="Channel Discord baru" onClose={() => setAdding(false)}>
        <DiscordForm
          onDone={() => {
            setAdding(false);
            void channels.refetch();
            setMsg({ tone: 'green', text: 'Channel Discord tersimpan. Salin Interactions Endpoint URL ke Developer Portal, lalu daftarkan perintah /eaip.' });
          }}
        />
      </Drawer>
    </Card>
  );
}

function PlatformCard() {
  const team = useOrgQuery<{ settings: { chatPlatform: 'TELEGRAM' | 'DISCORD'; chatApprovals: boolean } }>('/ai/team');
  const act = useOrgAction();
  const s = team.data?.settings;
  if (!s) return <Loading rows={2} />;
  const set = (body: Record<string, unknown>) => act.mutate({ method: 'PATCH', path: '/ai/team/settings', body });
  return (
    <Card title="Platform chat aktif">
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Hanya satu platform yang aktif: perintah, kabar Tim AI, alert, dan persetujuan lewat chat hanya berjalan di platform yang dipilih.</p>
        <div role="radiogroup" aria-label="Platform chat aktif" className="grid grid-cols-2 gap-2">
          {(['TELEGRAM', 'DISCORD'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={s.chatPlatform === p}
              disabled={act.isPending}
              onClick={() => s.chatPlatform !== p && confirm(`Aktifkan ${p === 'TELEGRAM' ? 'Telegram' : 'Discord'}? Platform lain berhenti menerima perintah dan kabar.`) && set({ chatPlatform: p })}
              className={`rounded-lg border px-3 py-2.5 text-left ${s.chatPlatform === p ? 'border-primary bg-primary-soft/40' : 'border-border hover:border-border-strong'}`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className={`size-2.5 rounded-full ${s.chatPlatform === p ? 'bg-primary' : 'bg-border-strong'}`} aria-hidden />
                {p === 'TELEGRAM' ? 'Telegram' : 'Discord'}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{s.chatPlatform === p ? 'Aktif' : 'Nonaktif'}</span>
            </button>
          ))}
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={s.chatApprovals} onChange={(e) => set({ chatApprovals: e.target.checked })} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
          <span>
            Izinkan menyetujui/menolak usulan dari chat
            <span className="block text-xs text-muted">Wajib akun tertaut dengan izin approve, dan selalu ada konfirmasi kedua sebelum dijalankan. Semua keputusan tercatat di audit log.</span>
          </span>
        </label>
      </div>
    </Card>
  );
}

function Guide() {
  return (
    <Card title="Cara memerintah Tim AI dari chat">
      <div className="space-y-3 text-[13px] leading-relaxed">
        <div>
          <p className="font-medium">Telegram</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-muted">
            <li>Tambahkan bot ke grup, daftarkan grup di halaman Alerts (chat ID grup), lalu centang “Terima perintah”.</li>
            <li>Tautkan akun: kirim <code className="rounded bg-surface-2 px-1">/hubungkan KODE</code>.</li>
            <li>
              Perintah: <code className="rounded bg-surface-2 px-1">/perintah evaluasi campaign TH</code>, <code className="rounded bg-surface-2 px-1">/revisi KODE catatan</code>, <code className="rounded bg-surface-2 px-1">/rapat</code>, <code className="rounded bg-surface-2 px-1">/status</code>,{' '}
              <code className="rounded bg-surface-2 px-1">/usulan</code>, <code className="rounded bg-surface-2 px-1">/stop</code>, <code className="rounded bg-surface-2 px-1">/lanjut</code>. Di grup, bot menerima perintah tanpa perlu mematikan privacy mode.
            </li>
            <li>Di chat pribadi dengan bot, pesan biasa langsung dianggap perintah ke Kepala Tim AI.</li>
          </ol>
        </div>
        <div>
          <p className="font-medium">Discord</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-muted">
            <li>Buat aplikasi di Discord Developer Portal, undang bot ke server dengan scope <code className="rounded bg-surface-2 px-1">applications.commands</code>.</li>
            <li>Tambah channel Discord di sini, tempel Interactions Endpoint URL di Developer Portal, lalu klik “Daftarkan perintah /eaip”.</li>
            <li>
              Tautkan akun: <code className="rounded bg-surface-2 px-1">/eaip hubungkan kode:KODE</code>. Perintah lain: <code className="rounded bg-surface-2 px-1">/eaip perintah teks:…</code>, <code className="rounded bg-surface-2 px-1">/eaip rapat</code>,{' '}
              <code className="rounded bg-surface-2 px-1">/eaip status</code>.
            </li>
          </ol>
        </div>
        <div>
          <p className="font-medium">Persetujuan dari chat</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            <li>Telegram: setelah rapat/perintah selesai, setiap usulan dikirim sebagai kartu dengan tombol Setujui/Tolak. Ketik /usulan untuk menampilkannya lagi.</li>
            <li>Discord: ketik <code className="rounded bg-surface-2 px-1">/eaip usulan</code> lalu tekan tombolnya.</li>
            <li>Setiap tombol meminta konfirmasi kedua (“Ya, jalankan”) dan hanya berlaku untuk akun tertaut yang punya izin approve.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function ChatSettingsPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader title="Telegram & Discord" description="Perintah Tim AI dari grup chat, kabar hasil rapat, dan tautan akun. Semua perintah tercatat di audit log." />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {can('ai.supervise') && <PlatformCard />}
          <LinkAccount />
          {can('notifications.manage') && <Channels />}
        </div>
        <div className="min-w-0">
          <Guide />
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <RequirePermission permission="org.read">
      <ChatSettingsPage />
    </RequirePermission>
  );
}
