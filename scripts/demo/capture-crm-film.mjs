#!/usr/bin/env node
// Captures des VRAIS écrans de la Console Yuno CRM (compte démo crm@womber.fr)
// pour le film « Yuno CRM — 30 s ». Lecture seule : aucun clic d'envoi, aucune création.
//
//   node scripts/demo/capture-crm-film.mjs --out ~/Desktop/yuno-crm-captures
//
// Sortie : <out>/<nom>.png (1440×900 @2x) + <nom>.full.png (pleine page) +
// <nom>.json (texte et position des éléments visibles, pour caler le curseur).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { open } from './drive.mjs';

const argOut = process.argv.indexOf('--out');
const OUT = path.resolve((argOut > 0 ? process.argv[argOut + 1] : '~/Desktop/yuno-crm-captures').replace(/^~/, os.homedir()));
fs.mkdirSync(OUT, { recursive: true });
const HOST = process.env.CRM_HOST || 'https://crm.yunoapp.eu';
const done = [];
const fail = [];

const page = await open({ as: 'crm', go: HOST + '/crm', lang: 'fr', device: 'desktop' });
await page.eval(`(() => { const s = document.createElement('style'); s.textContent = '*{caret-color:transparent!important} ::-webkit-scrollbar{display:none}'; document.head.appendChild(s); })()`).catch(() => {});

async function settle(ms = 1800) { await page.waitForBoot(20000).catch(() => {}); await page.sleep(ms); }

async function dump(name) {
  const items = await page.eval(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('button,a,input,textarea,select,h1,h2,h3,[role="tab"],[role="row"],tr,[role="dialog"],aside')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
      out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), href: el.getAttribute('href'),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return { url: location.href, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, items };
  })()`);
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(items, null, 1));
}

async function shoot(name, { full = true } = {}) {
  await page.shot(path.join(OUT, name + '.png'));
  if (full) await page.shot(path.join(OUT, name + '.full.png'), { full: true });
  await dump(name);
  done.push(name);
  console.log('✓', name);
}

async function step(name, fn) {
  try { await fn(); } catch (e) { fail.push(`${name}: ${e.message}`); console.log('✗', name, e.message); }
}

async function hrefs(pattern) {
  return page.eval(`[...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => ${pattern}.test(h)))]`);
}

await step('01-accueil', async () => { await settle(); await shoot('01-accueil'); });

await step('02-audience', async () => {
  await page.goto(HOST + '/crm/clients'); await settle();
  await shoot('02-audience');
});

await step('03-fiche-client', async () => {
  // première ligne du tableau des clients
  const ok = await page.eval(`(() => { const row = document.querySelector('tbody tr, [role="row"]:not(:first-child)'); if (!row) return false; row.scrollIntoView({block:'center'}); row.click(); return true; })()`);
  if (!ok) throw new Error('aucune ligne client');
  await page.sleep(1600);
  await page.eval(`window.scrollTo(0,0)`);
  await shoot('03-fiche-client', { full: false });
  await page.key('Escape');
});

await step('04-segments', async () => {
  await page.goto(HOST + '/crm/segments'); await settle();
  await shoot('04-segments');
});

await step('05-segment-fiche', async () => {
  const ok = await page.eval(`(() => { const row = document.querySelector('tbody tr, [role="row"]:not(:first-child)'); if (!row) return false; row.click(); return true; })()`);
  if (!ok) throw new Error('aucun segment');
  await page.sleep(1600);
  await shoot('05-segment-fiche', { full: false });
  await page.key('Escape'); await page.sleep(400);
});

await step('06-segment-catalogue', async () => {
  await page.click('text=Nouveau segment'); await page.sleep(1800);
  await shoot('06-segment-catalogue', { full: false });
  // vue « Tous les segments » si l'onglet existe
  try { await page.mouse('text=Tous les segments'); await page.sleep(1200); await shoot('06b-segment-catalogue-tous', { full: false }); } catch { /* pas d'onglet */ }
  await page.key('Escape'); await page.sleep(400);
});

let emailIds = [];
await step('07-emails', async () => {
  await page.goto(HOST + '/crm/emails/campaigns'); await settle();
  await shoot('07-emails-campagnes');
  emailIds = await hrefs('/\\/crm\\/emails\\/(studio|results)\\//');
  console.log('  liens e-mail :', emailIds.slice(0, 8).join(' '));
});

await step('08-email-studio', async () => {
  const studio = emailIds.find((h) => /studio\/(?!new)/.test(h));
  if (!studio) throw new Error('aucun brouillon ouvert dans le studio (lien studio absent)');
  await page.goto(HOST + studio); await settle(2500);
  await shoot('08-email-studio', { full: false });
});

await step('09-email-resultats', async () => {
  const res = emailIds.find((h) => /results\//.test(h));
  if (!res) throw new Error('aucun résultat de campagne');
  await page.goto(HOST + res); await settle(2500);
  await shoot('09-email-resultats');
});

let smsIds = [];
await step('10-sms', async () => {
  await page.goto(HOST + '/crm/sms/campaigns'); await settle();
  await shoot('10-sms-campagnes');
  smsIds = await hrefs('/\\/crm\\/sms\\/(compose|results|send)\\//');
  console.log('  liens SMS :', smsIds.slice(0, 8).join(' '));
});

await step('11-sms-compose', async () => {
  const c = smsIds.find((h) => /compose\/(?!new)/.test(h));
  if (!c) throw new Error('aucun brouillon SMS');
  await page.goto(HOST + c); await settle(2500);
  await shoot('11-sms-compose', { full: false });
});

await step('12-sms-resultats', async () => {
  const r = smsIds.find((h) => /results\//.test(h));
  if (!r) throw new Error('aucun résultat SMS');
  await page.goto(HOST + r); await settle(2500);
  await shoot('12-sms-resultats');
});

await step('13-ventes-attribution', async () => {
  await page.goto(HOST + '/crm/analytics/sales'); await settle(2500);
  await shoot('13-analytics-ventes');
});

await step('14-soirees', async () => {
  await page.goto(HOST + '/crm/nights/past'); await settle(2500);
  await shoot('14-soirees-passees');
  await page.goto(HOST + '/crm/nights'); await settle(2500);
  await shoot('15-soiree-a-venir');
});

await step('16-automatisations', async () => {
  await page.goto(HOST + '/crm/automations'); await settle(2000);
  await shoot('16-automatisations');
});

await step('17-emails-overview', async () => {
  await page.goto(HOST + '/crm/emails'); await settle(2000);
  await shoot('17-emails-vue');
  await page.goto(HOST + '/crm/sms'); await settle(2000);
  await shoot('18-sms-vue');
});

const errs = page.errors().slice(0, 10);
await page.close();
fs.writeFileSync(path.join(OUT, '_rapport.json'), JSON.stringify({ host: HOST, done, fail, errs, at: new Date().toISOString() }, null, 1));
console.log(`\n${done.length} écrans → ${OUT}`);
if (fail.length) console.log('Manquants :\n - ' + fail.join('\n - '));
