/**
 * Uji JS SDK di Chromium sungguhan terhadap stack lokal (compose.local.yaml + dashboard dev di :3000).
 *   npx playwright install chromium   (sekali)
 *   ADMIN_MFA_SECRET=... node apps/api/test/sdk.browser.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticator } = require('otplib');

const DASH = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
const TRK = process.env.TRACKER_URL ?? 'http://localhost:4100';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' — ' + JSON.stringify(detail).slice(0, 300)}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Login dashboard (MFA)
await page.goto(`${DASH}/login`);
await page.fill('input[type=email]', process.env.ADMIN_EMAIL ?? 'admin@example.com');
await page.fill('input[type=password]', process.env.ADMIN_PASSWORD ?? 'Local-Test-Pass-2026!');
await page.click('button[type=submit]');
await page.waitForURL('**/mfa');
for (let i = 0; i < 3; i++) {
  await page.fill('input[autocomplete=one-time-code]', authenticator.generate(process.env.ADMIN_MFA_SECRET));
  await page.click('button[type=submit]');
  try { await page.waitForURL((u) => !u.pathname.startsWith('/mfa'), { timeout: 8000 }); break; } catch { await page.waitForTimeout(31000 - (Date.now() % 30000)); }
}
const me = await (await page.request.get(`${DASH}/api/v1/auth/me`)).json();
const org = me.organizations[0].id;
const api = async (method, path, data) => {
  const r = await page.request.fetch(`${DASH}/api/v1${path}`, { method, data, headers: { 'x-organization-id': org, origin: DASH } });
  return r.json();
};

// Website + SDK key untuk dua domain: biasa & wajib consent
const domA = `lp-${RUN}.example.com`;
const domB = `eu-${RUN}.example.com`;
const siteA = await api('POST', '/websites', { name: `Browser A ${RUN}`, domain: domA });
const keyA = (await api('POST', `/websites/${siteA.id}/sdk-key`)).sdkKey;
const siteB = await api('POST', '/websites', { name: `Browser B ${RUN}`, domain: domB });
const keyB = (await api('POST', `/websites/${siteB.id}/sdk-key`)).sdkKey;
await api('PATCH', `/websites/${siteB.id}`, { requireConsent: true });

// Click ID asli dari campaign aktif
const campaigns = await api('GET', '/campaigns');
const active = campaigns.find((c) => c.status === 'ACTIVE' && c.flowType === 'DIRECT');
const loc = (await page.request.get(`${TRK}/c/${active.token}?click_id=BR-${RUN}`, { maxRedirects: 0, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36', 'accept-language': 'id' } })).headers().location;
const cid = new URL(loc).searchParams.get('sub');
check('click ID didapat dari tracker', /^[0-9a-f-]{36}$/.test(cid ?? ''), loc);

await new Promise((r) => setTimeout(r, 31000)); // cache website di tracker 30 detik (consent baru saja diubah)

const html = (key) => `<!doctype html><html><head>
<script>window.eaip=window.eaip||function(){(window.eaipq=window.eaipq||[]).push(arguments)}</script>
<script>eaip('track','custom_event','sebelum_sdk_dimuat',{step:1})</script>
<script async src="${TRK}/sdk.js?k=${key}"></script></head>
<body><h1>Promo</h1><button id="daftar" onclick="eaip('track','registration_started',{plan:'gold',email:'x@y.com'})">Daftar</button>
<a id="cta" data-eaip-clickout href="#">Lanjut</a></body></html>`;

// Halaman landing "di" domain terdaftar (disajikan lewat intercept); request ke tracker diteruskan dari Node
// (menghindari pembatasan Private Network Access Chrome untuk localhost; header Origin tetap dari browser).
const lp = await ctx.newPage();
await lp.route(`http://${domA}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html(keyA) }));
await lp.route(`http://${domB}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html(keyB) }));
await lp.route(`${TRK}/**`, async (r) => r.fulfill({ response: await r.fetch() }));

await lp.goto(`http://${domA}/promo?cid=${cid}&utm_source=test`);
await lp.waitForFunction(() => window.__eaipLoaded === true);
check('SDK termuat di halaman', true);
const href = await lp.getAttribute('#cta', 'href');
check('link click-out otomatis berisi cid', href === `${TRK}/click-out?cid=${cid}`, href);
await lp.click('#daftar');
await lp.waitForTimeout(2500); // batching 1 detik
await lp.goto('about:blank'); // memicu pagehide → sendBeacon
await lp.waitForTimeout(1500);

const evA = await api('GET', `/events?websiteId=${siteA.id}`);
const types = evA.map((e) => e.type).sort();
check('event browser tersimpan: page_view, landing_view, custom (antrean sebelum SDK), registration_started', ['CUSTOM_EVENT', 'LANDING_VIEW', 'PAGE_VIEW', 'REGISTRATION_STARTED'].every((t) => types.includes(t)), types);
const reg = evA.find((e) => e.type === 'REGISTRATION_STARTED');
check('event terhubung ke campaign & tanpa email', reg?.campaignId === active.id && reg?.props?.plan === 'gold' && !reg?.props?.email, reg);
check('path tanpa query string', evA.every((e) => e.path === '/promo'), evA.map((e) => e.path));
check('tidak ada event ganda', evA.length === 4, evA.length);

// Kunjungan ulang dengan cid sama → landing_view tidak berulang
await lp.goto(`http://${domA}/promo?cid=${cid}`);
await lp.waitForFunction(() => window.__eaipLoaded === true);
await lp.waitForTimeout(2500);
const evA2 = await api('GET', `/events?websiteId=${siteA.id}`);
check('landing_view hanya sekali per click ID', evA2.filter((e) => e.type === 'LANDING_VIEW').length === 1, evA2.map((e) => e.type));

// Website wajib consent: tidak ada event sebelum consent, terkirim setelah consent
const lp2 = await ctx.newPage();
await lp2.route(`http://${domB}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html(keyB) }));
await lp2.route(`${TRK}/**`, async (r) => r.fulfill({ response: await r.fetch() }));
await lp2.goto(`http://${domB}/promo`);
await lp2.waitForFunction(() => window.__eaipLoaded === true);
await lp2.waitForTimeout(2500);
check('consent wajib: tidak ada event sebelum consent', (await api('GET', `/events?websiteId=${siteB.id}`)).length === 0);
await lp2.evaluate(() => window.eaip('consent', true));
await lp2.waitForTimeout(2500);
const evB = await api('GET', `/events?websiteId=${siteB.id}`);
check('setelah consent: antrean terkirim', evB.length >= 2, evB.map((e) => e.type));

// Click-out dari link mengarah ke offer dengan click ID yang sama
const co = await page.request.get(href, { maxRedirects: 0 });
check('click-out → offer dengan click ID yang sama', co.status() === 302 && co.headers().location.includes(cid), co.headers().location);

console.log(`\n${pass} lulus, ${fail} gagal`);
await browser.close();
process.exit(fail ? 1 : 0);
