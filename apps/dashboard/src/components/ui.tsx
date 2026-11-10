'use client';

import clsx, { type ClassValue } from 'clsx';
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';

/** Gabungkan kelas; kelas yang datang belakangan (dari pemanggil) menang atas default komponen. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CONTROL = 'h-8 rounded-md border border-border-strong bg-surface text-[13px] text-text placeholder:text-muted disabled:opacity-60 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft';

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      type={props.type ?? 'button'}
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-primary text-primary-fg hover:brightness-110',
        variant === 'secondary' && 'border border-border-strong bg-surface text-text hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-text',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, 'w-full px-2.5', className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(CONTROL, 'w-full cursor-pointer pl-2.5 pr-7', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1 text-[13px]', className)}>
      <span className="font-medium text-text">{label}</span>
      {children}
      {hint && <span className="text-xs leading-snug text-muted">{hint}</span>}
    </label>
  );
}

/** Panel konten. Tanpa bayangan; hierarki dibawa oleh border dan tipografi. */
export function Card({ title, actions, children, className, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('min-w-0 rounded-lg border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          {title ? <h2 className="text-[13px] font-semibold">{title}</h2> : <span />}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : 'p-4'}>{children}</div>
    </section>
  );
}

/** Baris judul halaman: judul di kiri, kontrol (filter/aksi) dalam satu baris di kanan. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">{actions}</div>}
    </div>
  );
}

const BADGE_TONES = {
  green: 'bg-success/12 text-success',
  yellow: 'bg-warning/14 text-warning',
  red: 'bg-danger/12 text-danger',
  blue: 'bg-primary-soft text-primary',
  gray: 'bg-surface-2 text-muted',
} as const;

export function Badge({ tone = 'gray', children, className }: { tone?: keyof typeof BADGE_TONES; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-sm px-1.5 py-px text-xs font-medium whitespace-nowrap', BADGE_TONES[tone], className)}>{children}</span>;
}

const STATUS: Record<string, { tone: keyof typeof BADGE_TONES; label: string }> = {
  ACTIVE: { tone: 'green', label: 'Aktif' },
  PAUSED: { tone: 'yellow', label: 'Dijeda' },
  ARCHIVED: { tone: 'gray', label: 'Diarsipkan' },
  VERIFIED: { tone: 'green', label: 'Verified' },
  PENDING_VERIFICATION: { tone: 'yellow', label: 'Pending' },
  REJECTED: { tone: 'red', label: 'Ditolak' },
  REVOKED: { tone: 'red', label: 'Dibatalkan' },
  OBSERVED: { tone: 'blue', label: 'Observed' },
  DELIVERED: { tone: 'green', label: 'Terkirim' },
  QUEUED: { tone: 'blue', label: 'Antre' },
  FAILED: { tone: 'yellow', label: 'Gagal, dicoba lagi' },
  DEAD: { tone: 'red', label: 'Gagal permanen' },
  TEST_SKIPPED: { tone: 'gray', label: 'Test mode' },
  ACCEPTED: { tone: 'green', label: 'Diterima' },
  UPDATED: { tone: 'blue', label: 'Diperbarui' },
  DUPLICATE: { tone: 'gray', label: 'Duplikat' },
  UNKNOWN_CLICK: { tone: 'yellow', label: 'Klik tak dikenal' },
  INVALID: { tone: 'red', label: 'Tidak valid' },
  FORBIDDEN_IP: { tone: 'red', label: 'IP ditolak' },
  DISABLED: { tone: 'gray', label: 'Nonaktif' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status];
  return <Badge tone={s?.tone ?? 'gray'}>{s?.label ?? status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

export function Table({ head, children, empty, emptyText, numericFrom, numericCols }: { head: ReactNode[]; children: ReactNode; empty?: boolean; emptyText?: ReactNode; numericFrom?: number; numericCols?: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border-strong text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className={cn('sticky top-0 bg-surface px-3 py-2 font-medium whitespace-nowrap', ((numericFrom !== undefined && i >= numericFrom) || numericCols?.includes(i)) && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty && <div className="px-3 py-10 text-center text-[13px] text-muted">{emptyText ?? 'Belum ada data pada rentang ini.'}</div>}
    </div>
  );
}

export function Td({ children, className, numeric }: { children?: ReactNode; className?: string; numeric?: boolean }) {
  return <td className={cn('h-9 px-3 py-1.5 align-middle', numeric && 'text-right tabular whitespace-nowrap', className)}>{children}</td>;
}

export function Alert({ tone = 'red', children }: { tone?: 'red' | 'yellow' | 'green' | 'blue'; children: ReactNode }) {
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border-l-[3px] px-3 py-2 text-[13px]',
        tone === 'red' && 'border-danger bg-danger/8 text-text',
        tone === 'yellow' && 'border-warning bg-warning/10 text-text',
        tone === 'green' && 'border-success bg-success/8 text-text',
        tone === 'blue' && 'border-primary bg-primary-soft text-text',
      )}
    >
      {children}
    </div>
  );
}

/** Placeholder pemuatan berbentuk baris, agar layout tidak melompat. */
export function Loading({ label = 'Memuat data', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 animate-pulse rounded bg-surface-2" style={{ width: `${92 - i * 9}%` }} />
      ))}
    </div>
  );
}

/** Catatan/definisi metrik yang bisa dibuka, agar tidak memenuhi layar. */
export function Notes({ title = 'Definisi metrik', items }: { title?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="group mt-3 text-xs text-muted">
      <summary className="cursor-pointer select-none hover:text-text">{title}</summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {items.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

export function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-border-strong">
      <code className="min-w-0 flex-1 break-all whitespace-pre-wrap bg-surface-2 px-2.5 py-2 font-mono text-xs leading-relaxed">{value}</code>
      <button
        type="button"
        className="shrink-0 border-l border-border-strong bg-surface px-3 text-[12.5px] font-medium hover:bg-surface-2"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
        }}
      >
        {copied ? 'Tersalin' : 'Salin'}
      </button>
    </div>
  );
}

/** Panel samping untuk form & detail. Esc menutup. */
export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Tutup" className="absolute inset-0 bg-black/35" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-border bg-surface">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Tutup
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
