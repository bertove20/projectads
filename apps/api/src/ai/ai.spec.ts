import { budgetViolation, estimateCost, parseSkillMd, pick, sanitizeText, titleFrom, toolPayload } from './ai-core';
import { modelRow } from './ai-admin.controller';
import { BUILTIN_SKILLS } from './builtin-skills';
import { OpenRouterError } from './openrouter.client';

const limits = { dailyBudgetUsd: 1, monthlyBudgetUsd: 10, orgMonthlyBudgetUsd: 100, maxRequestsPerDay: 50 };
const spent = { today: 0, month: 0, orgMonth: 0, requestsToday: 0 };

describe('budget', () => {
  it('estimasi biaya = prompt × harga + output × harga', () => expect(estimateCost(1000, 500, 0.000001, 0.000002)).toBeCloseTo(0.002));
  it('lolos bila di bawah batas', () => expect(budgetViolation(limits, spent, 0.5)).toBeNull());
  it('harian', () => expect(budgetViolation(limits, { ...spent, today: 0.9 }, 0.2)).toMatch(/harian/));
  it('bulanan', () => expect(budgetViolation(limits, { ...spent, month: 9.9 }, 0.2)).toMatch(/bulanan \(/));
  it('organisasi', () => expect(budgetViolation(limits, { ...spent, orgMonth: 99.9 }, 0.2)).toMatch(/organisasi/));
  it('batas request', () => expect(budgetViolation(limits, { ...spent, requestsToday: 50 }, 0)).toMatch(/request/));
  it('null = tanpa batas', () => expect(budgetViolation({ dailyBudgetUsd: null, monthlyBudgetUsd: null, orgMonthlyBudgetUsd: null, maxRequestsPerDay: null }, { ...spent, today: 1e6 }, 1e6)).toBeNull());
  it('pick: override karyawan menang, 0 tetap dihormati', () => {
    expect(pick(0, 5)).toBe(0);
    expect(pick(null, undefined, 3)).toBe(3);
  });
});

describe('parseSkillMd', () => {
  it('semua skill bawaan valid', () => {
    for (const s of BUILTIN_SKILLS) {
      const r = parseSkillMd(s.skillMd);
      expect('error' in r ? r.error : r.name).toBe(s.key);
    }
  });
  it('tanpa frontmatter ditolak', () => expect(parseSkillMd('# halo\nisi panjang sekali untuk skill')).toHaveProperty('error'));
  it('name tidak valid ditolak', () => expect(parseSkillMd('---\nname: Bad Name\ndescription: deskripsi cukup panjang\n---\nisi instruksi yang cukup panjang')).toHaveProperty('error'));
  it('terlalu besar ditolak', () => expect(parseSkillMd('x'.repeat(20_001))).toHaveProperty('error'));
});

describe('sanitasi & payload', () => {
  it('membuang karakter kontrol & bidi override', () => expect(sanitizeText('a\u0000b‮c\nd')).toBe('abc\nd'));
  it('payload besar dipotong tapi tetap JSON valid', () => {
    const p = toolPayload({ rows: 'x'.repeat(50_000) }, 1000);
    expect(JSON.parse(p).truncated).toBe(true);
  });
  it('judul percakapan', () => expect(titleFrom('  Bagaimana performa campaign minggu ini dibanding minggu lalu dan apa yang harus dilakukan?  ')).toHaveLength(58));
});

describe('model registry & error', () => {
  it('harga per token dari string, tools dari supported_parameters', () => {
    const r = modelRow({ id: 'v/m', name: 'M', context_length: 8000, pricing: { prompt: '0.000001', completion: 'abc' }, supported_parameters: ['tools', 'temperature'], top_provider: { max_completion_tokens: 4096 } });
    expect(r).toMatchObject({ promptPrice: 0.000001, completionPrice: 0, supportsTools: true, maxCompletionTokens: 4096, contextLength: 8000 });
  });
  it('fallback hanya untuk error yang layak dicoba ulang', () => {
    expect(new OpenRouterError(503, 'x').retryable).toBe(true);
    expect(new OpenRouterError(429, 'x').retryable).toBe(true);
    expect(new OpenRouterError(400, 'x').retryable).toBe(false);
    expect(new OpenRouterError(401, 'x').isAuthError).toBe(true);
  });
});
