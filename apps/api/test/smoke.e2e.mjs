/**
 * Smoke test end-to-end terhadap stack yang sedang berjalan (compose.local.yaml).
 *   node apps/api/test/smoke.e2e.mjs
 * Variabel: API_URL (default http://127.0.0.1:4000/api/v1), TRACKER_URL (http://127.0.0.1:4100),
 *           MOCK_URL (http://127.0.0.1:4900), ADMIN_EMAIL, ADMIN_PASSWORD.
 * Tidak pernah menghubungi jaringan iklan asli: postback dikirim ke container mock-network.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticator } = require('otplib');

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const TRK = process.env.TRACKER_URL ?? 'http://127.0.0.1:4100';
const MOCK = process.env.MOCK_URL ?? 'http://127.0.0.1:4900';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Local-Test-Pass-2026!';
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const RUN = Date.now().toString(36);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor() { this.cookie = ''; this.org = null; }
  async req(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.org) headers['x-organization-id'] = this.org;
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* kosong */ }
    return { status: res.status, body: json };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
}

async function totpFresh(secret, used) {
  // Hindari kode yang sama dengan sebelumnya (proteksi replay di server)
  for (let i = 0; i < 40; i++) {
    const code = authenticator.generate(secret);
    if (!used.has(code)) { used.add(code); return code; }
    await sleep(1000);
  }
  throw new Error('tidak mendapat kode TOTP baru');
}

async function main() {
  console.log('\n[1] Health');
  const health = await fetch(`${API}/health`).then((r) => r.json());
  check('API health ok (database & redis)', health.status === 'ok', health);
  check('Tracker health ok', (await fetch(`${TRK}/healthz`)).status === 200);

  console.log('\n[2] Login & MFA wajib untuk admin');
  const admin = new Client();
  const bad = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: 'salah-password-123' });
  check('password salah ditolak 401', bad.status === 401, bad);
  const login = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('login admin 200', login.status === 200, login);
  let me = (await admin.get('/auth/me')).body;
  const orgA = me.organizations[0]?.id;
  admin.org = orgA;
  const used = new Set();
  let mfaSecret = process.env.ADMIN_MFA_SECRET;
  if (login.body?.mfaSetupRequired) {
    const blocked = await admin.get('/organizations/current');
    check('admin tanpa MFA diblokir (MFA_SETUP_REQUIRED)', blocked.status === 403 && blocked.body?.error?.code === 'MFA_SETUP_REQUIRED', blocked);
    const setup = await admin.post('/auth/mfa/setup');
    mfaSecret = setup.body.secret;
    const enable = await admin.post('/auth/mfa/enable', { code: await totpFresh(mfaSecret, used) });
    check('MFA diaktifkan', enable.status === 200, enable);
    console.log(`    (simpan untuk run berikutnya: ADMIN_MFA_SECRET=${mfaSecret})`);
  } else if (login.body?.mfaRequired) {
    if (!mfaSecret) throw new Error('Admin sudah memakai MFA; set ADMIN_MFA_SECRET');
    const blocked = await admin.get('/organizations/current');
    check('sebelum verifikasi MFA diblokir (MFA_REQUIRED)', blocked.status === 401 && blocked.body?.error?.code === 'MFA_REQUIRED', blocked);
    const v = await admin.post('/auth/mfa/verify', { code: await totpFresh(mfaSecret, used) });
    check('verifikasi MFA', v.status === 200, v);
  }
  const org = await admin.get('/organizations/current');
  check('akses organisasi setelah MFA', org.status === 200, org);

  console.log('\n[3] Setup: affiliate, offer, akun jaringan, campaign');
  const aff = await admin.post('/affiliate-networks', { name: `Affiliate ${RUN}` });
  check('affiliate network dibuat + token tampil sekali', aff.status === 201 && aff.body.postbackToken?.length >= 16, aff);
  const offerBad = await admin.post('/offers', { name: 'Tanpa click id', url: 'https://offer.example.com/x' });
  check('offer tanpa {click_id} ditolak', offerBad.status === 400, offerBad);
  const offer = await admin.post('/offers', { name: `Offer ${RUN}`, url: 'https://offer.example.com/go?sub={click_id}', affiliateNetworkId: aff.body.id, payoutAmount: '2.5', currency: 'USD' });
  check('offer dibuat', offer.status === 201, offer);
  const net = await admin.post('/network-accounts', { network: 'ROLLERADS', name: `RollerAds ${RUN}` });
  check('akun jaringan dibuat dalam test mode', net.status === 201 && net.body.testMode === true, net);
  const tplBad = await admin.put(`/network-accounts/${net.body.id}/postback-template`, { template: 'http://mock-network:4900/conv?x={unknown}' });
  check('template tanpa {external_click_id} ditolak', tplBad.status === 400, tplBad);
  const tpl = await admin.put(`/network-accounts/${net.body.id}/postback-template`, {
    template: 'http://mock-network:4900/conversion?click_id={external_click_id}&payout={payout}&run=' + RUN,
  });
  check('template postback disimpan (terenkripsi)', tpl.status === 200, tpl);
  const netList = await admin.get('/network-accounts');
  check('template tidak pernah dikembalikan ke klien', !JSON.stringify(netList.body).includes('mock-network:4900/conversion'), netList.body);
  const live = await admin.patch(`/network-accounts/${net.body.id}`, { testMode: false });
  check('test mode dimatikan (go live ke mock)', live.status === 200 && live.body.testMode === false, live);

  const camp = await admin.post('/campaigns', {
    networkAccountId: net.body.id, name: `Campaign ${RUN}`, adFormat: 'PUSH', adFormatNetwork: 'Push notifications',
    bidModel: 'CPA_GOAL_CPC', bidAmount: '0.02', targetCpa: '3', flowType: 'DIRECT', offerId: offer.body.id,
  });
  check('campaign CPA Goal dibuat (postback otomatis aktif)', camp.status === 201 && camp.body.postbackEnabled === true, camp);
  const act = await admin.patch(`/campaigns/${camp.body.id}`, { status: 'ACTIVE' });
  check('campaign diaktifkan', act.status === 200 && act.body.status === 'ACTIVE', act);
  const token = camp.body.token;

  console.log('\n[4] Klik');
  const clickRes = await fetch(`${TRK}/c/${token}?click_id=EXT-${RUN}&zone_id=5551&creative_id=77&cost=0.012`, {
    redirect: 'manual', headers: { 'user-agent': BROWSER_UA, 'accept-language': 'id-ID,id;q=0.9' },
  });
  const loc = clickRes.headers.get('location') ?? '';
  const clickId = new URL(loc).searchParams.get('sub');
  check('klik → 302 ke offer dengan click ID', clickRes.status === 302 && loc.startsWith('https://offer.example.com/go?sub=') && /^[0-9a-f-]{36}$/.test(clickId ?? ''), loc);
  check('redirect tidak di-cache & tanpa referrer', clickRes.headers.get('cache-control')?.includes('no-store') && clickRes.headers.get('referrer-policy') === 'no-referrer');
  const botRes = await fetch(`${TRK}/c/${token}?click_id=BOT-${RUN}&zone_id=5551`, { redirect: 'manual', headers: { 'user-agent': 'python-requests/2.31.0' } });
  const botLoc = botRes.headers.get('location') ?? '';
  check('bot diarahkan ke tujuan yang SAMA (tanpa cloaking)', botRes.status === 302 && botLoc.startsWith('https://offer.example.com/go?sub='), botLoc);
  const unknown = await fetch(`${TRK}/c/tidakada123`, { redirect: 'manual' });
  check('token tak dikenal → fallback', unknown.status === 302 && unknown.headers.get('location') === 'https://fallback.example.com/');

  console.log('\n[5] Postback masuk');
  const pbUrl = (p) => `${TRK}/postback/in/${aff.body.postbackToken}?${new URLSearchParams(p)}`;
  const wrong = await fetch(`${TRK}/postback/in/tokensalahtokensalah123?click_id=${clickId}`);
  check('token salah → 404', wrong.status === 404);
  const pb1 = await fetch(pbUrl({ click_id: clickId, payout: '2.5', txid: `T-${RUN}`, status: 'approved' })).then((r) => r.json());
  check('postback valid → accepted', pb1.status === 'accepted', pb1);
  const pb2 = await fetch(pbUrl({ click_id: clickId, payout: '2.5', txid: `T-${RUN}`, status: 'approved' })).then((r) => r.json());
  check('postback duplikat → duplicate (tidak jadi konversi kedua)', pb2.status === 'duplicate', pb2);
  const pbUnknown = await fetch(pbUrl({ click_id: '0190a000-0000-7000-8000-000000000000', txid: `X-${RUN}` })).then((r) => r.json());
  check('click_id tak dikenal → unknown_click', pbUnknown.status === 'unknown_click', pbUnknown);
  const pbBadStatus = await fetch(pbUrl({ click_id: clickId, txid: `Y-${RUN}`, status: 'aneh' })).then((r) => r.json());
  check('status tak dikenal → invalid (tidak dianggap approved)', pbBadStatus.status === 'invalid', pbBadStatus);

  console.log('\n[6] Postback keluar via worker → mock network');
  let delivered = null;
  for (let i = 0; i < 30 && !delivered; i++) {
    await sleep(1000);
    const got = (await fetch(`${MOCK}/_received`).then((r) => r.json())).received;
    delivered = got.find((g) => g.kind === 'postback' && g.url.includes(`run=${RUN}`));
  }
  check('mock network menerima postback dengan click ID jaringan', !!delivered && delivered.url.includes(`click_id=EXT-${RUN}`) && delivered.url.includes('payout=2.5'), delivered);
  const dels = await admin.get('/postbacks/deliveries');
  const mine = dels.body.find((d) => d.conversion.campaignId === camp.body.id);
  check('status delivery DELIVERED, hanya 1 kali', mine?.status === 'DELIVERED' && dels.body.filter((d) => d.conversion.campaignId === camp.body.id).length === 1, mine);

  console.log('\n[7] Laporan ROI');
  await admin.post('/spend', { campaignId: camp.body.id, date: new Date().toISOString().slice(0, 10), amount: '1.00' });
  const from = new Date(Date.now() - 86400_000).toISOString();
  const to = new Date(Date.now() + 86400_000).toISOString();
  const rep = await admin.get(`/analytics/report?groupBy=campaign&campaignId=${camp.body.id}&from=${from}&to=${to}`);
  const row = rep.body?.rows?.[0];
  check('klik non-bot = 1, bot = 1', row?.clicks === 1 && row?.botClicks === 1, row);
  check('konversi = 1, revenue = 2.5', row?.conversions === 1 && row?.revenue === 2.5, row);
  check('spend dilaporkan = 1, ROI = 150%', row?.spend === 1 && row?.spendSource === 'reported' && Math.abs(row.roi - 1.5) < 1e-9, row);
  const zones = await admin.get(`/analytics/report?groupBy=zone&campaignId=${camp.body.id}&from=${from}&to=${to}`);
  check('laporan per zone memuat zone 5551', zones.body?.rows?.some((r) => r.key === '5551'), zones.body);

  console.log('\n[8] Chargeback');
  const rev = await fetch(pbUrl({ click_id: clickId, payout: '2.5', txid: `T-${RUN}`, status: 'reversed' })).then((r) => r.json());
  check('reversal → updated', rev.status === 'updated', rev);
  const rep2 = await admin.get(`/analytics/report?groupBy=campaign&campaignId=${camp.body.id}&from=${from}&to=${to}`);
  check('revenue kembali 0 setelah chargeback', rep2.body?.rows?.[0]?.revenue === 0 && rep2.body?.rows?.[0]?.conversions === 0, rep2.body?.rows?.[0]);

  console.log('\n[9] RBAC & cakupan data');
  const viewerEmail = `viewer-${RUN}@example.com`;
  const add = await admin.post('/organizations/current/members', { email: viewerEmail, name: 'Viewer Test', password: 'Viewer-Pass-2026!', roleKey: 'MEDIA_BUYER', dataScope: 'ASSIGNED' });
  check('anggota Media Buyer (ASSIGNED) dibuat', add.status === 201, add);
  const buyer = new Client();
  await buyer.post('/auth/login', { email: viewerEmail, password: 'Viewer-Pass-2026!' });
  buyer.org = orgA;
  const list0 = await buyer.get('/campaigns');
  check('tanpa assignment: tidak melihat campaign apa pun', list0.status === 200 && list0.body.length === 0, list0.body?.length);
  const get0 = await buyer.get(`/campaigns/${camp.body.id}`);
  check('akses langsung campaign yang tidak di-assign → 404', get0.status === 404, get0);
  const rep0 = await buyer.get(`/analytics/report?groupBy=campaign&from=${from}&to=${to}`);
  check('laporan kosong untuk campaign yang tidak di-assign', rep0.status === 200 && rep0.body.rows.length === 0, rep0.body);
  const offerTry = await buyer.post('/offers', { name: 'x', url: 'https://x.test/?a={click_id}' });
  check('Media Buyer tidak bisa membuat offer (403)', offerTry.status === 403, offerTry);
  await admin.put(`/organizations/current/members/${add.body.id}/campaigns`, { campaignIds: [camp.body.id] });
  const list1 = await buyer.get('/campaigns');
  check('setelah di-assign: melihat 1 campaign', list1.body.length === 1 && list1.body[0].id === camp.body.id, list1.body?.length);

  console.log('\n[10] Isolasi tenant');
  const orgB = await admin.post('/organizations', { name: `Org B ${RUN}`, slug: `org-b-${RUN}` });
  check('Super Admin membuat organisasi B', orgB.status === 201, orgB);
  buyer.org = orgB.body.id;
  const cross = await buyer.get('/campaigns');
  check('anggota org A ditolak di org B (403)', cross.status === 403, cross);
  admin.org = orgB.body.id;
  const bCampaigns = await admin.get('/campaigns');
  check('org B tidak melihat campaign org A', bCampaigns.status === 200 && bCampaigns.body.length === 0, bCampaigns.body?.length);
  const crossGet = await admin.get(`/campaigns/${camp.body.id}`);
  check('campaign org A tidak dapat diakses lewat konteks org B', crossGet.status === 404, crossGet);

  console.log('\n[11] Audit log');
  admin.org = orgA;
  const audit = await admin.get('/audit-logs?limit=200');
  const actions = new Set(audit.body.map((a) => a.action));
  check('aksi penting tercatat', ['campaign.create', 'network_account.go_live', 'network_account.set_postback_template', 'member.add', 'member.assign_campaigns'].every((a) => actions.has(a)), [...actions]);
  check('audit log tidak memuat password/template rahasia', !JSON.stringify(audit.body).includes('Viewer-Pass-2026!') && !JSON.stringify(audit.body).includes('mock-network:4900/conversion'));

  // ───────────────────────────── Phase 2 ─────────────────────────────
  console.log('\n[12] Phase 2 — integrasi RollerAds (mock API)');
  const rnet = await admin.post('/network-accounts', { network: 'ROLLERADS', name: `RollerAds API ${RUN}` });
  check('akun RollerAds untuk integrasi API dibuat', rnet.status === 201, rnet);
  const badTok = await admin.put(`/network-accounts/${rnet.body.id}/api-token`, { token: 'token-salah-12345' });
  check('token salah ditolak (CONNECTION_FAILED)', badTok.status === 400 && badTok.body?.error?.code === 'CONNECTION_FAILED', badTok);
  const okTok = await admin.put(`/network-accounts/${rnet.body.id}/api-token`, { token: 'test-roller-token' });
  check('token valid → terhubung, zona waktu akun terbaca', okTok.status === 200 && okTok.body.account?.timezone === 'Asia/Jakarta' && okTok.body.timezoneRecognized === true, okTok);
  const netsAfter = await admin.get('/network-accounts');
  check('token API tidak dikembalikan ke klien', !JSON.stringify(netsAfter.body).includes('test-roller-token'));
  const otherNet = await admin.put(`/network-accounts/${net.body.id}/api-token`, { token: 'test-roller-token' });
  check('jaringan tanpa integrasi terverifikasi tetap boleh (RollerAds)', otherNet.status === 200, otherNet);
  const camp2 = await admin.post('/campaigns', {
    networkAccountId: rnet.body.id, name: `Mapped ${RUN}`, adFormat: 'PUSH', bidModel: 'SMART_CPC', targetCpa: '2', flowType: 'DIRECT', offerId: offer.body.id, externalCampaignId: '9001',
  });
  check('campaign dipetakan ke external ID 9001', camp2.status === 201, camp2);
  const remote = await admin.get(`/network-accounts/${rnet.body.id}/remote-campaigns`);
  check('daftar campaign RollerAds + status pemetaan', remote.status === 200 && remote.body.find((r) => r.id === '9001')?.mappedTo?.id === camp2.body.id, remote.body);

  console.log('\n[13] Phase 2 — channel Telegram (mock)');
  const chan = await admin.post('/notification-channels', { name: `Tim Ads ${RUN}`, target: '-1001234567890', botToken: `123456:${'A'.repeat(35)}`, minSeverity: 'WARNING' });
  check('channel Telegram dibuat, token tidak dikembalikan', chan.status === 201 && !JSON.stringify(chan.body).includes('A'.repeat(35)) && chan.body.secretHint, chan);
  const badChan = await admin.post('/notification-channels', { name: 'x', target: 'bukan-chat-id', botToken: 'bukan-token' });
  check('format chat ID / token tidak valid ditolak', badChan.status === 400, badChan);
  await admin.post(`/notification-channels/${chan.body.id}/test`);
  let tgTest = null;
  for (let i = 0; i < 20 && !tgTest; i++) {
    await sleep(1000);
    tgTest = (await fetch(`${MOCK}/_received`).then((r) => r.json())).received.find((g) => g.kind === 'telegram' && g.text?.includes(`Tim Ads ${RUN}`));
  }
  check('pesan uji terkirim ke Telegram', !!tgTest && tgTest.chat_id === '-1001234567890', tgTest);

  console.log('\n[14] Phase 2 — sinkronisasi, rekonsiliasi, zone, alert');
  const statsBefore = (await fetch(`${MOCK}/_received`).then((r) => r.json())).statsRequests;
  const syncQ = await admin.post(`/network-accounts/${rnet.body.id}/sync`);
  check('sinkronisasi manual diantrikan', syncQ.status === 202, syncQ);
  let run = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const runs = await admin.get(`/network-accounts/${rnet.body.id}/sync-runs`);
    run = runs.body?.[0];
    if (run && run.status !== 'RUNNING') break;
  }
  check('sinkronisasi selesai SUCCESS', run?.status === 'SUCCESS', run);
  check('hari ini + 3 hari lookback = 4 request statistik', run?.requestCount === 4 && (await fetch(`${MOCK}/_received`).then((r) => r.json())).statsRequests - statsBefore === 4, run);
  check('campaign RollerAds yang belum dipetakan dilaporkan', run?.unmappedCampaigns?.includes('9999'), run?.unmappedCampaigns);
  const spendRows = await admin.get(`/spend?campaignId=${camp2.body.id}`);
  const apiSpend = spendRows.body.filter((s) => s.source === 'API');
  check('spend API per hari tercatat (4 hari × 10.35)', apiSpend.length === 4 && apiSpend.every((s) => Math.abs(Number(s.amount) - 10.35) < 1e-6), apiSpend);
  const recon = await admin.get(`/analytics/reconciliation?networkAccountId=${rnet.body.id}`);
  const rrow = recon.body?.rows?.find((r) => r.campaignId === camp2.body.id && !r.isToday);
  check('rekonsiliasi memakai zona waktu jaringan', recon.body?.timezone === 'Asia/Jakarta' && recon.body?.timezoneSource === 'network', recon.body?.timezone);
  check('rekonsiliasi: 257 klik jaringan vs 0 internal → ditandai', rrow?.networkClicks === 257 && rrow?.internalClicks === 0 && rrow?.flagged === true, rrow);
  check('rekonsiliasi: campaign 9999 muncul sebagai belum dipetakan', recon.body?.unmappedCampaigns?.some((u) => u.externalCampaignId === '9999'), recon.body?.unmappedCampaigns);
  const zonesRes = await admin.get(`/campaigns/${camp2.body.id}/zones`);
  const z5552 = zonesRes.body?.rows?.find((z) => z.zoneId === '5552');
  check('zone 5552: spend jaringan & kandidat blacklist (spend ≥ 2× target CPA, 0 konversi)', z5552?.spendSource === 'network' && z5552?.spend > 4 && z5552?.flags?.includes('blacklist_candidate'), z5552);
  const addBl = await admin.post('/zone-lists', { networkAccountId: rnet.body.id, campaignId: camp2.body.id, zoneIds: ['5552'], listType: 'BLACKLIST', reason: 'spend tanpa konversi' });
  check('zone 5552 masuk blacklist internal', addBl.status === 201 && addBl.body.count === 1, addBl);
  const zonesAfter = await admin.get(`/campaigns/${camp2.body.id}/zones`);
  check('zone tertanda listed=BLACKLIST', zonesAfter.body?.rows?.find((z) => z.zoneId === '5552')?.listed?.listType === 'BLACKLIST');
  const spendDay = apiSpend[0].date.slice(0, 10);
  await admin.post('/spend', { campaignId: camp2.body.id, date: spendDay, amount: '99' });
  const repDup = await admin.get(`/analytics/report?groupBy=campaign&campaignId=${camp2.body.id}&from=${new Date(`${spendDay}T00:00:00Z`).toISOString()}&to=${new Date(new Date(`${spendDay}T00:00:00Z`).getTime() + 86400_000).toISOString()}`);
  check('spend manual + API di hari yang sama tidak dijumlahkan (API diprioritaskan)', Math.abs((repDup.body?.rows?.[0]?.spend ?? 0) - 10.35) < 1e-6, repDup.body?.rows?.[0]);
  const alertsRes = await admin.get('/alerts?status=OPEN');
  const reconAlert = alertsRes.body?.find((a) => a.type === 'RECONCILIATION_GAP' && a.entityId === camp2.body.id);
  check('alert selisih rekonsiliasi dibuat', !!reconAlert, alertsRes.body?.map((a) => a.type));
  let tgRecon = null;
  for (let i = 0; i < 20 && !tgRecon; i++) {
    await sleep(1000);
    tgRecon = (await fetch(`${MOCK}/_received`).then((r) => r.json())).received.find((g) => g.kind === 'telegram' && g.text?.includes(`Mapped ${RUN}`));
  }
  check('alert dikirim ke Telegram', !!tgRecon, tgRecon);
  check('pesan Telegram tidak memuat token/kredensial', !!tgRecon && !tgRecon.text.includes('test-roller-token'));
  const syncAgain = await admin.post(`/network-accounts/${rnet.body.id}/sync`);
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = (await admin.get(`/network-accounts/${rnet.body.id}/sync-runs`)).body?.[0];
    if (r && r.status !== 'RUNNING' && r.id !== run?.id) break;
  }
  const apiSpend2 = (await admin.get(`/spend?campaignId=${camp2.body.id}`)).body.filter((s) => s.source === 'API');
  check('sinkronisasi ulang idempoten (spend tidak berlipat)', syncAgain.status === 202 && apiSpend2.length === 4 && apiSpend2.every((s) => Math.abs(Number(s.amount) - 10.35) < 1e-6), apiSpend2);
  const alertsAgain = await admin.get('/alerts?status=OPEN');
  check('alert tidak terduplikasi (dedupe)', alertsAgain.body.filter((a) => a.type === 'RECONCILIATION_GAP' && a.entityId === camp2.body.id).length === alertsRes.body.filter((a) => a.type === 'RECONCILIATION_GAP' && a.entityId === camp2.body.id).length);
  const ack = await admin.post(`/alerts/${reconAlert?.id}/acknowledge`);
  check('alert dapat di-acknowledge', ack.status === 200 && ack.body.status === 'ACKNOWLEDGED', ack);

  console.log('\n[15] Phase 2 — RBAC');
  buyer.org = orgA;
  const bz = await buyer.get(`/campaigns/${camp2.body.id}/zones`);
  check('Media Buyer tidak bisa melihat zone campaign yang tidak di-assign', bz.status === 403, bz);
  const bch = await buyer.get('/notification-channels');
  check('Media Buyer tidak bisa mengelola channel notifikasi', bch.status === 403, bch);
  const btok = await buyer.put(`/network-accounts/${rnet.body.id}/api-token`, { token: 'test-roller-token' });
  check('Media Buyer tidak bisa mengatur token API', btok.status === 403, btok);
  const brecon = await buyer.get(`/analytics/reconciliation?networkAccountId=${rnet.body.id}`);
  check('rekonsiliasi untuk Media Buyer hanya memuat campaign yang di-assign', brecon.status === 200 && brecon.body.rows.every((r) => r.campaignId === camp.body.id), brecon.body?.rows?.length);
  check('Media Buyer tidak melihat campaign jaringan yang belum dipetakan', brecon.body?.unmappedCampaigns?.length === 0, brecon.body?.unmappedCampaigns);
  const balerts = await buyer.get('/alerts');
  check('Media Buyer tidak melihat alert campaign di luar cakupannya', balerts.status === 200 && !balerts.body.some((a) => a.entityType === 'campaign' && a.entityId !== camp.body.id), balerts.body?.map((a) => a.title));
  const bsum = await buyer.get('/alerts/summary');
  check('ringkasan alert Media Buyer mengikuti cakupan', bsum.status === 200 && bsum.body.open <= (await admin.get('/alerts/summary')).body.open, bsum.body);
  const back = await buyer.post(`/alerts/${reconAlert?.id}/resolve`);
  check('Media Buyer tidak bisa menutup alert campaign di luar cakupannya (404)', back.status === 404, back);

  // ───────────────────────────── Phase 3 ─────────────────────────────
  console.log('\n[17] Phase 3 — rotasi & split test');
  admin.org = orgA;
  const offerB = await admin.post('/offers', { name: `Offer B ${RUN}`, url: 'https://offer-b.example.com/go?sub={click_id}', affiliateNetworkId: aff.body.id, payoutAmount: '3', currency: 'USD' });
  const lander = await admin.post('/landing-pages', { name: `Lander ${RUN}`, url: 'https://lp.example.com/promo' });
  check('offer B & landing page dibuat', offerB.status === 201 && lander.status === 201, { offerB: offerB.status, lander: lander.status });
  const badRoutes = await admin.put(`/campaigns/${camp.body.id}/routes`, { routes: [{ name: 'x', conditions: { countries: ['IDN'] }, variants: [{ label: 'A', offerId: offer.body.id, weight: 1 }] }] });
  check('kondisi tidak valid ditolak', badRoutes.status === 400 && badRoutes.body?.error?.code === 'BAD_CONDITIONS', badRoutes);
  const zeroW = await admin.put(`/campaigns/${camp.body.id}/routes`, { routes: [{ name: 'x', variants: [{ label: 'A', offerId: offer.body.id, weight: 0 }] }] });
  check('route tanpa varian berbobot ditolak', zeroW.status === 400 && zeroW.body?.error?.code === 'NO_WEIGHT', zeroW);
  const routesRes = await admin.put(`/campaigns/${camp.body.id}/routes`, {
    routes: [
      {
        name: 'Indonesia mobile',
        conditions: { countries: ['id'], devices: ['mobile'] },
        variants: [
          { label: 'A', offerId: offer.body.id, weight: 50 },
          { label: 'B', offerId: offerB.body.id, weight: 50 },
        ],
      },
      { name: 'Lainnya', conditions: {}, variants: [{ label: 'Landing', offerId: offerB.body.id, landingPageId: lander.body.id, weight: 1 }] },
    ],
  });
  check('konfigurasi routing disimpan (2 route)', routesRes.status === 200 && routesRes.body.length === 2 && routesRes.body[0].variants.length === 2, routesRes);
  await sleep(31_000); // cache campaign di tracker = 30 detik

  // Tiap klik uji dari IP berbeda (X-Forwarded-For; lokal tanpa Caddy) agar tidak dianggap "rapid repeat" oleh bot filter
  let ipSeq = 10;
  const trk = async (qs, cookie) => {
    const ip = `198.51.100.${ipSeq++}`;
    const r = await fetch(`${TRK}/c/${token}?${qs}`, { redirect: 'manual', headers: { 'user-agent': BROWSER_UA, 'accept-language': 'id-ID,id;q=0.9', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) } });
    const setCookies = r.headers.getSetCookie?.() ?? [];
    const vc = setCookies.find((c) => c.startsWith('eaip_v_'));
    return { location: r.headers.get('location') ?? '', variantCookie: vc ? vc.split(';')[0] : null };
  };
  const seen = new Set();
  let firstCookie = null;
  let firstDest = null;
  for (let i = 0; i < 20; i++) {
    const r = await trk(`click_id=RT-${RUN}-${i}&zone_id=6001&country=ID`);
    seen.add(new URL(r.location).host);
    if (i === 0) {
      firstCookie = r.variantCookie;
      firstDest = new URL(r.location).host;
    }
  }
  check('traffic ID+mobile dibagi ke dua offer (A/B)', seen.has('offer.example.com') && seen.has('offer-b.example.com'), [...seen]);
  check('cookie sticky varian di-set', !!firstCookie, firstCookie);
  const stickyHosts = new Set();
  for (let i = 0; i < 8; i++) stickyHosts.add(new URL((await trk(`click_id=ST-${RUN}-${i}&country=ID`, firstCookie)).location).host);
  check('pengunjung dengan cookie yang sama selalu ke varian yang sama', stickyHosts.size === 1 && stickyHosts.has(firstDest), [...stickyHosts]);
  const my = await trk(`click_id=MY-${RUN}&country=MY`);
  check('negara lain → route "Lainnya" (landing page + cid)', my.location.startsWith('https://lp.example.com/promo?cid='), my.location);
  const unknownCountry = await trk(`click_id=NC-${RUN}`);
  check('negara tidak diketahui tidak cocok dengan route ID → route "Lainnya"', unknownCountry.location.startsWith('https://lp.example.com/promo?cid='), unknownCountry.location);

  // Konversi pada salah satu klik varian
  const routedClick = new URL((await trk(`click_id=CV-${RUN}&country=ID`)).location).searchParams.get('sub');
  const pbRouted = await fetch(pbUrl({ click_id: routedClick, payout: '3', txid: `RT-${RUN}`, status: 'approved' })).then((r) => r.json());
  check('postback untuk klik hasil rotasi diterima', pbRouted.status === 'accepted', pbRouted);
  const split = await admin.get(`/campaigns/${camp.body.id}/split-test?days=7`);
  const r1 = split.body?.routes?.[0];
  const totalClicks = r1?.variants?.reduce((s, v) => s + v.clicks, 0);
  const totalConv = r1?.variants?.reduce((s, v) => s + v.conversions, 0);
  check('laporan split test: klik & konversi per varian', split.status === 200 && totalClicks === 29 && totalConv === 1, r1?.variants?.map((v) => ({ l: v.label, c: v.clicks, bot: v.botClicks, cv: v.conversions })));
  check('split test: data belum cukup → tidak ada pemenang', r1?.variants?.[1]?.verdict === 'insufficient_data' && r1?.variants?.[0]?.verdict === 'control', r1?.variants?.map((v) => v.verdict));
  check('split test: pembagian traffic 50/50', Math.abs((r1?.variants?.[0]?.trafficShare ?? 0) - 0.5) < 1e-9, r1?.variants?.map((v) => v.trafficShare));
  const bRoutes = await buyer.get(`/campaigns/${camp2.body.id}/routes`);
  check('Media Buyer tidak bisa melihat routing campaign di luar cakupannya', bRoutes.status === 403, bRoutes.status);
  // Kembalikan campaign ke tujuan default agar skenario lain tidak terpengaruh
  const cleared = await admin.put(`/campaigns/${camp.body.id}/routes`, { routes: [] });
  check('routing dapat dikosongkan (kembali ke tujuan default)', cleared.status === 200 && cleared.body.length === 0, cleared);

  console.log('\n[18] Phase 3 — JS SDK & funnel');
  const siteDomain = `sdk-${RUN}.example.com`;
  const site = await admin.post('/websites', { name: `Site ${RUN}`, domain: siteDomain });
  const keyRes = await admin.post(`/websites/${site.body.id}/sdk-key`);
  const sdkKey = keyRes.body?.sdkKey;
  check('SDK key & snippet dibuat', keyRes.status === 200 && /^[A-Za-z0-9_-]{16,}$/.test(sdkKey ?? '') && keyRes.body.sdkSnippet?.includes(`sdk.js?k=${sdkKey}`), keyRes.body);
  const sdkJs = await fetch(`${TRK}/sdk.js?k=${sdkKey}`);
  const sdkText = await sdkJs.text();
  check('GET /sdk.js disajikan sebagai JavaScript', sdkJs.status === 200 && sdkJs.headers.get('content-type')?.includes('javascript') && sdkText.includes(sdkKey), sdkJs.status);
  check('GET /sdk.js dengan key tak dikenal → 404', (await fetch(`${TRK}/sdk.js?k=tidakadakeyini12345`)).status === 404);

  const sendEvents = (origin, events, contentType = 'text/plain') =>
    fetch(`${TRK}/e`, { method: 'POST', headers: { 'content-type': contentType, ...(origin ? { origin } : {}) }, body: JSON.stringify({ k: sdkKey, events }) });
  const ev = (t, extra = {}) => ({ id: crypto.randomUUID(), t, ts: Date.now(), p: '/promo?email=a@b.com', sid: crypto.randomUUID(), cid: clickId, ...extra });

  const evil = await sendEvents('http://evil.example.net', [ev('page_view')]);
  check('event dari domain lain ditolak (403)', evil.status === 403, evil.status);
  const noOrigin = await sendEvents(null, [ev('page_view')]);
  check('event tanpa Origin/Referer ditolak (403)', noOrigin.status === 403, noOrigin.status);
  const dupId = crypto.randomUUID();
  const batch = [
    ev('page_view', { id: dupId }),
    ev('landing_view'),
    ev('registration_started', { props: { plan: 'gold', email: 'a@b.com', phone: '0812345678' } }),
    ev('registration_success_verified'),
    ev('hack_event'),
  ];
  const okRes = await sendEvents(`http://www.${siteDomain}`, batch);
  const okBody = await okRes.json();
  check('event dari subdomain terdaftar diterima (text/plain)', okRes.status === 200 && okBody.accepted === 3, okBody);
  check('event "verified" dari browser ditolak', okBody.rejected?.some((r) => r.reason === 'verified_events_must_come_from_backend'), okBody.rejected);
  check('jenis event tak dikenal ditolak', okBody.rejected?.some((r) => r.reason === 'unknown_type'), okBody.rejected);
  check('CORS hanya untuk origin terdaftar', okRes.headers.get('access-control-allow-origin') === `http://www.${siteDomain}` && !evil.headers.get('access-control-allow-origin'));
  const dupRes = await (await sendEvents(`http://${siteDomain}`, [ev('page_view', { id: dupId })])).json();
  check('event dengan ID sama tidak disimpan dua kali', dupRes.accepted === 0 && dupRes.duplicates === 1, dupRes);
  const evList = await admin.get(`/events?websiteId=${site.body.id}`);
  const regEvent = evList.body?.find((e) => e.type === 'REGISTRATION_STARTED');
  check('event tersimpan & terhubung ke campaign lewat click ID', evList.status === 200 && regEvent?.campaignId === camp.body.id, regEvent);
  check('PII dibuang dari properti & query string dari path', regEvent?.props?.plan === 'gold' && !('email' in (regEvent?.props ?? {})) && !('phone' in (regEvent?.props ?? {})) && regEvent?.path === '/promo', regEvent);
  const fn = await admin.get(`/analytics/funnel?campaignId=${camp.body.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const stage = (k) => fn.body?.stages?.find((s) => s.key === k);
  check('funnel: klik → landing → mulai registrasi', fn.status === 200 && stage('click')?.count >= 1 && stage('landing_view')?.count === 1 && stage('registration_started')?.count === 1 && fn.body.sdkActive === true, fn.body?.stages);
  check('funnel: konversi VERIFIED terpisah dari event OBSERVED', stage('conversion_verified')?.source === 'postback_verified' && stage('registration_started')?.source === 'sdk_observed', fn.body?.stages);
  const consent = await admin.patch(`/websites/${site.body.id}`, { requireConsent: true, extraDomains: ['partner-site.com'] });
  check('pengaturan consent & domain tambahan disimpan', consent.status === 200 && consent.body.requireConsent === true && consent.body.extraDomains.includes('partner-site.com'), consent.body);
  const bFunnel = await buyer.get(`/analytics/funnel?campaignId=${camp2.body.id}`);
  check('Media Buyer tidak bisa melihat funnel campaign di luar cakupannya', bFunnel.status === 403, bFunnel.status);

  console.log('\n[19] Adapter PropellerAds (mock Propeller SSP API v5)');
  const pnet = await admin.post('/network-accounts', { network: 'PROPELLERADS', name: `Propeller ${RUN}` });
  const pBad = await admin.put(`/network-accounts/${pnet.body.id}/api-token`, { token: 'token-salah-propeller' });
  check('token PropellerAds salah ditolak', pBad.status === 400 && pBad.body?.error?.message?.includes('PropellerAds'), pBad);
  const pOk = await admin.put(`/network-accounts/${pnet.body.id}/api-token`, { token: 'test-propeller-token' });
  check('token PropellerAds valid → laporan dalam UTC', pOk.status === 200 && pOk.body.account?.timezone === 'UTC', pOk);
  const pCamp = await admin.post('/campaigns', { networkAccountId: pnet.body.id, name: `Propeller TH ${RUN}`, adFormat: 'ONCLICK', bidModel: 'SMART_CPM', targetCpa: '1', flowType: 'DIRECT', offerId: offer.body.id, externalCampaignId: '7001' });
  check('campaign dipetakan ke campaign PropellerAds 7001', pCamp.status === 201, pCamp);
  const pRemote = await admin.get(`/network-accounts/${pnet.body.id}/remote-campaigns`);
  check('daftar campaign PropellerAds + status (working/paused)', pRemote.status === 200 && pRemote.body.find((r) => r.id === '7001')?.mappedTo?.id === pCamp.body.id && pRemote.body.find((r) => r.id === '7099')?.status === 'paused', pRemote.body);
  const pStatsBefore = (await fetch(`${MOCK}/_received`).then((r) => r.json())).statsRequests;
  await admin.post(`/network-accounts/${pnet.body.id}/sync`);
  let prun = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    prun = (await admin.get(`/network-accounts/${pnet.body.id}/sync-runs`)).body?.[0];
    if (prun && prun.status !== 'RUNNING') break;
  }
  check('sinkronisasi PropellerAds SUCCESS (4 hari = 4 request statistik)', prun?.status === 'SUCCESS' && prun?.requestCount === 4 && (await fetch(`${MOCK}/_received`).then((r) => r.json())).statsRequests - pStatsBefore === 4, prun);
  check('campaign PropellerAds yang belum dipetakan dilaporkan', prun?.unmappedCampaigns?.includes('7099'), prun?.unmappedCampaigns);
  const pSpend = (await admin.get(`/spend?campaignId=${pCamp.body.id}`)).body.filter((s) => s.source === 'API');
  check('spend PropellerAds per hari = 5.00 USD (field "spent")', pSpend.length === 4 && pSpend.every((s) => Math.abs(Number(s.amount) - 5) < 1e-6 && s.currency === 'USD'), pSpend);
  const pZones = await admin.get(`/campaigns/${pCamp.body.id}/zones?days=4`);
  const z1 = pZones.body?.rows?.find((z) => z.zoneId === '880001');
  check('zone PropellerAds tersinkron (spend & klik jaringan per zone)', z1?.spendSource === 'network' && Math.abs(z1.spend - 16.8) < 1e-6 && z1.networkClicks === 1200, z1);
  const pRecon = await admin.get(`/analytics/reconciliation?networkAccountId=${pnet.body.id}&days=4`);
  check('rekonsiliasi PropellerAds memakai UTC', pRecon.body?.timezone === 'UTC' && pRecon.body?.rows?.some((r) => r.campaignId === pCamp.body.id && r.networkClicks === 320), pRecon.body?.rows?.slice(0, 2));
  const clickaduNet = await admin.post('/network-accounts', { network: 'CLICKADU', name: `Clickadu ${RUN}` });
  const cTok = await admin.put(`/network-accounts/${clickaduNet.body.id}/api-token`, { token: 'apa-saja-12345' });
  check('jaringan tanpa dokumentasi terverifikasi (Clickadu) menolak integrasi API', cTok.status === 400 && cTok.body?.error?.code === 'API_NOT_SUPPORTED', cTok);

  console.log('\n[20] Manajemen domain tracking');
  const askKey = (() => {
    try {
      const envLocal = require('fs').readFileSync(new URL('../../../infra/.env.local', import.meta.url), 'utf8');
      return envLocal.match(/^INTERNAL_ASK_KEY=(.+)$/m)?.[1]?.trim() ?? '';
    } catch {
      return process.env.INTERNAL_ASK_KEY ?? '';
    }
  })();
  const okHost = `go-${RUN}.e2e-ok.example`;
  const badHost = `x-${RUN}.e2e-bad.example`;
  const platform = (await admin.get('/domains')).body?.platform;
  check('GET /domains menampilkan host platform (admin, tracking, postback)', !!platform?.trackerHost && !!platform?.postbackHost && !!platform?.adminHost, platform);
  const reserved = await admin.post('/domains', { hostname: platform.trackerHost });
  check('domain platform tidak bisa didaftarkan', reserved.status === 400 && reserved.body?.error?.code === 'RESERVED_HOSTNAME', reserved);
  const invalidHost = await admin.post('/domains', { hostname: 'bukan domain!' });
  check('format domain tidak valid ditolak', invalidHost.status === 400 && invalidHost.body?.error?.code === 'BAD_HOSTNAME', invalidHost);
  const dOk = await admin.post('/domains', { hostname: okHost.toUpperCase(), websiteId: site.body.id });
  check('domain dengan CNAME benar langsung ACTIVE (+ instruksi DNS)', dOk.status === 201 && dOk.body.status === 'ACTIVE' && dOk.body.hostname === okHost && dOk.body.dns?.type === 'CNAME', dOk.body);
  const dBad = await admin.post('/domains', { hostname: badHost });
  check('domain dengan CNAME salah tetap PENDING + alasan', dBad.status === 201 && dBad.body.status === 'PENDING' && dBad.body.lastError?.includes('seharusnya'), dBad.body);
  const dDup = await admin.post('/domains', { hostname: okHost });
  check('domain yang sama tidak bisa didaftarkan dua kali', dDup.status === 400 && dDup.body?.error?.code === 'HOSTNAME_TAKEN', dDup);
  const reVerify = await admin.post(`/domains/${dBad.body.id}/verify`);
  check('verifikasi ulang memberi detail DNS', reVerify.status === 200 && reVerify.body.status === 'PENDING' && !!reVerify.body.detail, reVerify.body);
  const campBadDomain = await admin.patch(`/campaigns/${camp.body.id}`, { trackingDomainId: dBad.body.id });
  check('campaign tidak bisa memakai domain yang belum terverifikasi', campBadDomain.status === 400 && campBadDomain.body?.error?.code === 'DOMAIN_NOT_ACTIVE', campBadDomain);
  const campDomain = await admin.patch(`/campaigns/${camp.body.id}`, { trackingDomainId: dOk.body.id });
  const campView = await admin.get(`/campaigns/${camp.body.id}`);
  check('tracking link campaign memakai domain kustom (HTTPS)', campDomain.status === 200 && campView.body.trackingLink?.base === `https://${okHost}/c/${token}`, campView.body.trackingLink);
  const ask = (domain, key = askKey) => fetch(`${TRK}/internal/tls-allowed?domain=${encodeURIComponent(domain)}${key ? `&key=${key}` : ''}`).then((r) => r.status);
  check('Caddy ask: sertifikat diizinkan untuk domain ACTIVE', (await ask(okHost)) === 200);
  check('Caddy ask: ditolak untuk domain PENDING / tak dikenal', (await ask(badHost)) === 404 && (await ask('random.example.org')) === 404);
  if (askKey) check('Caddy ask: tanpa kunci internal → 403', (await ask(okHost, 'kunci-salah-kunci-salah')) === 403);
  // Simulasi request yang datang lewat domain kustom (header Host diganti; fetch bawaan tidak mengizinkan)
  const rawGet = (path, headers) =>
    new Promise((resolve, reject) => {
      const u = new URL(TRK + path);
      require('http').get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
  const viaCustom = await rawGet(`/c/${token}?click_id=DOM-${RUN}`, { host: okHost, 'user-agent': BROWSER_UA, 'accept-language': 'id' });
  check('klik lewat domain kustom tetap ter-redirect', viaCustom.status === 302 && !!viaCustom.headers.location, viaCustom.status);
  const sdkCustom = (await rawGet(`/sdk.js?k=${sdkKey}`, { host: okHost })).body;
  check('JS SDK yang dimuat dari domain kustom mengirim event ke domain yang sama', sdkCustom.includes(`${okHost}/e`), sdkCustom.match(/"endpoint":"[^"]+"/)?.[0]);
  const sites = await admin.get('/websites');
  check('snippet SDK website memakai domain kustom miliknya', sites.body.find((w) => w.id === site.body.id)?.sdkSnippet?.includes(`https://${okHost}/sdk.js`), sites.body.find((w) => w.id === site.body.id)?.sdkSnippet);
  const delInUse = await admin.req('DELETE', `/domains/${dOk.body.id}`);
  check('domain yang masih dipakai campaign tidak bisa dihapus', delInUse.status === 400 && delInUse.body?.error?.code === 'DOMAIN_IN_USE', delInUse);
  await admin.patch(`/campaigns/${camp.body.id}`, { trackingDomainId: null });
  const delOk = await admin.req('DELETE', `/domains/${dBad.body.id}`);
  check('domain yang tidak dipakai bisa dihapus', delOk.status === 200, delOk);
  const bDom = await buyer.post('/domains', { hostname: `b-${RUN}.e2e-ok.example` });
  check('Media Buyer tidak bisa mengelola domain', bDom.status === 403, bDom.status);

  // ───────────────────────────── Phase 4 ─────────────────────────────
  console.log('\n[21] Phase 4 — tim, jabatan, board & kartu');
  admin.org = orgA;
  buyer.org = orgA;
  const people = await admin.get('/people');
  const meMember = people.body?.find((p) => p.isMe);
  const buyerMember = people.body?.find((p) => p.id === add.body.id);
  check('direktori anggota tanpa email', people.status === 200 && !!meMember && !!buyerMember && !('email' in buyerMember) && !JSON.stringify(people.body).includes('@example.com'), people.body?.[0]);
  const pos = await admin.put(`/people/${meMember?.id}/positions`, { positions: ['TRACKING_SPECIALIST', 'ADS_MANAGER'], primary: 'TRACKING_SPECIALIST' });
  check('jabatan anggota ditetapkan (Tracking Specialist utama)', pos.status === 200 && pos.body.primary === 'TRACKING_SPECIALIST', pos);
  const badPos = await admin.put(`/people/${meMember?.id}/positions`, { positions: ['MEDIA_BUYER'], primary: 'FRAUD_ANALYST' });
  check('jabatan utama di luar daftar ditolak', badPos.status === 400, badPos.status);
  check('Media Buyer tidak bisa mengatur jabatan', (await buyer.put(`/people/${buyerMember?.id}/positions`, { positions: ['ADS_MANAGER'] })).status === 403);
  const team = await admin.post('/teams', { name: `Tim ${RUN}`, leadMembershipId: meMember?.id });
  check('tim dibuat, ketua otomatis jadi anggota', team.status === 201);
  await admin.put(`/teams/${team.body.id}/members`, { membershipIds: [buyerMember?.id] });
  const teams = await admin.get('/teams');
  const tRow = teams.body?.find((t) => t.id === team.body.id);
  check('anggota tim = ketua + media buyer', tRow?.members?.length === 2 && tRow?.lead?.id === meMember?.id, tRow);

  const board = await admin.post('/boards', { name: `Board ${RUN}`, teamId: team.body.id });
  check('board dibuat dengan 7 kolom default', board.status === 201 && board.body.columns?.map((c) => c.kind).join() === 'BACKLOG,TODO,IN_PROGRESS,REVIEW,WAITING_APPROVAL,BLOCKED,DONE', board.body?.columns?.map((c) => c.kind));
  const col = Object.fromEntries((board.body.columns ?? []).map((c) => [c.kind, c.id]));
  check('Media Buyer tidak bisa membuat board', (await buyer.post('/boards', { name: 'x board' })).status === 403);
  const c1 = await admin.post('/cards', { boardId: board.body.id, title: 'Cek postback campaign 1', campaignId: camp.body.id, priority: 'HIGH', assigneeIds: [buyerMember?.id], dueDate: '2026-12-01' });
  const c2 = await admin.post('/cards', { boardId: board.body.id, title: 'Audit zone campaign 2', campaignId: camp2.body.id, approvalRequired: true });
  const c3 = await admin.post('/cards', { boardId: board.body.id, title: 'Siapkan creative baru' });
  check('kartu dibuat dengan nomor berurutan di kolom To Do', [c1, c2, c3].every((c) => c.status === 201 && c.body.columnId === col.TODO) && c2.body.number === c1.body.number + 1 && c3.body.number === c2.body.number + 1, [c1.status, c2.status, c3.status]);
  check('owner default = pembuat kartu', c3.body.ownerMembershipId === meMember?.id, c3.body.ownerMembershipId);
  const badRef = await admin.post('/cards', { boardId: board.body.id, title: 'x ref', ownerMembershipId: '00000000-0000-4000-8000-000000000000' });
  check('owner di luar organisasi ditolak', badRef.status === 400, badRef.status);

  const bBoard = await buyer.get(`/boards/${board.body.id}`);
  const bIds = (bBoard.body?.cards ?? []).map((c) => c.id);
  check('Media Buyer (ASSIGNED) hanya melihat kartu campaign/tugasnya', bBoard.status === 200 && bIds.includes(c1.body.id) && !bIds.includes(c2.body.id) && !bIds.includes(c3.body.id), bIds.length);
  check('Media Buyer tidak bisa membuka kartu di luar cakupan (404)', (await buyer.get(`/cards/${c2.body.id}`)).status === 404);
  const bCardOther = await buyer.post('/cards', { boardId: board.body.id, title: 'Kartu campaign lain', campaignId: camp2.body.id });
  check('Media Buyer tidak bisa membuat kartu untuk campaign di luar cakupan', bCardOther.status === 403, bCardOther.status);
  const bCard = await buyer.post('/cards', { boardId: board.body.id, title: 'Catatan pribadi buyer' });
  check('Media Buyer bisa membuat kartu miliknya sendiri', bCard.status === 201 && bCard.body.ownerMembershipId === buyerMember?.id, bCard);

  // urutan & versi
  let v1 = c1.body.version;
  const mv = await admin.post(`/cards/${c1.body.id}/move`, { columnId: col.IN_PROGRESS, index: 0, version: v1 });
  check('kartu dipindah ke In Progress, versi naik', mv.status === 200 && mv.body.columnId === col.IN_PROGRESS && mv.body.version === v1 + 1, mv);
  const stale = await admin.post(`/cards/${c1.body.id}/move`, { columnId: col.REVIEW, index: 0, version: v1 });
  check('versi usang ditolak 409 VERSION_CONFLICT', stale.status === 409 && stale.body?.error?.code === 'VERSION_CONFLICT', stale);
  v1 = mv.body.version;
  await admin.post(`/cards/${c3.body.id}/move`, { columnId: col.IN_PROGRESS, index: 0, version: c3.body.version });
  const ip = (await admin.get(`/boards/${board.body.id}`)).body.cards.filter((c) => c.columnId === col.IN_PROGRESS).map((c) => c.id);
  check('urutan dalam kolom mengikuti index (c3 sebelum c1)', ip[0] === c3.body.id && ip[1] === c1.body.id, ip);

  // aturan Done
  const noEv = await admin.post(`/cards/${c1.body.id}/move`, { columnId: col.DONE, index: 0, version: v1 });
  check('Done tanpa bukti penyelesaian ditolak', noEv.status === 422 && noEv.body?.error?.code === 'EVIDENCE_REQUIRED', noEv);
  const dep = await admin.post(`/cards/${c1.body.id}/dependencies`, { dependsOnCardId: c3.body.id });
  check('dependensi ditambahkan', dep.status === 201, dep);
  const cyc = await admin.post(`/cards/${c3.body.id}/dependencies`, { dependsOnCardId: c1.body.id });
  check('dependensi melingkar ditolak', cyc.status === 422 && cyc.body?.error?.code === 'DEPENDENCY_CYCLE', cyc);
  let cur = (await admin.get(`/cards/${c1.body.id}`)).body;
  const evSet = await admin.patch(`/cards/${c1.body.id}`, { version: cur.version, completionEvidence: 'Postback terverifikasi: 3 konversi VERIFIED di log' });
  check("bukti penyelesaian disimpan", evSet.status === 200 && evSet.body.completionEvidence?.startsWith("Postback"), evSet);
  const depOpen = await admin.post(`/cards/${c1.body.id}/move`, { columnId: col.DONE, index: 0, version: evSet.body.version });
  check('Done diblokir dependensi yang belum selesai', depOpen.status === 422 && depOpen.body?.error?.code === 'DEPENDENCY_OPEN', depOpen);
  await admin.req('DELETE', `/cards/${c1.body.id}/dependencies/${c3.body.id}`);
  cur = (await admin.get(`/cards/${c1.body.id}`)).body;
  const done = await admin.post(`/cards/${c1.body.id}/move`, { columnId: col.DONE, index: 0, version: cur.version });
  check('kartu dengan bukti masuk Done & completedAt terisi', done.status === 200 && !!done.body.completedAt, done);

  // approval
  const c2v = (await admin.patch(`/cards/${c2.body.id}`, { version: c2.body.version, completionEvidence: 'Zone 5552 diblacklist' })).body.version;
  await admin.put(`/organizations/current/members/${add.body.id}/campaigns`, { campaignIds: [camp.body.id, camp2.body.id] });
  const bApprove = await buyer.post(`/cards/${c2.body.id}/move`, { columnId: col.DONE, index: 0, version: c2v });
  check('kartu approvalRequired tidak bisa diselesaikan Media Buyer', bApprove.status === 422 && bApprove.body?.error?.code === 'APPROVAL_REQUIRED', bApprove);
  const bWait = await buyer.post(`/cards/${c2.body.id}/move`, { columnId: col.WAITING_APPROVAL, index: 0, version: c2v });
  check('Media Buyer memindahkan ke Waiting Approval', bWait.status === 200, bWait);
  const bUnset = await buyer.patch(`/cards/${c2.body.id}`, { version: bWait.body.version, approvalRequired: false });
  check('Media Buyer tidak bisa mencabut kewajiban approval', bUnset.status === 403, bUnset.status);
  const aApprove = await admin.post(`/cards/${c2.body.id}/move`, { columnId: col.DONE, index: 0, version: bWait.body.version });
  check('Owner menyetujui → Done', aApprove.status === 200 && !!aApprove.body.completedAt, aApprove);
  await admin.put(`/organizations/current/members/${add.body.id}/campaigns`, { campaignIds: [camp.body.id] });

  // sub-item
  const ck = await buyer.post(`/cards/${c1.body.id}/checklist`, { text: 'Cek log postback masuk' });
  const ckDone = await buyer.patch(`/checklist/${ck.body?.id}`, { done: true });
  check('checklist ditambah & dicentang', ck.status === 201 && ckDone.status === 200 && ckDone.body.done === true, [ck.status, ckDone.status]);
  const cm = await buyer.post(`/cards/${c1.body.id}/comments`, { body: `Sudah dicek @[Admin](${meMember?.id}) dan @[Palsu](00000000-0000-4000-8000-000000000000)` });
  check('komentar menyimpan mention anggota yang sah saja', cm.status === 201 && cm.body.mentions?.length === 1 && cm.body.mentions[0] === meMember?.id, cm.body?.mentions);
  const badLink = await buyer.post(`/cards/${c1.body.id}/links`, { title: 'x', url: 'javascript:alert(1)' });
  check('tautan non-http ditolak', badLink.status === 400, badLink.status);
  const lk = await buyer.post(`/cards/${c1.body.id}/links`, { title: 'Laporan', url: 'https://docs.example.com/r/1' });
  const tm = await buyer.post(`/cards/${c1.body.id}/time`, { minutes: 45, date: '2026-11-11', note: 'cek log' });
  check('tautan & catatan waktu ditambahkan', lk.status === 201 && tm.status === 201, [lk.status, tm.status]);
  const detail = (await admin.get(`/cards/${c1.body.id}`)).body;
  check('detail kartu: checklist, komentar (nama penulis), waktu total, timeline', detail.checklist?.length === 1 && detail.comments?.[0]?.authorName === 'Viewer Test' && detail.totalMinutes === 45 && detail.activities?.some((a) => a.type === 'moved'), { c: detail.checklist?.length, m: detail.totalMinutes });
  const myTasks = await admin.get("/tasks/mine");
  check('"Tugas saya" memuat kartu milik & mention', myTasks.status === 200 && myTasks.body.cards.some((c) => c.id === c3.body.id) && myTasks.body.mentions.some((m) => m.card.id === c1.body.id), { cards: myTasks.body?.cards?.length, mentions: myTasks.body?.mentions?.length });
  const bMine = await buyer.get('/tasks/mine');
  check('"Tugas saya" Media Buyer memuat kartu yang di-assign', bMine.body?.cards?.some((c) => c.id === c1.body.id) && !bMine.body.cards.some((c) => c.id === c2.body.id), bMine.body?.cards?.map((c) => c.number));

  // kolom & WIP
  const wip = await admin.post(`/boards/${board.body.id}/columns`, { name: 'QA', wipLimit: 1 });
  check('kolom custom disisipkan sebelum Done', wip.status === 201 && wip.body.position === 6, wip.body);
  cur = (await admin.get(`/cards/${c3.body.id}`)).body;
  await admin.post(`/cards/${c3.body.id}/move`, { columnId: wip.body.id, index: 0, version: cur.version });
  const bc = (await admin.get(`/cards/${bCard.body.id}`)).body;
  const overWip = await admin.post(`/cards/${bCard.body.id}/move`, { columnId: wip.body.id, index: 0, version: bc.version });
  check('batas WIP ditegakkan', overWip.status === 422 && overWip.body?.error?.code === 'WIP_LIMIT', overWip);
  check('kolom bawaan tidak bisa dihapus', (await admin.req('DELETE', `/columns/${col.REVIEW}`)).status === 422);
  check('kolom berisi kartu tidak bisa dihapus', (await admin.req('DELETE', `/columns/${wip.body.id}`)).status === 422);

  console.log('\n[22] Phase 4 — real-time (SSE)');
  const ctrl = new AbortController();
  const sse = await fetch(`${API}/tasks/stream`, { headers: { cookie: admin.cookie, 'x-organization-id': orgA, accept: 'text/event-stream' }, signal: ctrl.signal });
  check('stream SSE terbuka dengan X-Accel-Buffering: no', sse.status === 200 && sse.headers.get('content-type')?.includes('text/event-stream') && sse.headers.get('x-accel-buffering') === 'no', [sse.status, sse.headers.get('content-type')]);
  const reader = sse.body.getReader();
  let buf = '';
  const waitFor = async (pred, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const r = await Promise.race([reader.read(), sleep(Math.max(1, end - Date.now())).then(() => null)]);
      if (!r || r.done) break;
      buf += new TextDecoder().decode(r.value);
      if (pred(buf)) return true;
    }
    return pred(buf);
  };
  check('event ready diterima', await waitFor((b) => b.includes('event: ready')), buf.slice(0, 200));
  const cLive = await buyer.post('/cards', { boardId: board.body.id, title: 'Kartu realtime' });
  check('pembuatan kartu oleh anggota lain dipublikasikan ke stream', await waitFor((b) => b.includes(cLive.body?.id ?? 'x') && b.includes('card.created')), buf.slice(-300));
  ctrl.abort();

  console.log('\n[23] Phase 4 — incident card dari alert');
  const allBoards = (await admin.get('/boards')).body;
  const defBoard = allBoards.find((b) => b.isDefault);
  check('board default organisasi ada', !!defBoard, allBoards.map((b) => b.name));
  const defCards = (await admin.get(`/boards/${defBoard?.id}`)).body?.cards ?? [];
  const incs = defCards.filter((c) => c.source === 'ALERT' && c.campaign?.id === camp2.body.id);
  const inc = incs[0];
  check('alert HIGH (selisih rekonsiliasi) menjadi incident card', inc?.source === 'ALERT' && inc?.priority === 'HIGH' && inc?.campaign?.id === camp2.body.id, inc);
  const bDef = (await buyer.get(`/boards/${defBoard?.id}`)).body?.cards ?? [];
  check('incident card campaign di luar cakupan tidak terlihat Media Buyer', !bDef.some((c) => c.campaign?.id === camp2.body.id));
  check('alert harian untuk campaign yang sama digabung ke satu incident card', incs.length === 1, incs.map((c) => c.number));
  const incDetail = (await admin.get(`/cards/${inc?.id}`)).body;
  check('incident card di-assign ke Tracking Specialist & mencatat alert berulang', incDetail?.owner?.id === meMember?.id || incDetail?.activities?.some((a) => a.type === 'alert_repeated'), { owner: incDetail?.owner, acts: incDetail?.activities?.map((a) => a.type) });

  // ───────────────────────────── Phase 5 ─────────────────────────────
  console.log('\n[24] Phase 5 — pengaturan AI & model registry (mock OpenRouter)');
  admin.org = orgA;
  buyer.org = orgA;
  const OR_KEY = 'sk-or-v1-mock-valid-key-000000000000';
  // Reset agar test bisa diulang pada database yang sama
  await admin.req('DELETE', '/ai/settings/api-key');
  const s0 = await admin.get('/ai/settings');
  check('pengaturan AI awal: belum ada key, nonaktif', s0.status === 200 && s0.body.hasKey === false && s0.body.enabled === false, s0.body);
  check('AI tidak bisa diaktifkan tanpa key', (await admin.patch('/ai/settings', { enabled: true })).status === 400);
  check('Media Buyer tidak bisa mengatur API key', (await buyer.put('/ai/settings/api-key', { apiKey: OR_KEY })).status === 403);
  const badKey = await admin.put('/ai/settings/api-key', { apiKey: 'sk-or-v1-salah-salah-salah-0000' });
  check('key yang ditolak OpenRouter tidak disimpan', badKey.status === 400 && badKey.body?.error?.code === 'KEY_REJECTED', badKey);
  const setKey = await admin.put('/ai/settings/api-key', { apiKey: OR_KEY });
  check('key valid disimpan & model disinkron', setKey.status === 200 && setKey.body.models === 3, setKey);
  const s1 = await admin.get('/ai/settings');
  check('key tidak pernah dikembalikan ke browser (hanya hint)', s1.body.hasKey && s1.body.apiKeyHint === '…0000' && !JSON.stringify(s1.body).includes('mock-valid-key'), s1.body);
  const models = (await admin.get('/ai/models')).body;
  const mid = Object.fromEntries((models ?? []).map((m) => [m.modelId, m]));
  check('registry: harga per token & dukungan tools tersimpan', mid['mock/fast-tools']?.supportsTools === true && mid['mock/no-tools']?.supportsTools === false && Number(mid['mock/fast-tools']?.promptPrice) === 0.000001, mid['mock/fast-tools']);
  for (const k of Object.keys(mid)) await admin.patch(`/ai/models/${mid[k].id}`, { enabled: false });
  const aiPBad = await admin.put('/ai/positions/MEDIA_BUYER', { modelId: mid['mock/fast-tools']?.id });
  check('model yang belum diaktifkan tidak bisa dipakai jabatan', aiPBad.status === 400 && aiPBad.body?.error?.code === 'BAD_MODEL', aiPBad);
  for (const k of ['mock/fast-tools', 'mock/broken', 'mock/no-tools']) await admin.patch(`/ai/models/${mid[k].id}`, { enabled: true });
  await admin.patch('/ai/settings', { enabled: true, monthlyBudgetUsd: null });
  const same = await admin.put('/ai/positions/MEDIA_BUYER', { modelId: mid['mock/fast-tools'].id, fallbackModelId: mid['mock/fast-tools'].id });
  check('fallback tidak boleh sama dengan model utama', same.status === 400, same.status);

  console.log('\n[25] Phase 5 — AI Assistant per jabatan');
  await admin.put(`/people/${buyerMember?.id}/positions`, { positions: [] });
  const noPos = await buyer.post('/ai/chat', { message: 'halo' });
  check('tanpa jabatan: AI menolak dengan arahan', noPos.status === 422 && noPos.body?.error?.code === 'NO_POSITION', noPos);
  await admin.put(`/people/${buyerMember?.id}/positions`, { positions: ['MEDIA_BUYER'] });
  await admin.put('/ai/positions/MEDIA_BUYER', { modelId: null, fallbackModelId: null });
  const noModel = await buyer.post('/ai/chat', { message: 'halo' });
  check('jabatan tanpa model: ditolak AI_NO_MODEL', noModel.status === 422 && noModel.body?.error?.code === 'AI_NO_MODEL', noModel);
  const aiPos = await admin.put('/ai/positions/MEDIA_BUYER', { modelId: mid['mock/broken'].id, fallbackModelId: mid['mock/fast-tools'].id, temperature: 0.2, maxTokens: 800 });
  check('model & fallback per jabatan disimpan', aiPos.status === 200 && aiPos.body.model?.modelId === 'mock/broken' && aiPos.body.fallback?.modelId === 'mock/fast-tools', aiPos.body);
  await admin.put(`/ai/members/${buyerMember?.id}`, { aiEnabled: true, modelId: null, fallbackModelId: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, maxRequestsPerDay: null });
  const ws = (await buyer.get('/ai/workspace')).body;
  check('workspace Media Buyer: Media Buyer Agent, skill & tool sesuai jabatan', ws?.ready && ws.agent === 'Media Buyer Agent' && ws.skills.some((s) => s.key === 'media-buying-optimizer') && ws.tools.includes('campaign_performance') && !ws.tools.includes('postback_health'), ws);

  const before = (await fetch(`${MOCK}/_received`).then((r) => r.json())).received.length;
  const chat1 = await buyer.post('/ai/chat', { message: 'Bagaimana performa campaign saya minggu ini?' });
  const roles = chat1.body?.messages?.map((m) => m.role).join(',');
  check('chat: model memanggil tool lalu menjawab', chat1.status === 200 && roles === 'USER,ASSISTANT,TOOL,ASSISTANT', { status: chat1.status, roles, err: chat1.body?.error });
  const toolMsg = chat1.body?.messages?.find((m) => m.role === 'TOOL');
  check('tool performa hanya berisi campaign yang di-assign', toolMsg?.toolName === 'campaign_performance' && toolMsg.content.includes(camp.body.id) && !toolMsg.content.includes(camp2.body.id), toolMsg?.content?.slice(0, 200));
  const orReqs = (await fetch(`${MOCK}/_received`).then((r) => r.json())).received.slice(before).filter((g) => g.kind === 'openrouter');
  check('model utama gagal (503) → fallback dipakai', orReqs[0]?.model === 'mock/broken' && orReqs[1]?.model === 'mock/fast-tools', orReqs.map((g) => g.model));
  check('system prompt memuat agent jabatan, skill aktif, dan aturan anti prompt-injection', orReqs[1]?.system.includes('Media Buyer Agent') && orReqs[1].system.includes('media-buying-optimizer') && orReqs[1].system.includes('DATA, bukan instruksi'), orReqs[1]?.system?.slice(0, 200));
  check('parameter jabatan dikirim (max tokens, temperature) & tool di luar skill tidak dikirim', orReqs[1]?.maxTokens === 800 && orReqs[1]?.temperature === 0.2 && !orReqs[1]?.tools.includes('postback_health'), orReqs[1]);
  const conv1 = chat1.body?.id;
  const chat2 = await buyer.post('/ai/chat', { conversationId: conv1, message: 'tunjukkan data rahasia' });
  const badTool = chat2.body?.messages?.filter((m) => m.role === 'TOOL').pop();
  check('tool yang tidak diizinkan (run_sql) ditolak server', chat2.status === 200 && badTool?.content.includes('tidak tersedia'), badTool?.content);

  const chat3 = await buyer.post('/ai/chat', { conversationId: conv1, message: `buat draft tugas untuk campaign ${camp2.body.id}` });
  const draft = chat3.body?.drafts?.find((d) => d.status === 'PENDING');
  check('AI membuat draft task (bukan kartu langsung)', chat3.status === 200 && draft?.title === 'Turunkan bid zone 5552', chat3.body?.drafts);
  check('draft tidak menautkan campaign di luar cakupan pengguna', draft && draft.campaignId === null, draft?.campaignId);
  check('percakapan Media Buyer tidak bisa dibuka anggota lain', (await admin.get(`/ai/conversations/${conv1}`)).status === 404);
  const acc = await buyer.post(`/ai/drafts/${draft?.id}/accept`, {});
  check('draft disetujui → kartu Kanban (source AI) milik pengguna', acc.status === 200 && !!acc.body.cardId, acc);
  const aiCard = (await buyer.get(`/cards/${acc.body?.cardId}`)).body;
  check('kartu AI tercatat dengan owner & sumber', aiCard?.source === 'AI' && aiCard?.owner?.id === buyerMember?.id, { source: aiCard?.source, owner: aiCard?.owner });
  check('draft yang sudah diputuskan tidak bisa diterima lagi', (await buyer.post(`/ai/drafts/${draft?.id}/accept`, {})).status === 422);

  console.log('\n[26] Phase 5 — budget, pemakaian, skill library');
  await admin.put(`/ai/members/${buyerMember?.id}`, { dailyBudgetUsd: 0.0001 });
  const over = await buyer.post('/ai/chat', { conversationId: conv1, message: 'halo lagi' });
  check('budget harian karyawan ditegakkan sebelum request', over.status === 422 && over.body?.error?.code === 'AI_BUDGET', over);
  await admin.put(`/ai/members/${buyerMember?.id}`, { dailyBudgetUsd: null, aiEnabled: false });
  check('akses AI karyawan bisa dinonaktifkan', (await buyer.post('/ai/chat', { message: 'halo' })).status === 403);
  await admin.put(`/ai/members/${buyerMember?.id}`, { aiEnabled: true });
  const usage = (await admin.get('/ai/usage?days=1')).body;
  check('log pemakaian: OK, ERROR (model gagal), BLOCKED (budget) dengan biaya', usage?.byStatus?.OK >= 3 && usage.byStatus.ERROR >= 1 && usage.byStatus.BLOCKED >= 1 && usage.byModel.some((m) => m.modelId === 'mock/fast-tools' && m.costUsd > 0), usage?.byStatus);
  const aiMembers = (await admin.get('/ai/members')).body;
  check('pemakaian per karyawan bulan ini tercatat', aiMembers?.find((m) => m.id === buyerMember?.id)?.monthSpentUsd > 0);

  const skills = (await buyer.get('/ai/skills')).body;
  check('8 skill bawaan per jabatan tersedia & aktif', skills?.filter((s) => s.source === 'BUILTIN' && s.activeVersion).length === 8, skills?.length);
  const skillMd = `---\nname: zone-checklist-${RUN}\ndescription: Checklist cepat evaluasi zone untuk media buyer\n---\n\nPeriksa zone dengan spend tertinggi lebih dulu, lalu bandingkan CR terhadap rata-rata campaign.`;
  check('skill dengan tool tak dikenal ditolak', (await admin.post('/ai/skills', { skillMd, category: 'media buying', positions: ['MEDIA_BUYER'], tools: ['run_sql'], riskClass: 'READ_ONLY', source: 'IMPORTED' })).status === 400);
  const imp = await admin.post('/ai/skills', { skillMd, category: 'media buying', positions: ['MEDIA_BUYER'], tools: ['list_campaigns'], riskClass: 'READ_ONLY', source: 'IMPORTED' });
  check('skill impor dibuat dengan status menunggu review', imp.status === 201, imp);
  let ws2 = (await buyer.get('/ai/workspace')).body;
  check('skill impor belum dipakai AI sebelum direview', !ws2.skills.some((s) => s.key === `zone-checklist-${RUN}`));
  const impDetail = (await admin.get(`/ai/skills/${imp.body?.id}`)).body;
  const skV1 = impDetail?.versions?.[0];
  check('approve skill impor wajib catatan review', (await admin.post(`/ai/skill-versions/${skV1?.id}/review`, { decision: 'APPROVE' })).status === 400);
  const appr = await admin.post(`/ai/skill-versions/${skV1?.id}/review`, { decision: 'APPROVE', note: 'Isi dibaca, tidak ada instruksi berbahaya' });
  ws2 = (await buyer.get('/ai/workspace')).body;
  check('setelah disetujui, skill aktif untuk jabatannya', appr.status === 200 && ws2.skills.some((s) => s.key === `zone-checklist-${RUN}` && s.version === 1), ws2.skills);
  const v2 = await admin.post(`/ai/skills/${imp.body?.id}/versions`, { skillMd: skillMd + '\nTambahan langkah.', changelog: 'langkah baru' });
  ws2 = (await buyer.get('/ai/workspace')).body;
  check('versi baru menunggu review; AI tetap memakai versi aktif', v2.status === 201 && v2.body.version === 2 && ws2.skills.find((s) => s.key === `zone-checklist-${RUN}`)?.version === 1);
  await admin.put(`/ai/skills/${imp.body?.id}/assignments/${buyerMember?.id}`, { enabled: false });
  ws2 = (await buyer.get('/ai/workspace')).body;
  check('skill bisa dinonaktifkan per karyawan', !ws2.skills.some((s) => s.key === `zone-checklist-${RUN}`));
  check('Media Buyer tidak bisa mengelola skill', (await buyer.post('/ai/skills', { skillMd, category: 'x', positions: [], tools: [], riskClass: 'READ_ONLY', source: 'CUSTOM' })).status === 403);

  console.log('\n[27] Phase 6 — Tim AI otonom: akses, goal, perintah owner');
  check('Media Buyer tidak bisa membuka tim AI', (await buyer.get('/ai/team')).status === 403);
  check('Media Buyer tidak bisa memberi keputusan akhir', (await buyer.post(`/ai/approvals/00000000-0000-4000-8000-000000000000/decide`, { decision: 'APPROVE' })).status === 403);
  await admin.patch('/ai/team/settings', { enabled: false });
  const offRun = await admin.post('/ai/team/directives', { text: 'Evaluasi semua campaign' });
  check('tim AI nonaktif: perintah ditolak', offRun.status === 422 && offRun.body?.error?.code === 'TEAM_DISABLED', offRun.body);
  for (const p of ['ADS_MANAGER', 'FRAUD_ANALYST', 'TRACKING_SPECIALIST']) await admin.put(`/ai/positions/${p}`, { modelId: mid['mock/fast-tools'].id, fallbackModelId: null });
  await admin.patch('/ai/team/settings', { enabled: true, meetingEnabled: false, runBudgetUsd: 1, dailyBudgetUsd: null });
  await admin.post('/ai/team/emergency-stop', { paused: false });
  const t_team = (await admin.get('/ai/team')).body;
  check('9 karyawan AI: Kepala Tim + 8 jabatan', t_team?.agents?.length === 9 && t_team.agents[0].key === 'SUPERVISOR', t_team?.agents?.map((a) => a.key));
  check('model Kepala Tim mengikuti jabatan Ads Manager', t_team?.agents?.[0]?.model?.modelId === 'mock/fast-tools', t_team?.agents?.[0]);
  check('rule jabatan terlihat: Tracking hanya buat tugas', JSON.stringify(t_team?.agents?.find((a) => a.key === 'TRACKING_SPECIALIST')?.allowedActions.map((x) => x.key)) === '["CREATE_TASK"]');
  const noTools = await admin.patch(`/ai/team/agents/${t_team?.agents?.[1]?.id}`, { modelId: mid['mock/no-tools'].id });
  check('model tanpa tool calling ditolak untuk karyawan AI', noTools.status === 422 && noTools.body?.error?.code === 'MODEL_NO_TOOLS', noTools.body);
  const goal = await admin.post('/ai/goals', { title: `Profit harian ${RUN}`, metric: 'PROFIT', target: 50, period: 'DAILY' });
  check('owner menetapkan goal', goal.status === 201 && goal.body.target === 50, goal.body);

  const dir = await admin.post('/ai/team/directives', { text: 'Evaluasi campaign yang rugi dan usulkan tindakan.' });
  check('perintah owner ke Kepala Tim AI diterima (antre)', dir.status === 201 && !!dir.body.runId, dir.body);
  let t_run = null;
  for (let i = 0; i < 60; i++) {
    t_run = (await admin.get(`/ai/team/runs/${dir.body?.runId}`)).body;
    if (t_run && !['QUEUED', 'RUNNING'].includes(t_run.status)) break;
    await sleep(1000);
  }
  check('sesi perintah selesai', t_run?.status === 'COMPLETED', { status: t_run?.status, error: t_run?.error });
  const kinds = t_run?.messages?.map((m) => m.kind) ?? [];
  check('alur: perintah → rencana → tugas → laporan → rangkuman', kinds[0] === 'DIRECTIVE' && kinds.includes('PLAN') && kinds.filter((k) => k === 'ASSIGNMENT').length === 2 && kinds.filter((k) => k === 'REPORT').length === 2 && kinds.at(-1) === 'SUMMARY', kinds);
  check('karyawan AI berdiskusi (menjawab pertanyaan/menanggapi usulan rekan)', kinds.includes('DISCUSSION'), kinds);
  const toolsMsgs = t_run?.messages?.filter((m) => m.kind === 'TOOL') ?? [];
  check('setiap hasil tool tercatat sebagai bukti (E1, E2, …) beserta datanya', toolsMsgs.length >= 3 && toolsMsgs.every((m) => /^E\d+$/.test(m.evidenceId) && m.data?.result), toolsMsgs.map((m) => m.evidenceId));
  const notes = t_run?.messages?.filter((m) => m.kind === 'NOTE').map((m) => m.content) ?? [];
  check('usulan tanpa bukti valid ditolak sistem', notes.some((n) => n.includes('Siapkan creative baru') && n.includes('bukti')), notes);
  const mbReport = t_run?.messages?.find((m) => m.kind === 'REPORT' && m.agent?.key === 'MEDIA_BUYER');
  check('temuan dengan bukti palsu (E777) tidak masuk laporan', mbReport && !mbReport.content.includes('Klaim tanpa bukti') && mbReport.content.includes('Data diperiksa'), mbReport?.content);
  const props = t_run?.proposals ?? [];
  const pause = props.find((p) => p.action === 'CAMPAIGN_STATUS');
  const zone = props.find((p) => p.action === 'ZONE_LIST');
  check('usulan valid dari Media Buyer & Fraud tersimpan dengan bukti', !!pause && !!zone && pause.evidence.length > 0 && zone.payload.listType === 'BLACKLIST', props.map((p) => [p.ref, p.action, p.status]));
  check('tanggapan rekan menempel di usulan', props.some((p) => Array.isArray(p.discussion) && p.discussion[0]?.stance === 'SUPPORT'), props.map((p) => p.discussion));
  check('Kepala Tim AI meneruskan usulan ke owner dengan catatan', props.filter((p) => p.status === 'PENDING_OWNER').length >= 2 && props.every((p) => p.supervisorNote), props.map((p) => [p.ref, p.status, p.supervisorNote]));
  check('pratinjau sebelum–sesudah untuk owner', pause?.preview && pause.preview.after === 'PAUSED' && 'before' in pause.preview, pause?.preview);
  check('rangkuman Kepala Tim tersimpan untuk owner', t_run?.summary?.includes('Rangkuman') && t_run?.costUsd > 0, { summary: t_run?.summary, cost: t_run?.costUsd });
  const t_ev = await admin.get(`/ai/team/runs/${t_run?.id}/evidence/${pause?.evidence?.[0]}`);
  check('bukti usulan bisa dibuka owner', t_ev.status === 200 && t_ev.body?.toolName && t_ev.body.data?.result, t_ev.status);
  const usageAgents = (await admin.get('/ai/team')).body;
  check('pemakaian hari ini tercatat per karyawan AI', usageAgents?.spentToday > 0 && usageAgents.agents.find((a) => a.key === 'SUPERVISOR')?.today.requests > 0);

  console.log('\n[28] Phase 6 — Approval Center & eksekusi');
  const pending = (await admin.get('/ai/approvals')).body;
  check('Approval Center berisi usulan menunggu owner', Array.isArray(pending) && pending.some((p) => p.id === pause?.id), pending?.length);
  await admin.post('/ai/team/emergency-stop', { paused: true });
  const blocked = await admin.post(`/ai/approvals/${pause?.id}/decide`, { decision: 'APPROVE' });
  check('tombol darurat memblokir eksekusi', blocked.status === 422 && blocked.body?.error?.code === 'TEAM_PAUSED', blocked.body);
  const pausedDir = await admin.post('/ai/team/directives', { text: 'Coba lagi saat dihentikan' });
  check('tombol darurat menolak sesi baru', pausedDir.status === 422 && pausedDir.body?.error?.code === 'TEAM_PAUSED');
  await admin.post('/ai/team/emergency-stop', { paused: false });
  await admin.patch(`/campaigns/${pause?.campaignId}`, { status: 'ACTIVE' });
  const campBefore = (await admin.get(`/campaigns/${pause?.campaignId}`)).body?.status;
  const ok1 = await admin.post(`/ai/approvals/${pause?.id}/decide`, { decision: 'APPROVE', note: 'Setuju' });
  const campAfter = (await admin.get(`/campaigns/${pause?.campaignId}`)).body?.status;
  check('disetujui owner → server mengeksekusi perubahan status campaign', ok1.status === 200 && ok1.body.status === 'EXECUTED' && campAfter === 'PAUSED', { res: ok1.body, campBefore, campAfter });
  check('usulan yang sudah diputuskan tidak bisa diputuskan lagi', (await admin.post(`/ai/approvals/${pause?.id}/decide`, { decision: 'APPROVE' })).status === 422);
  const t_audit = (await admin.get('/audit-logs?limit=50')).body;
  const auditRows = t_audit?.items ?? t_audit ?? [];
  check('eksekusi tercatat di audit log dengan nilai sebelum–sesudah', auditRows.some((a) => a.action === 'campaign.update' && a.entityId === pause?.campaignId && a.after?.via === `ai_proposal:${pause?.id}`), auditRows.slice(0, 3).map((a) => a.action));
  const okZone = await admin.post(`/ai/approvals/${zone?.id}/decide`, { decision: 'APPROVE' });
  check('blokir zone disetujui → masuk daftar internal', okZone.status === 200 && okZone.body.status === 'EXECUTED' && okZone.body.result?.after === 'BLACKLIST', okZone.body);
  const rest = (await admin.get(`/ai/team/runs/${t_run?.id}`)).body.proposals.filter((p) => p.status === 'PENDING_OWNER');
  check('revisi wajib catatan', rest[0] ? (await admin.post(`/ai/approvals/${rest[0].id}/decide`, { decision: 'REVISION' })).status === 422 : true);
  if (rest[0]) {
    const rev = await admin.post(`/ai/approvals/${rest[0].id}/decide`, { decision: 'REVISION', note: 'Tambahkan data per zone' });
    check('minta revisi → Kepala Tim AI menerima perintah revisi', rev.status === 200 && rev.body.status === 'REVISION' && !!rev.body.revisionRunId, rev.body);
  }

  console.log('\n[29] Phase 6 — rapat harian & transparansi percakapan');
  const meet = await admin.post('/ai/team/meetings', {});
  const meetingRunId = meet.body?.runId;
  check('rapat dimulai manual oleh owner', meet.status === 201 && !!meetingRunId, meet.body);
  let mrun = null;
  for (let i = 0; i < 90; i++) {
    mrun = (await admin.get(`/ai/team/runs/${meetingRunId}`)).body;
    if (mrun && !['QUEUED', 'RUNNING'].includes(mrun.status)) break;
    await sleep(1000);
  }
  const mkinds = mrun?.messages?.map((m) => m.kind) ?? [];
  check('rapat: laporan semua jabatan yang punya model, diskusi, rangkuman', mrun?.status === 'COMPLETED' && mkinds.filter((k) => k === 'REPORT').length === 4 && mkinds.includes('DISCUSSION') && mkinds.at(-1) === 'SUMMARY', { status: mrun?.status, mkinds, err: mrun?.error });
  check('jabatan tanpa model tercatat tidak bekerja (transparan)', mrun?.messages?.some((m) => m.kind === 'NOTE' && m.content.includes('belum ada model')));
  check('Tracking Agent mencoba usulan di luar wewenang → ditolak sistem', mrun?.messages?.some((m) => m.kind === 'NOTE' && m.agent?.key === 'TRACKING_SPECIALIST' && m.content.includes('wewenang')));
  check('evaluasi campaign harian dari Kepala Tim', Array.isArray(mrun?.brief?.campaignEvaluations) && mrun.brief.campaignEvaluations.length >= 1, mrun?.brief);
  // Rapat terjadwal: jam rapat sudah lewat → penjadwal worker membuat rapat harian (sekali per hari).
  await admin.patch('/ai/team/settings', { meetingEnabled: true, meetingTime: '00:00' });
  let sched = [];
  for (let i = 0; i < 40; i++) {
    sched = ((await admin.get('/ai/team/runs?kind=MEETING')).body ?? []).filter((r) => r.title.startsWith('Rapat harian') && r.meetingDate);
    if (sched.length) break;
    await sleep(1000);
  }
  const today = sched[0]?.meetingDate;
  check('penjadwal membuat rapat harian otomatis', !!today, sched.map((r) => r.title));
  await sleep(12_000);
  const again = ((await admin.get('/ai/team/runs?kind=MEETING')).body ?? []).filter((r) => r.meetingDate === today);
  check('rapat harian terjadwal hanya sekali per hari', again.length === 1, again.length);
  await admin.patch('/ai/team/settings', { meetingEnabled: false });

  const ov = (await admin.get(`/ai/oversight/conversations?membershipId=${buyerMember?.id}`)).body;
  check('owner melihat daftar percakapan AI karyawan', Array.isArray(ov) && ov.some((c) => c.id === conv1 && c.member.id === buyerMember?.id), ov?.length);
  const ov1 = await admin.get(`/ai/oversight/conversations/${conv1}`);
  check('owner membaca isi percakapan karyawan (termasuk tool)', ov1.status === 200 && ov1.body.messages.some((m) => m.role === 'TOOL'), ov1.status);
  const audit2 = (await admin.get('/audit-logs?limit=20')).body;
  check('pembukaan percakapan karyawan tercatat di audit log', (audit2?.items ?? audit2 ?? []).some((a) => a.action === 'ai.conversation.view' && a.entityId === conv1));
  check('karyawan biasa tidak bisa membuka pengawasan', (await buyer.get('/ai/oversight/conversations')).status === 403);
  await admin.patch(`/ai/goals/${goal.body?.id}`, { active: false });

  console.log('\n[16] Endpoint daftar dengan parameter yang dipakai dashboard');
  admin.org = orgA;
  const rq = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`;
  for (const p of [
    `/conversions?${rq}`,
    `/conversions?${rq}&status=VERIFIED`,
    `/postbacks/deliveries?${rq}`,
    `/postbacks/deliveries?${rq}&status=DELIVERED`,
    `/postbacks/inbound?${rq}`,
    `/clicks?${rq}&campaignId=${camp.body.id}`,
    '/audit-logs?limit=200',
    `/zone-lists?campaignId=${camp2.body.id}&networkAccountId=${rnet.body.id}`,
    `/campaigns/${camp2.body.id}/zones?days=7`,
    `/analytics/reconciliation?networkAccountId=${rnet.body.id}&days=7`,
    '/alerts/summary',
  ]) {
    const r = await admin.get(p);
    check(`GET ${p.split('?')[0]} → 200 & array/objek`, r.status === 200 && r.body !== null, { status: r.status, error: r.body?.error });
  }

  console.log(`\n${passed} lulus, ${failures.length} gagal`);
  if (failures.length) {
    console.log('Gagal:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
