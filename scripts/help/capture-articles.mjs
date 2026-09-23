#!/usr/bin/env node
// Capture les pages du mode d'emploi listées par merge-rewrites.py
// (pending-captures.json) avec le pilote démo, puis les convertit en WebP
// ≤ 1280 px (public/help/ part dans le bundle OTA : jamais de PNG).
//
//   node scripts/help/capture-articles.mjs <pending-captures.json> [--only id] [--base http://localhost:8080]
//
// Rôle par fichier : ownerHelpContent → owner, organizerHelpContent →
// organizer, agencyHelpContent → agency. Une route « ~/… » est absolue.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const listPath = args[0];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:8080';
const ROLE = { ownerHelpContent: 'owner', organizerHelpContent: 'organizer', agencyHelpContent: 'agency' };
const BASE_PATH = { ownerHelpContent: '/owner', organizerHelpContent: '/organizer-app', agencyHelpContent: '/agency-app' };

const items = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const seen = new Set();
let ok = 0, ko = 0;
for (const it of items) {
  if (only && it.id !== only) continue;
  if (seen.has(it.target)) continue;
  seen.add(it.target);
  const route = it.route.startsWith('~') ? it.route.slice(1) : BASE_PATH[it.file] + it.route;
  const png = path.join('/tmp', `help-capture-${it.id}.png`);
  try {
    execFileSync('node', ['scripts/demo/drive.mjs', '--as', ROLE[it.file], '--lang', 'fr', '--device', 'desktop',
      '--go', base + route, '--wait', '() => document.body.innerText.length > 120',
      // La page a du texte, mais ses cartes chargent encore : on attend que
      // spinners et squelettes aient disparu depuis 2,5 s (plafond 20 s).
      '--eval', 'new Promise((r) => { const t0 = Date.now(); let quiet = 0; const i = setInterval(() => { const busy = document.querySelector(".animate-spin, .animate-pulse"); quiet = busy ? 0 : quiet + 200; if (quiet >= 2500 || Date.now() - t0 > 20000) { clearInterval(i); r(!busy); } }, 200); })',
      '--shot', png], { stdio: 'pipe', timeout: 150_000 });
    fs.mkdirSync(path.dirname(it.target), { recursive: true });
    execFileSync('cwebp', ['-quiet', '-q', '85', '-m', '6', '-resize', '1280', '0', png, '-o', it.target], { stdio: 'pipe' });
    const kb = Math.round(fs.statSync(it.target).size / 1024);
    console.log(`✓ ${it.id} ← ${route} (${kb} Ko)`);
    ok++;
  } catch (e) {
    console.log(`✗ ${it.id} ← ${route} : ${String(e.stderr || e.message).split('\n').slice(-3).join(' | ').slice(0, 300)}`);
    ko++;
  }
}
console.log(`${ok} captures, ${ko} échecs`);
