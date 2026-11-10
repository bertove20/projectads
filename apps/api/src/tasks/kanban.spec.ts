import { checkEnterColumn, createsCycle, evenRanks, parseMentions, rankAt, RANK_STEP } from './kanban';

const base = {
  targetKind: 'IN_PROGRESS' as const,
  sameColumn: false,
  completionEvidence: null,
  approvalRequired: false,
  canApprove: false,
  openDependencies: 0,
  targetCount: 0,
  wipLimit: null,
};

describe('rankAt', () => {
  it('kolom kosong → RANK_STEP', () => expect(rankAt([], 0)).toBe(RANK_STEP));
  it('awal, tengah, akhir', () => {
    expect(rankAt([1024, 2048], 0)).toBe(0);
    expect(rankAt([1024, 2048], 1)).toBe(1536);
    expect(rankAt([1024, 2048], 2)).toBe(3072);
    expect(rankAt([1024, 2048], 99)).toBe(3072);
  });
  it('celah terlalu sempit → null (perlu pemadatan)', () => expect(rankAt([1, 1 + 1e-7], 1)).toBeNull());
  it('evenRanks', () => expect(evenRanks(3)).toEqual([1024, 2048, 3072]));
});

describe('createsCycle', () => {
  const edges: [string, string][] = [['a', 'b'], ['b', 'c']];
  it('diri sendiri', () => expect(createsCycle(edges, 'a', 'a')).toBe(true));
  it('c → a membentuk siklus', () => expect(createsCycle(edges, 'c', 'a')).toBe(true));
  it('a → c aman', () => expect(createsCycle(edges, 'a', 'c')).toBe(false));
  it('d → a aman', () => expect(createsCycle(edges, 'd', 'a')).toBe(false));
});

describe('checkEnterColumn', () => {
  it('WIP limit', () => expect(checkEnterColumn({ ...base, wipLimit: 2, targetCount: 2 })?.code).toBe('WIP_LIMIT'));
  it('WIP tidak berlaku untuk urut ulang di kolom yang sama', () =>
    expect(checkEnterColumn({ ...base, wipLimit: 2, targetCount: 2, sameColumn: true })).toBeNull());
  it('Done butuh bukti', () => expect(checkEnterColumn({ ...base, targetKind: 'DONE', completionEvidence: '  ' })?.code).toBe('EVIDENCE_REQUIRED'));
  it('Done terblokir dependensi', () =>
    expect(checkEnterColumn({ ...base, targetKind: 'DONE', completionEvidence: 'ok', openDependencies: 1 })?.code).toBe('DEPENDENCY_OPEN'));
  it('Done butuh approval', () => {
    const c = { ...base, targetKind: 'DONE' as const, completionEvidence: 'ok', approvalRequired: true };
    expect(checkEnterColumn(c)?.code).toBe('APPROVAL_REQUIRED');
    expect(checkEnterColumn({ ...c, canApprove: true })).toBeNull();
  });
});

describe('parseMentions', () => {
  it('mengambil uuid unik, huruf kecil', () => {
    const id = '0b7c2c4e-3f7a-4d1e-9a51-1f0e8c7d6b5a';
    expect(parseMentions(`hai @[Budi](${id.toUpperCase()}) dan @[Budi](${id}) @bukan`)).toEqual([id]);
  });
});
