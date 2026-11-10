/**
 * Mock server untuk pengujian LOKAL (compose.local.yaml). Tidak dipakai di VPS.
 *  - /conversion…        : penerima postback keluar (meniru jaringan iklan)
 *  - /v2/…               : meniru RollerAds API v2 (bentuk respons mengikuti OpenAPI resmi yang disimpan di docs/)
 *  - /telegram/bot…/…    : meniru Telegram Bot API sendMessage
 *  - /_received          : daftar request yang diterima (untuk assertion test)
 */
const http = require('http');

const VALID_TOKEN = 'test-roller-token';
const received = [];
let statsRequests = 0;

// Data statistik deterministik per hari: campaign 9001 (dipetakan oleh test) dan 9999 (tidak dipetakan)
const STAT_ROWS = [
  { campaign_id: 9001, campaign_title: 'Mock Push ID', zone_id: 5551, country_iso2: 'ID', cnt_impression: 900, cnt_click: 12, cnt_conversion: 1, amt_imoney: 0.6 },
  { campaign_id: 9001, campaign_title: 'Mock Push ID', zone_id: 5552, country_iso2: 'ID', cnt_impression: 8000, cnt_click: 240, cnt_conversion: 0, amt_imoney: 9.5 },
  { campaign_id: 9001, campaign_title: 'Mock Push ID', zone_id: 5553, country_iso2: 'MY', cnt_impression: 300, cnt_click: 5, cnt_conversion: 0, amt_imoney: 0.25 },
  { campaign_id: 9999, campaign_title: 'Belum dipetakan', zone_id: 7777, country_iso2: 'TH', cnt_impression: 100, cnt_click: 3, cnt_conversion: 0, amt_imoney: 0.1 },
];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    if (url.pathname === '/_received') return json(res, 200, { received, statsRequests });

    if (url.pathname.startsWith('/v2/')) {
      if (req.headers['x-access-token'] !== VALID_TOKEN) return json(res, 401, { error: { code: 401, message: 'Unauthorized' } });
      received.push({ at: new Date().toISOString(), kind: 'rollerads', url: req.url });
      if (url.pathname === '/v2/whoami') {
        return json(res, 200, {
          is_logged_in: true,
          account: { account_id: 424242, account_title: 'Mock Advertiser', account_currency: 'USD', account_timezone: 'Asia/Jakarta', is_api_enabled: 1 },
        });
      }
      if (url.pathname === '/v2/campaigns/list') {
        return json(res, 200, [
          { campaign_id: 9001, campaign_title: 'Mock Push ID', campaign_status: 'active', format_id: 1, bid_model_id: 7, account_id: 424242 },
          { campaign_id: 9999, campaign_title: 'Belum dipetakan', campaign_status: 'paused', format_id: 2, bid_model_id: 5, account_id: 424242 },
        ]);
      }
      if (url.pathname === '/v2/statistics/adv') {
        statsRequests++;
        const ts = url.searchParams.get('filters[ts]') || '';
        if (!/^bw\|\d{4}-\d{2}-\d{2} 00:00:00;\d{4}-\d{2}-\d{2} 23:59:59$/.test(ts)) return json(res, 400, { error: { message: 'bad ts filter' } });
        const page = Number(url.searchParams.get('page') || 1);
        const rows = page === 1 ? STAT_ROWS.map((r) => ({ ...r, ts_title: ts.slice(3, 13) })) : [];
        return json(res, 200, { group: url.searchParams.get('group'), rows, summary: [], page: { current: page, limit: 1000, max: 1 }, rows_count: rows.length });
      }
      return json(res, 404, { error: { message: 'not mocked' } });
    }

    // ── Meniru Propeller SSP API v5 (docs/providers/propellerads/ssp-api-v5-2026-11-12) ──
    if (url.pathname.startsWith('/propeller/v5/')) {
      if (req.headers.authorization !== 'Bearer test-propeller-token') return json(res, 401, { message: 'Unauthorized' });
      const p = url.pathname.slice('/propeller/v5'.length);
      received.push({ at: new Date().toISOString(), kind: 'propeller', url: req.url });
      if (p === '/adv/balance') return json(res, 200, '123.45');
      if (p === '/adv/campaigns') {
        return json(res, 200, {
          result: [
            { id: 7001, direction_id: 2, name: 'Mock OnClick TH', rate_model: 'scpm', status: 6, is_archived: 0, limit_daily_amount: null, limit_total_amount: null },
            { id: 7099, direction_id: 61, name: 'Belum dipetakan', rate_model: 'cpag', status: 7, is_archived: 0, limit_daily_amount: 10, limit_total_amount: 100 },
          ],
          meta: { total_items: 2, total_pages: 1, page_size: 1000, page: 1 },
        });
      }
      if (p === '/adv/statistics') {
        statsRequests++;
        const groups = url.searchParams.getAll('group_by[]');
        const okDate = (v) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v || '');
        if (!groups.includes('campaign_id') || !groups.includes('zone_id') || url.searchParams.get('tz') !== '+0000' || !okDate(url.searchParams.get('day_from')) || !okDate(url.searchParams.get('day_to'))) {
          return json(res, 422, { message: 'bad statistics params', groups, tz: url.searchParams.get('tz') });
        }
        const items = [
          { campaign_id: 7001, zone_id: 880001, impressions: 5000, clicks: 300, conversions: 2, spent: '4.20' },
          { campaign_id: 7001, zone_id: 880002, impressions: 900, clicks: 20, conversions: 0, spent: '0.80' },
          { campaign_id: 7099, zone_id: 880003, impressions: 100, clicks: 4, conversions: 0, spent: '0.05' },
        ];
        return json(res, 200, [{ items, totals: {}, per_page: 5000, total_pages: 1, total_items: items.length }]);
      }
      return json(res, 404, { message: 'not mocked' });
    }

    if (url.pathname.startsWith('/telegram/bot')) {
      const body = await readBody(req);
      const token = url.pathname.split('/')[2].slice(3);
      if (!token.startsWith('123456:')) return json(res, 401, { ok: false, description: 'Unauthorized' });
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      received.push({ at: new Date().toISOString(), kind: 'telegram', chat_id: parsed.chat_id, text: parsed.text });
      return json(res, 200, { ok: true, result: { message_id: received.length } });
    }

    received.push({ at: new Date().toISOString(), kind: 'postback', url: req.url });
    json(res, 200, { status: 'ok' });
  })
  .listen(4900, () => console.log('mock server on 4900'));
