import { goalMet, goalRange, localDayStart, meetingDue, parseDiscussion, parsePlan, parseReport, parseSummary } from './team-core';

const CID = '11111111-2222-4333-8444-555555555555';
const known = new Set(['E1', 'E2']);
const ctxFor = (self: 'MEDIA_BUYER' | 'FRAUD_ANALYST' | 'TRACKING_SPECIALIST', allowed: ('CREATE_TASK' | 'CAMPAIGN_STATUS' | 'ZONE_LIST')[]) => ({
  allowed,
  known,
  positions: ['MEDIA_BUYER', 'FRAUD_ANALYST', 'TRACKING_SPECIALIST'] as never[],
  self,
});

describe('parseReport (rule jabatan & bukti wajib)', () => {
  it('menerima usulan valid dengan bukti dan parameter lengkap', () => {
    const r = parseReport(
      { summary: 'ok', findings: [{ text: 'CR turun', evidence: ['e1'] }], proposals: [{ action: 'CAMPAIGN_STATUS', title: 'Pause X', reason: 'ROI -40% 7 hari', evidence: ['E2'], campaignId: CID, status: 'PAUSED' }] },
      ctxFor('MEDIA_BUYER', ['CREATE_TASK', 'CAMPAIGN_STATUS', 'ZONE_LIST']),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence).toEqual(['E1']);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].payload).toEqual({ status: 'PAUSED' });
    expect(r.violations).toHaveLength(0);
  });

  it('menolak usulan di luar wewenang jabatan', () => {
    const r = parseReport({ summary: 's', findings: [], proposals: [{ action: 'CAMPAIGN_STATUS', title: 'Pause', reason: 'alasan panjang', evidence: ['E1'], campaignId: CID, status: 'PAUSED' }] }, ctxFor('TRACKING_SPECIALIST', ['CREATE_TASK']));
    expect(r.proposals).toHaveLength(0);
    expect(r.violations[0].reason).toMatch(/wewenang/);
  });

  it('menolak usulan dan temuan tanpa bukti yang benar-benar ada di sesi', () => {
    const r = parseReport(
      { summary: 's', findings: [{ text: 'karangan', evidence: ['E99'] }], proposals: [{ action: 'CREATE_TASK', title: 'Cek', reason: 'alasan panjang', evidence: ['E99'] }] },
      ctxFor('TRACKING_SPECIALIST', ['CREATE_TASK']),
    );
    expect(r.findings).toHaveLength(0);
    expect(r.proposals).toHaveLength(0);
    expect(r.violations[0].reason).toMatch(/bukti/);
  });

  it('Fraud Agent hanya boleh blacklist zone', () => {
    const r = parseReport({ summary: 's', findings: [], proposals: [{ action: 'ZONE_LIST', title: 'Izinkan zone', reason: 'alasan panjang', evidence: ['E1'], campaignId: CID, zoneId: '555', listType: 'WHITELIST' }] }, ctxFor('FRAUD_ANALYST', ['CREATE_TASK', 'ZONE_LIST']));
    expect(r.proposals).toHaveLength(0);
    expect(r.violations[0].reason).toMatch(/blokir/);
  });

  it('membuang pertanyaan ke diri sendiri / jabatan tak dikenal', () => {
    const r = parseReport({ summary: 's', findings: [], questions: [{ to: 'MEDIA_BUYER', question: 'q' }, { to: 'CEO', question: 'q' }, { to: 'FRAUD_ANALYST', question: 'ada bot?' }] }, ctxFor('MEDIA_BUYER', ['CREATE_TASK']));
    expect(r.questions).toEqual([{ to: 'FRAUD_ANALYST', question: 'ada bot?' }]);
  });
});

describe('parseDiscussion / parsePlan / parseSummary', () => {
  it('hanya menerima rujukan pertanyaan & usulan yang ada', () => {
    const d = parseDiscussion({ answers: [{ questionRef: 'q1', text: 'ya' }, { questionRef: 'Q9', text: 'x' }], reviews: [{ proposalRef: 'P1', stance: 'OBJECT', text: 'data lemah', evidence: ['E2', 'E7'] }] }, known, new Set(['Q1']), new Set(['P1']));
    expect(d.answers).toHaveLength(1);
    expect(d.reviews[0].evidence).toEqual(['E2']);
  });

  it('rencana: jabatan unik dan tersedia saja', () => {
    const p = parsePlan({ understanding: 'u', assignments: [{ position: 'MEDIA_BUYER', instruction: 'a' }, { position: 'MEDIA_BUYER', instruction: 'b' }, { position: 'CEO', instruction: 'c' }] }, ['MEDIA_BUYER', 'FRAUD_ANALYST']);
    expect(p.assignments).toEqual([{ position: 'MEDIA_BUYER', instruction: 'a' }]);
  });

  it('rangkuman: keputusan pertama per usulan, campaign/goal harus dikenal', () => {
    const s = parseSummary(
      { summary: 'x', decisions: [{ proposalRef: 'p1', decision: 'FORWARD', note: 'layak' }, { proposalRef: 'P1', decision: 'REJECT', note: 'dobel' }, { proposalRef: 'P5', decision: 'FORWARD', note: '' }], campaignEvaluations: [{ campaignId: CID, verdict: 'PAUSE', note: 'rugi' }, { campaignId: 'lain', verdict: 'KEEP', note: '' }] },
      { proposalRefs: new Set(['P1']), campaignIds: new Set([CID]), goalIds: new Set(), known },
    );
    expect([...s.decisions.entries()]).toEqual([['P1', { decision: 'FORWARD', note: 'layak' }]]);
    expect(s.campaignEvaluations).toHaveLength(1);
  });
});

describe('goal & jadwal', () => {
  it('arah goal: CPA/SPEND lebih kecil lebih baik', () => {
    expect(goalMet('PROFIT', 120, 100)).toBe(true);
    expect(goalMet('CPA', 1.2, 1)).toBe(false);
    expect(goalMet('SPEND', 80, 100)).toBe(true);
    expect(goalMet('ROI', null, 0.2)).toBeNull();
  });

  it('rentang periode goal', () => {
    expect(goalRange('DAILY', '2026-11-11')).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(goalRange('WEEKLY', '2026-11-11')).toEqual({ from: '2026-11-04', to: '2026-11-10' });
    expect(goalRange('MONTHLY', '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-11' });
  });

  it('awal hari lokal sesuai zona waktu', () => {
    expect(localDayStart('2026-11-11', 'Asia/Jakarta').toISOString()).toBe('2026-11-10T17:00:00.000Z');
    expect(localDayStart('2026-11-11', 'UTC').toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(localDayStart('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });

  it('rapat jatuh tempo sekali per hari setelah jamnya', () => {
    expect(meetingDue('09:00', '08:59', false)).toBe(false);
    expect(meetingDue('09:00', '09:00', false)).toBe(true);
    expect(meetingDue('09:00', '15:30', true)).toBe(false);
  });
});
