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
  check('daftar campaign RollerAds + status pemetaan', remote.status === 200 && remote.body.find((r) => r.campaign_id === 9001)?.mappedTo?.id === camp2.body.id, remote.body);

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
