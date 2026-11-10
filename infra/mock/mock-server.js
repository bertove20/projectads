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
