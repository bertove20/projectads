/**
 * Sumber JS SDK yang disajikan tracker di GET /sdk.js?k=<sdkKey> (read.md Bagian D).
 *
 * Pemasangan di landing page:
 *   <script>window.eaip=window.eaip||function(){(window.eaipq=window.eaipq||[]).push(arguments)}</script>
 *   <script async src="https://trk.example.com/sdk.js?k=SDK_KEY"></script>
 *
 * API:
 *   eaip('track', 'registration_started', { form: 'daftar' })
 *   eaip('consent', true)            // bila website mewajibkan consent
 *   <a data-eaip-clickout href="#">  // otomatis diarahkan ke /click-out?cid=…
 *
 * Semua event yang dikirim browser berstatus OBSERVED dan tidak pernah dikirim sebagai konversi.
 */

export interface SdkConfig {
  key: string;
  endpoint: string;
  clickOut: string;
  requireConsent: boolean;
}

export function sdkScript(cfg: SdkConfig): string {
  // JSON.stringify + escape "<" agar konfigurasi aman disisipkan ke dalam JS
  const conf = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `/* EAIP SDK v1 */
(function (w, d) {
  'use strict';
  if (w.__eaipLoaded) return;
  w.__eaipLoaded = true;
  var CFG = ${conf};
  var TYPES = ['page_view', 'landing_view', 'registration_started', 'registration_submitted', 'registration_success_observed', 'custom_event'];
  var K = { q: 'eaip_q', sid: 'eaip_sid', cid: 'eaip_cid', consent: 'eaip_consent', lv: 'eaip_lv' };
  var MAX_QUEUE = 50, MAX_AGE = 864e5, BATCH = 25, SESSION_MS = 18e5;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function get(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { w.localStorage.setItem(k, v); } catch (e) {} }
  function uuid() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    var b = new Uint8Array(16); (w.crypto || w.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // Click ID platform: dari ?cid= (datang dari tracker) lalu disimpan first-party 30 hari
  var cid = null;
  try { cid = new URLSearchParams(w.location.search).get('cid'); } catch (e) {}
  if (cid && UUID_RE.test(cid)) {
    set(K.cid, JSON.stringify({ v: cid, t: Date.now() }));
  } else {
    cid = null;
    try { var s = JSON.parse(get(K.cid) || 'null'); if (s && Date.now() - s.t < 30 * MAX_AGE) cid = s.v; } catch (e) {}
  }

  function session() {
    var now = Date.now(), s = null;
    try { s = JSON.parse(get(K.sid) || 'null'); } catch (e) {}
    if (!s || now - s.t > SESSION_MS) s = { v: uuid(), t: now };
    s.t = now; set(K.sid, JSON.stringify(s));
    return s.v;
  }

  var queue = [];
  try { queue = JSON.parse(get(K.q) || '[]') || []; } catch (e) { queue = []; }
  queue = queue.filter(function (e) { return e && Date.now() - e.ts < MAX_AGE; }).slice(-MAX_QUEUE);
  function persist() { set(K.q, JSON.stringify(queue.slice(-MAX_QUEUE))); }

  function consentOk() { return !CFG.requireConsent || get(K.consent) === '1'; }

  var timer = null, sending = false, backoff = 2000;
  function schedule(ms) { if (timer) clearTimeout(timer); timer = setTimeout(flush, ms); }

  function payload(batch) { return JSON.stringify({ k: CFG.key, events: batch }); }

  function flush() {
    timer = null;
    if (sending || !queue.length || !consentOk()) return;
    var batch = queue.slice(0, BATCH);
    sending = true;
    fetch(CFG.endpoint, { method: 'POST', body: payload(batch), headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit' })
      .then(function (r) {
        sending = false;
        // 2xx = tersimpan; 4xx = ditolak permanen (jangan diulang); 5xx/429 = coba lagi
        if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) {
          var ids = {}; batch.forEach(function (e) { ids[e.id] = 1; });
          queue = queue.filter(function (e) { return !ids[e.id]; }); persist(); backoff = 2000;
          if (queue.length) schedule(0);
        } else { backoff = Math.min(backoff * 2, 60000); schedule(backoff); }
      })
      .catch(function () { sending = false; backoff = Math.min(backoff * 2, 60000); schedule(backoff); });
  }

  function beacon() {
    if (!queue.length || !consentOk() || !navigator.sendBeacon) return;
    var batch = queue.slice(0, BATCH);
    if (navigator.sendBeacon(CFG.endpoint, new Blob([payload(batch)], { type: 'text/plain' }))) {
      var ids = {}; batch.forEach(function (e) { ids[e.id] = 1; });
      queue = queue.filter(function (e) { return !ids[e.id]; }); persist();
    }
  }

  function track(type, name, props) {
    if (TYPES.indexOf(type) < 0) { if (w.console) console.warn('[eaip] jenis event tidak didukung:', type); return; }
    var clean = {};
    if (props && typeof props === 'object') {
      Object.keys(props).slice(0, 10).forEach(function (k) {
        var v = props[k];
        if (typeof v === 'string') clean[k] = v.slice(0, 100);
        else if (typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
      });
    }
    queue.push({ id: uuid(), t: type, n: type === 'custom_event' ? String(name || '').slice(0, 60) : undefined, p: w.location.pathname.slice(0, 300), ts: Date.now(), sid: session(), cid: cid || undefined, props: clean });
    queue = queue.slice(-MAX_QUEUE); persist();
    schedule(queue.length >= 10 ? 0 : 1000);
  }

  function consent(granted) {
    set(K.consent, granted ? '1' : '0');
    if (!granted) { queue = []; persist(); } else schedule(0);
  }

  function clickOutUrl() { return cid ? CFG.clickOut + '?cid=' + encodeURIComponent(cid) : null; }

  function wireLinks() {
    var url = clickOutUrl();
    if (!url) return;
    var links = d.querySelectorAll('[data-eaip-clickout]');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', url);
  }

  function api(cmd) {
    var a = Array.prototype.slice.call(arguments, 1);
    if (cmd === 'track') track(a[0], a[1] && typeof a[1] === 'object' ? undefined : a[1], a[1] && typeof a[1] === 'object' ? a[1] : a[2]);
    else if (cmd === 'consent') consent(!!a[0]);
    else if (cmd === 'clickOutUrl') return clickOutUrl();
  }

  var pending = w.eaipq || [];
  w.eaip = api;
  w.eaip.clickOutUrl = clickOutUrl;

  track('page_view');
  if (cid) {
    var lv = get(K.lv);
    if (lv !== cid) { set(K.lv, cid); track('landing_view'); }
  }
  for (var i = 0; i < pending.length; i++) api.apply(null, pending[i]);

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', wireLinks); else wireLinks();
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') beacon(); });
  w.addEventListener('pagehide', beacon);
  w.addEventListener('online', function () { schedule(0); });
})(window, document);
`;
}
