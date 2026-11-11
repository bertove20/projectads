/**
 * Mock server untuk pengujian LOKAL (compose.local.yaml). Tidak dipakai di VPS.
 *  - /conversion…        : penerima postback keluar (meniru jaringan iklan)
 *  - /v2/…               : meniru RollerAds API v2 (bentuk respons mengikuti OpenAPI resmi yang disimpan di docs/)
 *  - /telegram/bot…/…    : meniru Telegram Bot API sendMessage
 *  - /openrouter/api/v1/… : meniru OpenRouter (models & chat completions, format sesuai docs/providers/openrouter)
 *  - /_received          : daftar request yang diterima (untuk assertion test)
 */
const http = require('http');

const VALID_TOKEN = 'test-roller-token';
const received = [];
/** Antrean update Telegram per token (diisi test lewat POST /_telegram/updates). */
const tgUpdates = {};
let tgUpdateId = 1000;
let statsRequests = 0;

const OR_KEY = 'sk-or-v1-mock-valid-key-000000000000';
const orModel = (id, name, tools, prompt, completion) => ({ id, name, context_length: 128000, pricing: { prompt, completion }, top_provider: { max_completion_tokens: 4096 }, supported_parameters: tools ? ['tools', 'temperature', 'max_tokens'] : ['temperature'] });
const OR_MODELS = [
  orModel('mock/fast-tools', 'Mock Fast (tools)', true, '0.000001', '0.000002'),
  orModel('mock/broken', 'Mock Broken', true, '0.000001', '0.000002'),
  orModel('mock/no-tools', 'Mock Text Only', false, '0.0000005', '0.000001'),
];

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
    if (url.pathname === '/_telegram/updates' && req.method === 'POST') {
      // { token, chatId, chatType, fromId, username, text } → update untuk getUpdates
      const b = JSON.parse((await readBody(req)) || '{}');
      const id = ++tgUpdateId;
      const from = { id: b.fromId, is_bot: false, username: b.username, first_name: b.username };
      const chat = { id: Number(b.chatId), type: b.chatType ?? 'supergroup' };
      (tgUpdates[b.token] ??= []).push(
        b.callbackData
          ? { update_id: id, callback_query: { id: 'cb' + id, from, chat_instance: 'ci', message: { message_id: b.messageId ?? id, chat }, data: b.callbackData } }
          : { update_id: id, message: { message_id: id, from, chat, text: b.text } },
      );
      return json(res, 200, { ok: true, update_id: id });
    }
    if (url.pathname.startsWith('/discord/api/v10/')) {
      const p = url.pathname.slice('/discord/api/v10'.length);
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      received.push({ at: new Date().toISOString(), kind: 'discord', method: req.method, path: p.replace(/\/webhooks\/(\d+)\/[^/]+/, '/webhooks/$1/[token]'), auth: req.headers.authorization ? 'present' : 'none', body: parsed });
      if (/^\/webhooks\/\d+\/[\w-]+$/.test(p) && req.method === 'POST') { res.writeHead(204); return res.end(); }
      if (/^\/applications\/\d+\/guilds\/\d+\/commands$/.test(p) && req.method === 'PUT') {
        if (req.headers.authorization !== 'Bot mock-discord-bot-token-0000000000000000000000000000000000000000000000') return json(res, 401, { message: '401: Unauthorized', code: 0 });
        return json(res, 200, (Array.isArray(parsed) ? parsed : []).map((c, i) => ({ id: String(900 + i), ...c })));
      }
      return json(res, 404, { message: 'Unknown', code: 0 });
    }

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

    if (url.pathname.startsWith('/openrouter/api/v1/')) {
      const p = url.pathname.slice('/openrouter/api/v1'.length);
      if (req.headers.authorization !== 'Bearer ' + OR_KEY) return json(res, 401, { error: { code: 401, message: 'No auth credentials found' } });
      if (req.method === 'GET' && p === '/models') return json(res, 200, { data: OR_MODELS, total_count: OR_MODELS.length, links: { next: null } });
      if (req.method === 'POST' && p === '/chat/completions') {
        let b = {};
        try {
          b = JSON.parse(await readBody(req));
        } catch {}
        const msgs = Array.isArray(b.messages) ? b.messages : [];
        const toolNames = (b.tools ?? []).map((t) => t.function?.name);
        const last = msgs[msgs.length - 1] ?? {};
        received.push({ at: new Date().toISOString(), kind: 'openrouter', model: b.model, tools: toolNames, system: msgs[0]?.content ?? '', last: last.role === 'tool' ? '[tool]' : String(last.content ?? '').slice(0, 300), maxTokens: b.max_completion_tokens, temperature: b.temperature });
        if (b.model === 'mock/broken') return json(res, 503, { error: { code: 503, message: 'Provider returned error' } });
        const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0015 };
        const reply = (message) => json(res, 200, { id: 'gen-' + received.length, object: 'chat.completion', model: b.model, choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', ...message } }], usage });
        const call = (name, args) => reply({ content: null, tool_calls: [{ id: 'call_' + received.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
        // ── Tim AI otonom: agent menutup kerja lewat tool submit_* ──
        const submit = toolNames.find((n) => /^submit_/.test(n));
        if (submit) {
          const all = msgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
          const toolMsgs = msgs.filter((m) => m.role === 'tool').map((m) => String(m.content));
          const evid = [...new Set(toolMsgs.join('\n').match(/"evidenceId":"E\d+"/g) ?? [])].map((x) => x.slice(14, -1));
          const uuids = [...new Set(toolMsgs.join('\n').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])];
          const sys = String(msgs[0]?.content ?? '');
          const dataTool = ['list_campaigns', 'goal_progress', 'postback_health', 'list_alerts'].find((n) => toolNames.includes(n));
          // Langkah 1: ambil data dulu (menghasilkan bukti) bila belum ada hasil tool.
          if (!toolMsgs.length && dataTool) return call(dataTool, dataTool === 'postback_health' ? { days: 7 } : {});
          if (submit === 'submit_plan') {
            const enumPos = b.tools.find((t) => t.function.name === 'submit_plan').function.parameters.properties.assignments.items.properties.position.enum;
            const pick = ['MEDIA_BUYER', 'FRAUD_ANALYST'].filter((p) => enumPos.includes(p));
            return call('submit_plan', { understanding: 'Owner minta evaluasi campaign yang rugi.', assignments: pick.map((p) => ({ position: p, instruction: 'Evaluasi campaign dengan data 7 hari, usulkan tindakan.' })) });
          }
          if (submit === 'submit_report') {
            const cid = uuids[0];
            const proposals = [];
            const questions = [];
            if (sys.includes('jabatan Media Buyer')) {
              if (cid) proposals.push({ action: 'CAMPAIGN_STATUS', title: 'Pause campaign rugi', reason: 'ROI negatif 7 hari berturut-turut', evidence: evid.slice(0, 1), risk: 'MEDIUM', campaignId: cid, status: 'PAUSED' });
              proposals.push({ action: 'CREATE_TASK', title: 'Siapkan creative baru', reason: 'CTR turun 30% minggu ini', evidence: ['E999'] });
              questions.push({ to: 'FRAUD_ANALYST', question: 'Apakah ada zone dengan bot tinggi?' });
            } else if (sys.includes('jabatan Fraud Analyst')) {
              if (cid) proposals.push({ action: 'ZONE_LIST', title: 'Blokir zone 5552', reason: 'Traffic bot tinggi dan tidak ada konversi 7 hari', evidence: evid.slice(0, 1), risk: 'LOW', campaignId: cid, zoneId: '5552', listType: 'BLACKLIST' });
              proposals.push({ action: 'CREATE_TASK', title: 'Audit zone bot', reason: 'Bot rate zone 7781 mencapai 83.4% minggu ini', evidence: evid.slice(0, 1) });
            } else if (sys.includes('jabatan Tracking Specialist')) {
              proposals.push({ action: 'CAMPAIGN_STATUS', title: 'Aktifkan campaign', reason: 'tracking sudah sehat semua', evidence: evid.slice(0, 1), campaignId: cid, status: 'ACTIVE' });
              proposals.push({ action: 'CREATE_TASK', title: 'Uji ulang postback affiliate', reason: 'Ada postback keluar gagal 7 hari terakhir', evidence: evid.slice(0, 1), priority: 'HIGH' });
            }
            const memory = sys.includes('# Ingatan kerja') ? 'ingat' : 'baru';
            return call('submit_report', {
              summary: 'Laporan berbasis data ' + evid.join(',') + ' (' + memory + ')',
              findings: [{ text: 'Data diperiksa', evidence: evid.slice(0, 1) }, { text: 'Klaim tanpa bukti', evidence: ['E777'] }, { text: 'CPA naik ke $987.65', evidence: evid.slice(0, 1) }],
              lessons: sys.includes('jabatan Media Buyer') ? [{ text: 'Selalu cek daftar campaign sebelum mengusulkan pause', evidence: evid.slice(0, 1) }] : [],
              proposals,
              questions,
            });
          }
          if (submit === 'submit_discussion') {
            const q = (all.match(/Q\d+ dari/g) ?? []).map((x) => x.split(' ')[0]);
            const p = [...new Set(all.match(/- P\d+ oleh/g) ?? [])].map((x) => x.split(' ')[1]);
            return call('submit_discussion', { answers: q.map((ref) => ({ questionRef: ref, text: 'Ya, zone 5552 bot tinggi', evidence: evid.slice(0, 1) })), reviews: p.slice(0, 1).map((ref) => ({ proposalRef: ref, stance: 'SUPPORT', text: 'Setuju, data mendukung', evidence: evid.slice(0, 1) })) });
          }
          if (submit === 'submit_summary') {
            const p = [...new Set(all.match(/- P\d+ oleh/g) ?? [])].map((x) => x.split(' ')[1]);
            const cid = (all.match(/campaign ([0-9a-f-]{36})/) ?? [])[1];
            return call('submit_summary', {
              summary: '## Rangkuman\nTim menemukan campaign rugi dan zone bot. ' + p.length + ' usulan dinilai.',
              campaignEvaluations: cid ? [{ campaignId: cid, verdict: 'OPTIMIZE', note: 'ROI negatif', evidence: evid.slice(0, 1) }] : [],
              decisions: p.map((ref, i) => ({ proposalRef: ref, decision: i === p.length - 1 && p.length > 2 ? 'REJECT' : 'FORWARD', note: i === p.length - 1 && p.length > 2 ? 'Prioritas rendah' : 'Didukung data' })),
            });
          }
        }
        if (last.role === 'tool') return reply({ content: 'Ringkasan dari data: ' + String(last.content).slice(0, 400) });
        const text = String(last.content ?? '').toLowerCase();
        const today = new Date().toISOString().slice(0, 10);
        const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
        if (text.includes('draft') && toolNames.includes('propose_task')) return call('propose_task', { title: 'Turunkan bid zone 5552', description: 'Spend tinggi tanpa konversi VERIFIED', priority: 'HIGH', campaignId: (text.match(/[0-9a-f-]{36}/) ?? [])[0] });
        if (text.includes('performa') && toolNames.includes('campaign_performance')) return call('campaign_performance', { from: weekAgo, to: today, groupBy: 'campaign' });
        if (text.includes('postback') && toolNames.includes('postback_health')) return call('postback_health', { days: 7 });
        if (text.includes('rahasia')) return call('run_sql', { q: 'select * from users' });
        if (text.includes('campaign') && toolNames.includes('list_campaigns')) return call('list_campaigns', {});
        return reply({ content: 'Halo dari mock OpenRouter.' });
      }
      return json(res, 404, { error: { code: 404, message: 'Not found' } });
    }

    if (url.pathname.startsWith('/telegram/bot')) {
      const body = await readBody(req);
      const token = url.pathname.split('/')[2].slice(3);
      if (!token.startsWith('123456:')) return json(res, 401, { ok: false, description: 'Unauthorized' });
      const method = url.pathname.split('/')[3];
      if (method === 'getMe') return json(res, 200, { ok: true, result: { id: 123456, is_bot: true, first_name: 'EAIP', username: 'EaipMockBot' } });
      if (method === 'answerCallbackQuery') {
        let q = {};
        try { q = JSON.parse(body || '{}'); } catch {}
        received.push({ at: new Date().toISOString(), kind: 'telegram-answer', id: q.callback_query_id, text: q.text });
        return json(res, 200, { ok: true, result: true });
      }
      if (method === 'getUpdates') {
        let q = {};
        try { q = JSON.parse(body || '{}'); } catch {}
        const list = (tgUpdates[token] ?? []).filter((u) => q.offset == null || u.update_id >= q.offset);
        tgUpdates[token] = list; // offset mengonfirmasi update sebelumnya
        return json(res, 200, { ok: true, result: list.slice(0, 100) });
      }
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      received.push({ at: new Date().toISOString(), kind: 'telegram', chat_id: parsed.chat_id, text: parsed.text, replyTo: parsed.reply_parameters?.message_id ?? null, buttons: parsed.reply_markup?.inline_keyboard ?? null, messageId: received.length + 50000 });
      return json(res, 200, { ok: true, result: { message_id: received.length + 50000 } });
    }

    received.push({ at: new Date().toISOString(), kind: 'postback', url: req.url });
    json(res, 200, { status: 'ok' });
  })
  .listen(4900, () => console.log('mock server on 4900'));
