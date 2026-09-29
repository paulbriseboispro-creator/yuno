#!/usr/bin/env node
// Audit des pages de la Console avec un compte démo : pour chaque route, temps
// jusqu'à la fin du chargement (plus de squelette ni de spinner, plus de
// requête Supabase en vol), requêtes lentes, en erreur ou EN DOUBLE, et
// largeur utile (écart gauche / droite entre la zone de contenu et le contenu
// réel — ~0-24 px = pleine largeur).
//
//   . scripts/ci-web-env.sh; export VITE_APP_BASE_URL=http://127.0.0.1:4173
//   npx vite preview --host 127.0.0.1 --port 4173 &
//   node scripts/demo/audit-pages.mjs owner routes.txt /tmp/audit.json 1920
//   SHOTS=/tmp/shots node scripts/demo/audit-pages.mjs organizer routes.txt
//
// La navigation se fait DANS la SPA (pushState + popstate), comme un clic
// dans la barre latérale : c'est ce que vit le pro, pas un rechargement.
import fs from 'node:fs';
import { open } from './drive.mjs';

const [,, as = 'owner', listArg = '', outFile = '/tmp/audit.json', width = '1920'] = process.argv;
const routes = fs.readFileSync(listArg, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const page = await open({ as, go: routes[0] });
await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: +width, height: 1080, deviceScaleFactor: 1, mobile: false });
await page.cdp.send('Network.enable');
const inflight = new Map();
let reqs = [];
page.cdp.on('Network.requestWillBeSent', (p) => { if (/supabase\.co/.test(p.request.url)) inflight.set(p.requestId, { url: p.request.url, method: p.request.method, t: p.timestamp }); });
page.cdp.on('Network.responseReceived', (p) => { const r = inflight.get(p.requestId); if (r) r.status = p.response.status; });
const done = (p) => { const r = inflight.get(p.requestId); if (!r) return; inflight.delete(p.requestId); reqs.push({ ...r, ms: Math.round((p.timestamp - r.t) * 1000), failed: p.errorText }); };
page.cdp.on('Network.loadingFinished', done);
page.cdp.on('Network.loadingFailed', done);

await page.goto(routes[0]);
await new Promise((r) => setTimeout(r, 3000));
const results = [];
for (const route of routes) {
  reqs = []; page.logs.length = 0;
  const t0 = Date.now();
  await page.eval(`(() => { history.pushState({}, '', ${JSON.stringify(route)}); dispatchEvent(new PopStateEvent('popstate')); })()`);
  let stable = 0, last = -1, end = null, firstContent = null;
  while (Date.now() - t0 < 30000) {
    await new Promise((r) => setTimeout(r, 150));
    let s;
    try {
      s = await page.eval(`(() => { const m = document.querySelector('main') || document.body;
        const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        // Un point « en direct » (6 px) pulse pour toujours : ce n'est pas un squelette.
        const sk = [...m.querySelectorAll('.animate-pulse')].filter((e) => vis(e) && e.getBoundingClientRect().width >= 12).length;
        const sp = [...m.querySelectorAll('.animate-spin')].filter(vis).length;
        return [sk, sp, (m.innerText||'').length, location.pathname + location.search]; })()`);
    } catch { continue; }
    const [sk, sp, len] = s;
    if (firstContent == null && sk === 0 && sp === 0 && len > 200) firstContent = Date.now() - t0;
    const busy = sk > 0 || sp > 0 || inflight.size > 0;
    stable = !busy && len === last ? stable + 1 : 0;
    last = len;
    if (stable >= 4) { end = Date.now() - t0 - 600; break; }
  }
  const lay = await page.eval(`(() => { const m = document.querySelector('main'); if (!m) return null;
    const mr = m.getBoundingClientRect();
    let minL = 1e9, maxR = -1e9;
    for (const e of m.querySelectorAll('*')) {
      if (e.closest('header, [data-full-bleed]')) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.width >= mr.width - 2) continue;
      const st = getComputedStyle(e);
      if (st.position === 'fixed' || st.visibility === 'hidden' || st.opacity === '0') continue;
      if (!(e.children.length === 0 && (e.innerText||'').trim()) && !(st.backgroundColor !== 'rgba(0, 0, 0, 0)' || st.borderTopWidth !== '0px')) continue;
      minL = Math.min(minL, r.left); maxR = Math.max(maxR, r.right);
    }
    return { mainW: Math.round(mr.width), gapL: Math.round(minL - mr.left), gapR: Math.round(mr.right - maxR) }; })()`);
  const slow = reqs.filter((r) => r.ms > 800).sort((a, b) => b.ms - a.ms).slice(0, 6)
    .map((r) => `${r.ms}ms ${r.status ?? r.failed} ${r.method} ${r.url.replace(/^https:\/\/[^/]+/, '').slice(0, 140)}`);
  const errs = reqs.filter((r) => r.failed || (r.status && r.status >= 400))
    .map((r) => `${r.status ?? r.failed} ${r.url.replace(/^https:\/\/[^/]+/, '').slice(0, 140)}`).slice(0, 6);
  const cons = page.logs.filter((l) => l.level === 'error' || l.level === 'exception').map((l) => l.text.slice(0, 200)).slice(0, 4);
  const cnt = {}; for (const r of reqs) { const k = r.method + ' ' + r.url.replace(/^https:\/\/[^/]+/, '').replace(/(gte|lte|gt|lt)\.\d{4}-[^&]+/g, 'T'); cnt[k] = (cnt[k] || 0) + 1; }
  const dups = Object.entries(cnt).filter(([, n]) => n > 1).map(([k, n]) => n + 'x ' + k.slice(0, 150));
  const res = { route, dups, doneMs: end, firstContentMs: firstContent, nReq: reqs.length, maxReqMs: Math.max(0, ...reqs.map((r) => r.ms)), slow, errs, cons, lay };
  results.push(res);
  console.log(`${end == null ? 'TIMEOUT' : end + 'ms'}\treq=${reqs.length}\tmax=${res.maxReqMs}\tgap=${lay?.gapL}/${lay?.gapR}\t${route}${errs.length ? '\tERR ' + errs.length : ''}`);
  if (process.env.SHOTS) await page.shot(`${process.env.SHOTS}/${as}${route.replace(/[/?=&]/g, '_')}.png`).catch(() => {});
}
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
await page.close();
process.exit(0);
