import { BadRequestException } from '@nestjs/common';
import { CLICK_FIELDS, INBOUND_FIELDS, mapInboundStatus, normalizeMapping, readMapping } from './mapping';
import { buildPostbackUrl, evaluateAcceptance } from './outbound';

describe('mapInboundStatus', () => {
  it.each([
    [undefined, 'VERIFIED'],
    ['', 'VERIFIED'],
    ['approved', 'VERIFIED'],
    ['1', 'VERIFIED'],
    ['pending', 'PENDING_VERIFICATION'],
    ['rejected', 'REJECTED'],
    ['declined', 'REJECTED'],
    ['chargeback', 'REVOKED'],
    ['reversed', 'REVOKED'],
  ])('%s → %s', (raw, expected) => {
    expect(mapInboundStatus(raw)).toBe(expected);
  });

  it('status tak dikenal → null (ditolak, bukan dianggap approved)', () => {
    expect(mapInboundStatus('weird-status')).toBeNull();
  });
});

describe('param mapping', () => {
  it('menggabungkan mapping kustom dengan default', () => {
    const m = normalizeMapping({ externalClickId: 'clickid' }, CLICK_FIELDS);
    expect(m.externalClickId).toBe('clickid');
    expect(m.zoneId).toBe('zone_id');
  });

  it('menolak field tak dikenal', () => {
    expect(() => normalizeMapping({ hacker: 'x' }, CLICK_FIELDS)).toThrow(BadRequestException);
  });

  it('menolak nama parameter berbahaya', () => {
    expect(() => normalizeMapping({ clickId: 'a b&c' }, INBOUND_FIELDS)).toThrow(BadRequestException);
  });

  it('readMapping mengabaikan data tersimpan yang rusak', () => {
    expect(readMapping({ clickId: 123, payout: 'amount' }, INBOUND_FIELDS)).toMatchObject({ clickId: 'click_id', payout: 'amount' });
    expect(readMapping(null, INBOUND_FIELDS)).toEqual(INBOUND_FIELDS);
  });
});

describe('outbound postback', () => {
  const values = {
    externalClickId: 'abc 123&x=1',
    payout: '1.5',
    currency: 'USD',
    goal: 'default',
    transactionId: null,
    conversionId: 'conv-1',
    clickId: 'click-1',
  };

  it('mengisi placeholder dan meng-encode nilai (mencegah injeksi parameter)', () => {
    const url = buildPostbackUrl('https://trk.example.com/conv?cid={external_click_id}&p={payout}&tx={transaction_id}', values);
    expect(url).toBe('https://trk.example.com/conv?cid=abc%20123%26x%3D1&p=1.5&tx=');
  });

  it('HTTP 200 tanpa pola → penerimaan tidak dapat ditentukan (null)', () => {
    expect(evaluateAcceptance(200, 'whatever', null)).toBeNull();
  });

  it('HTTP 200 dengan pola cocok / tidak cocok', () => {
    expect(evaluateAcceptance(200, '{"status":"ok"}', '"status":"ok"')).toBe(true);
    expect(evaluateAcceptance(200, '{"status":"duplicate"}', '"status":"ok"')).toBe(false);
  });

  it('HTTP non-2xx selalu ditolak', () => {
    expect(evaluateAcceptance(500, 'ok', 'ok')).toBe(false);
  });
});
