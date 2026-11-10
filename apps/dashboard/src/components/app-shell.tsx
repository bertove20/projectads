'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useOrgQuery } from '@/lib/hooks';
import { SessionProvider, useSession } from '@/lib/session';
import { cn, Loading } from './ui';

interface NavItem {
  href: string;
  label: string;
  permission: string;
}

/** Navigasi sesuai role (read.md 11). Menu fase berikutnya ditambahkan saat modulnya selesai. */
const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Performa',
    items: [
      { href: '/', label: 'Overview', permission: 'analytics.read' },
      { href: '/reports', label: 'Analytics', permission: 'analytics.read' },
      { href: '/conversions', label: 'Konversi', permission: 'conversions.read' },
      { href: '/reconciliation', label: 'Rekonsiliasi', permission: 'analytics.read' },
    ],
  },
  {
    section: 'Iklan',
    items: [
      { href: '/campaigns', label: 'Campaigns', permission: 'campaigns.read' },
      { href: '/networks', label: 'Jaringan iklan', permission: 'networks.read' },
      { href: '/offers', label: 'Offers', permission: 'offers.read' },
      { href: '/affiliates', label: 'Affiliate networks', permission: 'affiliates.read' },
      { href: '/websites', label: 'Websites & landing', permission: 'websites.read' },
      { href: '/domains', label: 'Domain', permission: 'websites.read' },
    ],
  },
  {
    section: 'Tracking',
    items: [
      { href: '/postbacks', label: 'Postbacks', permission: 'postbacks.read' },
      { href: '/spend', label: 'Spend', permission: 'analytics.read' },
      { href: '/alerts', label: 'Alerts', permission: 'alerts.read' },
    ],
  },
  {
    section: 'Organisasi',
    items: [
      { href: '/team', label: 'Tim & akses', permission: 'members.read' },
      { href: '/audit', label: 'Audit log', permission: 'audit.read' },
      { href: '/settings', label: 'Pengaturan', permission: 'org.read' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, org, me, switchOrg } = useSession();
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span aria-hidden className="grid h-5 w-5 place-items-center rounded-sm bg-primary text-[11px] font-semibold text-primary-fg">E</span>
        <span className="text-[13px] font-semibold tracking-tight">EAIP</span>
      </div>
      {me.organizations.length > 1 ? (
        <div className="border-b border-border p-3">
          <label className="sr-only" htmlFor="org-switch">
            Organisasi
          </label>
          <select
            id="org-switch"
            className="h-8 w-full cursor-pointer rounded-md border border-border bg-surface-2 px-2 text-[13px] font-medium"
            value={org.id}
            onChange={(e) => switchOrg(e.target.value)}
          >
            {me.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="border-b border-border px-4 py-3 text-[13px] font-medium">{org.name}</div>
      )}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Navigasi utama">
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(i.permission));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <p className="mb-1 px-2 text-xs text-muted">{group.section}</p>
              <ul>
                {items.map((i) => {
                  const active = isActive(pathname, i.href);
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative flex h-8 items-center rounded-md px-2 text-[13px] transition-colors',
                          active ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-surface-2',
                        )}
                      >
                        {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-primary" />}
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

/** Jumlah alert terbuka; diperbarui tiap menit. */
function AlertIndicator() {
  const { can } = useSession();
  const summary = useOrgQuery<{ open: number; bySeverity: Record<string, number> }>(can('alerts.read') ? '/alerts/summary' : null, { refetchInterval: 60_000 });
  if (!summary.data) return null;
  const urgent = (summary.data.bySeverity.HIGH ?? 0) + (summary.data.bySeverity.CRITICAL ?? 0);
  const open = summary.data.open;
  return (
    <Link
      href="/alerts"
      className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
      aria-label={`${open} alert terbuka`}
    >
      <span aria-hidden className={cn('h-2 w-2 rounded-full', open === 0 ? 'bg-border-strong' : urgent ? 'bg-danger' : 'bg-warning')} />
      Alert
      {open > 0 && <span className={cn('tabular font-semibold', urgent ? 'text-danger' : 'text-warning')}>{open}</span>}
    </Link>
  );
}

function UserMenu() {
  const { me, org } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  async function logout() {
    await api('/auth/logout', { method: 'POST', org: false }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }
  const initials = me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 items-center gap-2 rounded-md pr-2 pl-1 hover:bg-surface-2"
      >
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted ring-1 ring-border-strong">
          {initials}
        </span>
        <span className="hidden max-w-40 truncate text-[13px] sm:block">{me.name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-60 rounded-lg border border-border bg-surface p-1 shadow-lg shadow-black/5">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-[13px] font-medium">{me.name}</p>
            <p className="truncate text-xs text-muted">{me.email}</p>
            <p className="mt-1 text-xs text-muted">{org.role.name}</p>
          </div>
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="block rounded-md px-3 py-1.5 text-[13px] hover:bg-surface-2">
            Pengaturan akun
          </Link>
          <button role="menuitem" type="button" onClick={logout} className="block w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-surface-2">
            Keluar
          </button>
        </div>
      )}
    </div>
  );
}

const COLLAPSE_KEY = 'eaip.sidebar';

function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* penyimpanan tidak tersedia */
    }
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* abaikan */
    }
  };

  return (
    <div className="flex min-h-screen">
      <aside className={cn('sticky top-0 hidden h-screen w-56 shrink-0 border-r border-border bg-surface lg:block', collapsed && 'lg:hidden')}>
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Tutup menu" className="absolute inset-0 bg-black/35" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64 border-r border-border bg-surface">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur-sm lg:px-5">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Buka menu"
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            className="hidden h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text lg:grid"
            onClick={toggle}
            aria-label={collapsed ? 'Tampilkan sidebar' : 'Sembunyikan sidebar'}
            aria-pressed={collapsed}
          >
            <SidebarIcon />
          </button>
          <div className="ml-auto flex items-center gap-1">
            <AlertIndicator />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-5 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3v10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <FullscreenLoading />;
}

function FullscreenLoading() {
  return (
    <div className="mx-auto max-w-md px-4 pt-24">
      <Loading rows={3} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={(state) => {
        if (state === 'login') return <Redirect to="/login" />;
        if (state === 'mfa') return <Redirect to="/mfa" />;
        if (state === 'no-org') return <p className="p-8 text-center text-[13px] text-muted">Akun Anda belum tergabung di organisasi mana pun. Hubungi administrator.</p>;
        return <FullscreenLoading />;
      }}
    >
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

/** Pembatas akses di dalam halaman (UI saja; otorisasi sebenarnya tetap di server). */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useSession();
  if (!can(permission)) return <p className="py-16 text-center text-[13px] text-muted">Anda tidak memiliki akses ke halaman ini.</p>;
  return <>{children}</>;
}
