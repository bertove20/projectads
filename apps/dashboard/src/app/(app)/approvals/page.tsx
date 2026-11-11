'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { ProposalCard } from '@/components/team';
import { Alert, cn, Loading, PageHeader } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useOrgQuery } from '@/lib/hooks';
import { Proposal } from '@/lib/team';

const TABS = [
  { key: 'PENDING_OWNER', label: 'Menunggu Anda' },
  { key: 'EXECUTED,APPROVED,FAILED', label: 'Disetujui' },
  { key: 'REJECTED,REVISION', label: 'Ditolak / revisi' },
  { key: 'SUPERVISOR_REJECTED,DRAFT', label: 'Disaring Kepala Tim' },
] as const;

function ApprovalsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('PENDING_OWNER');
  const q = useOrgQuery<Proposal[]>(`/ai/approvals?status=${tab}`, { refetchInterval: tab === 'PENDING_OWNER' ? 15_000 : undefined });
  return (
    <>
      <PageHeader
        title="Approval Center"
        description="Usulan karyawan AI yang sudah dinilai dan diteruskan Kepala Tim AI. Setiap usulan memuat alasan, bukti data, tanggapan rekan, dan pratinjau perubahan. Server hanya menjalankan yang Anda setujui."
        actions={
          <Link href="/ai/team" className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-[13px] font-medium hover:bg-surface-2">
            Tim AI
          </Link>
        }
      />
      <div role="tablist" aria-label="Status usulan" className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-[13px]', tab === t.key ? 'border-primary font-medium text-text' : 'border-transparent text-muted hover:text-text')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {q.isLoading && <Loading />}
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {q.data && q.data.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-[13px] text-muted">
          {tab === 'PENDING_OWNER' ? 'Tidak ada usulan yang menunggu keputusan Anda.' : 'Belum ada usulan di kategori ini.'}
        </p>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {q.data?.map((p) => (
          <ProposalCard key={p.id} p={p} runId={p.runId} showRun />
        ))}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <RequirePermission permission="ai.supervise">
      <ApprovalsPage />
    </RequirePermission>
  );
}
