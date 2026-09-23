#!/usr/bin/env node
// Pilote de navigateur pour les comptes démo : ouvre Chrome sur yunoapp.eu déjà
// connecté au rôle demandé, et laisse cliquer / remplir / capturer.
//
// Ni Playwright ni Puppeteer sur cette machine : CDP en direct, avec le
// WebSocket natif de Node 22. Zéro dépendance.
//
//   node scripts/demo/drive.mjs --as owner --go /owner/dashboard --shot /tmp/o.png
//   node scripts/demo/drive.mjs --as organizer --go /organizer-app --headed --keep
//   node scripts/demo/drive.mjs --as bouncer --go /bouncer --device iphone
//
// Comme module :
//   import { open } from './drive.mjs';
//   const page = await open({ as: 'owner', go: '/owner/events' });
//   await page.click('text=Créer une soirée'); await page.shot('/tmp/x.png');

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  APP_ORIGIN, AUTH_STORAGE_KEY, DEMO_EMAIL_DOMAIN, mintSession, rest,
} from './lib.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Miroir de DEMO_ACCOUNTS (src/lib/demoSession.ts) : rôle → compte, route
 * d'atterrissage et bypass local à poser pour ne pas tomber sur MFA / PIN.
 * Si ce tableau diverge du front, le pilote atterrit sur un écran de garde.
 */
export const ROLES = {
  owner:     { email: 'owner@womber.fr',     route: '/owner/dashboard', mfa: true },
  organizer: { email: 'organizer@womber.fr', route: '/organizer-app' },
  bde:       { email: 'bde@womber.fr',       route: '/organizer-app' },
  promoter:  { email: 'promoter@womber.fr',  route: '/promoter',   session: 'pin',   role: 'promoter' },
  agency:    { email: 'agency@womber.fr',    route: '/agency-app', mfa: true },
  dj:        { email: 'dj@womber.fr',        route: '/dj',         session: 'pin',   role: 'dj' },
  affiliate: { email: 'affiliate@womber.fr', route: '/affiliate',  mfa: true },
  bouncer:   { email: 'bouncer@womber.fr',   route: '/bouncer',    session: 'staff', role: 'bouncer' },
  barman:    { email: 'barman@womber.fr',    route: '/barman',     session: 'staff', role: 'barman' },
  cloakroom: { email: 'cloakroom@womber.fr', route: '/cloakroom',  session: 'staff', role: 'cloakroom' },
  vip_host:  { email: 'viphost@womber.fr',   route: '/vip-host',   session: 'staff', role: 'vip_host' },
};

const DEVICES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
  iphone: {
    width: 430, height: 932, deviceScaleFactor: 3, mobile: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
};

// ------------------------------------------------------------------ CDP

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }

  static async attach(port) {
    // Chrome met un instant à ouvrir son port : on réessaie plutôt que de dormir.
    let targets = null;
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        targets = list.filter((t) => t.type === 'page');
        if (targets.length) break;
      } catch { /* port pas encore ouvert */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!targets || !targets.length) throw new Error('Chrome : aucune cible CDP après 10 s.');
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP : connexion WebSocket refusée')), { once: true });
    });
    const cdp = new CDP(ws);
    ws.addEventListener('message', (ev) => cdp.#onMessage(ev.data));
    return cdp;
  }

  #onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? ` — ${msg.error.data}` : ''}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const h of this.handlers.get(msg.method) || []) h(msg.params);
    }
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  close() { try { this.ws.close(); } catch { /* déjà fermé */ } }
}

// --------------------------------------------------------------- amorçage

/**
 * Script injecté AVANT tout script de page, à chaque navigation : session
 * Supabase, bypass de rôle, consentement et langue. Posé par
 * `Page.addScriptToEvaluateOnNewDocument`, il survit donc aux rechargements
 * internes de la SPA — contrairement à un `localStorage.setItem` après coup.
 */
function seedScript({ authKey, session, bypass, lang, hideDemoButton }) {
  const payload = JSON.stringify({ authKey, session, bypass, lang, hideDemoButton });
  return `(() => { try {
    const S = ${payload};
    if (S.session) localStorage.setItem(S.authKey, JSON.stringify(S.session));
    for (const [k, v] of Object.entries(S.bypass)) localStorage.setItem(k, JSON.stringify(v));
    // Bannière cookies : refus explicite, pour qu'elle ne couvre aucune capture
    // et qu'aucun traceur ne parte depuis une session de test.
    localStorage.setItem('yuno_cookie_consent', JSON.stringify({ analytics: false, marketing: false, ts: Date.now(), v: 2 }));
    // OnboardingGate teste la chaîne EXACTE 'true' : toute autre valeur ('1',
    // JSON.stringify(true) → '"true"') laisse le quiz de goûts recouvrir l'écran.
    localStorage.setItem('language', S.lang);
    localStorage.setItem('languageSelected', 'true');
    localStorage.setItem('onboarding_language_answered', 'true');
    localStorage.setItem('onboarding_push_answered', 'true');
    localStorage.setItem('onboarding_taste_answered', 'true');
    if (S.hideDemoButton) localStorage.setItem('yuno_demo_button_hidden', String(Date.now()));
  } catch (e) { console.warn('seed démo:', e); } })();`;
}

async function buildBypass(role, userId) {
  const bypass = {};
  const DAY = 24 * 60 * 60 * 1000;
  const stamp = { expiresAt: Date.now() + DAY, verifiedAt: Date.now() };
  if (role.mfa) bypass.mfaSession = { userId, ...stamp };
  if (role.session === 'pin') bypass.pinSession = { role: role.role, ...stamp };
  if (role.session === 'staff') {
    const rows = await rest.get(`profiles?select=venue_id&id=eq.${userId}`);
    bypass.staffSession = { venueId: rows[0]?.venue_id ?? null, role: role.role, ...stamp };
  }
  return bypass;
}

// ----------------------------------------------------------------- page

export async function open({
  as = 'owner', email, go, device = 'desktop', lang = 'fr',
  headed = false, showDemoButton = false, port = 9333 + Math.floor(Math.random() * 400),
  // bypass:false = aucun contournement MFA/PIN : on voit les gardes comme un vrai compte neuf.
  bypass: withBypass = true,
  // Dossier où Chrome dépose les téléchargements (PDF de contrat, exports).
  downloadDir = null,
} = {}) {
  // `as: 'anon'` = navigateur VIERGE, sans session : c'est ce que voit un club
  // qui clique le lien d'invitation reçu par email, ou un visiteur.
  const anon = as === 'anon';
  const role = anon ? null : ROLES[as];
  const target = anon ? null : (email || role?.email);
  if (!anon && !target) throw new Error(`Rôle inconnu : ${as}. Connus : anon, ${Object.keys(ROLES).join(', ')}`);
  if (target && !target.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) {
    throw new Error(`REFUS : ${target} n'est pas un compte démo.`);
  }

  const session = anon ? null : await mintSession(target);
  const bypass = anon || !withBypass ? {} : await buildBypass(role || {}, session.user.id);
  const metrics = DEVICES[device] || DEVICES.desktop;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuno-demo-chrome-'));
  const chrome = spawn(CHROME, [
    headed ? '--new-window' : '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--use-angle=swiftshader',
    `--window-size=${metrics.width},${metrics.height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const cdp = await CDP.attach(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (downloadDir) {
    fs.mkdirSync(downloadDir, { recursive: true });
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: metrics.width, height: metrics.height,
    deviceScaleFactor: metrics.deviceScaleFactor, mobile: metrics.mobile,
  });
  if (metrics.ua) await cdp.send('Emulation.setUserAgentOverride', { userAgent: metrics.ua });

  const logs = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    logs.push({ level: p.type, text: (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    logs.push({ level: 'exception', text: p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '?' });
  });

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: seedScript({
      authKey: AUTH_STORAGE_KEY, session, bypass, lang,
      hideDemoButton: !showDemoButton,
    }),
  });

  const page = {
    cdp, chrome, logs, session, email: target ?? 'anon', userDataDir,

    async goto(routeOrUrl, { wait = true } = {}) {
      const url = /^(https?|file):/.test(routeOrUrl) ? routeOrUrl : APP_ORIGIN + routeOrUrl;
      await cdp.send('Page.navigate', { url });
      if (wait) await page.waitForBoot();
      return url;
    },

    async eval(expression, { awaitPromise = true } = {}) {
      const r = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise, userGesture: true,
      });
      if (r.exceptionDetails) {
        throw new Error(`eval : ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      return r.result.value;
    },

    /**
     * Attend que l'écran soit VRAIMENT rendu. `#root` reçoit un enfant dès la
     * première frame (squelette de chargement) : s'arrêter là donne une capture
     * noire. On attend du texte, puis on laisse la page se stabiliser.
     */
    async waitForBoot(timeout = 30000) {
      await page.waitFor(
        '() => { const r = document.getElementById("root"); return !!r && (document.body.innerText || "").trim().length > 40; }',
        { timeout },
      );
      // Puis on attend la fin des squelettes. Chaque page pro se rend en deux
      // temps : la coquille (barre latérale, titres) arrive tout de suite, les
      // données remplissent après. Sans cette attente on capture une page de
      // rectangles gris — « rendu » au sens technique, vide au sens utile.
      const deadline = Date.now() + timeout;
      let stable = 0;
      let last = -1;
      while (Date.now() < deadline) {
        const [skeletons, len] = await page.eval(
          '[document.querySelectorAll(".animate-pulse").length, (document.body.innerText || "").length]',
        );
        stable = skeletons === 0 && len === last ? stable + 1 : 0;
        if (stable >= 2) return true;
        last = len;
        await new Promise((r) => setTimeout(r, 400));
      }
      // Le temps imparti ne suffit pas : on rend la main plutôt que d'échouer,
      // l'appelant voit la page telle qu'elle est (et ses erreurs console).
      return false;
    },

    /**
     * Attend une condition. Accepte `() => …` (prédicat), `text=…` (texte visible)
     * ou un sélecteur CSS.
     */
    async waitFor(what, { timeout = 20000 } = {}) {
      const predicate = what.startsWith('() =>') || what.startsWith('()=>')
        ? what
        : what.startsWith('text=')
          ? `() => document.body && document.body.innerText.includes(${JSON.stringify(what.slice(5))})`
          : `() => !!document.querySelector(${JSON.stringify(what)})`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        try { if (await page.eval(`(${predicate})()`)) return true; } catch { /* page en cours de navigation */ }
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`waitFor a expiré (${timeout} ms) : ${what}`);
    },

    /** Clique par sélecteur CSS ou par `text=…` (premier élément cliquable qui le porte). */
    async click(what) {
      const expr = what.startsWith('text=')
        ? `(() => { const t = ${JSON.stringify(what.slice(5))};
             const els = [...document.querySelectorAll('button,a,[role="button"],[role="tab"],[role="menuitem"],label,summary')];
             const el = els.find(e => (e.innerText || e.textContent || '').trim().includes(t));
             if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`
        : `(() => { const el = document.querySelector(${JSON.stringify(what)});
             if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`;
      const ok = await page.eval(expr);
      if (!ok) throw new Error(`click : rien trouvé pour ${what}`);
      return true;
    },

    /**
     * Remplit un champ React. `el.value = x` ne déclenche aucun onChange :
     * il faut passer par le setter natif puis émettre un `input` qui bulle.
     */
    async fill(selector, value) {
      const ok = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true; })()`);
      if (!ok) throw new Error(`fill : champ introuvable ${selector}`);
      return true;
    },

    /**
     * Clic à la SOURIS (Input.dispatchMouseEvent), pour les composants qui
     * écoutent pointerdown plutôt que click — Radix Select / DropdownMenu /
     * Popover ouvrent sur pointerdown, et `el.click()` ne les ouvre jamais.
     * Cible : sélecteur CSS, `text=…` (élément cliquable qui porte le texte) ou
     * `any=…` (n'importe quel élément visible dont le texte commence par…).
     */
    async mouse(what, { index = 0 } = {}) {
      const finder = what.startsWith('text=')
        ? `(() => { const t = ${JSON.stringify(what.slice(5))};
             const els = [...document.querySelectorAll('button,a,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],[role="radio"],label,summary,input,select,textarea')]
               .filter(e => (e.innerText || e.textContent || e.value || '').trim().includes(t) && e.getClientRects().length);
             return els[${index}] || null; })()`
        : what.startsWith('any=')
          ? `(() => { const t = ${JSON.stringify(what.slice(4))};
             const els = [...document.querySelectorAll('body *')]
               .filter(e => e.children.length === 0 || e.matches('button,[role],label'))
               .filter(e => (e.innerText || e.textContent || '').trim().startsWith(t) && e.getClientRects().length);
             return els[${index}] || null; })()`
          : `document.querySelectorAll(${JSON.stringify(what)})[${index}] || null`;
      // Deux passes : scrollIntoView ne suffit pas toujours (conteneur interne,
      // barre collante) et un clic hors du viewport n'atteint rien — la ligne
      // « Léa Moreau » de la liste de porte a été manquée exactement comme ça.
      const box = await page.eval(`(async () => { const el = ${finder}; if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((r) => setTimeout(r, 150));
        let r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) {
          // Le conteneur qui défile n'est pas forcément la fenêtre (dashboards
          // pro : <main> à overflow auto). Remonter jusqu'au premier ancêtre
          // défilable et le faire glisser, puis la fenêtre en dernier recours.
          let anc = el.parentElement; let done = false;
          while (anc && !done) {
            const st = getComputedStyle(anc);
            if (/(auto|scroll)/.test(st.overflowY) && anc.scrollHeight > anc.clientHeight) {
              anc.scrollTop += r.top + r.height / 2 - anc.getBoundingClientRect().top - anc.clientHeight / 2;
              done = true;
            }
            anc = anc.parentElement;
          }
          if (!done) window.scrollBy(0, r.top + r.height / 2 - window.innerHeight / 2);
          await new Promise((r2) => setTimeout(r2, 200));
          r = el.getBoundingClientRect();
        }
        // Toujours hors champ : un clic natif vaut mieux qu'un clic souris dans
        // le vide (les boutons ordinaires y répondent ; seuls les déclencheurs
        // Radix exigent la souris, et ils vivent en haut de page).
        if (r.top < 0 || r.bottom > window.innerHeight) { el.click(); return { x: 0, y: 0, w: r.width, h: r.height, native: true }; }
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
      if (!box) throw new Error(`mouse : rien trouvé pour ${what}`);
      if (box.native) { await new Promise((r) => setTimeout(r, 120)); return box; }
      const { x, y } = box;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 120));
      return box;
    },

    /** Frappe au clavier dans l'élément qui a le focus (vrais événements, React suit). */
    async type(text) {
      await cdp.send('Input.insertText', { text: String(text) });
      await new Promise((r) => setTimeout(r, 60));
    },

    /** Touche unique : 'Enter', 'Escape', 'Tab', 'ArrowDown'… */
    async key(key) {
      const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, Backspace: 8 };
      const code = codes[key] ?? 0;
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await new Promise((r) => setTimeout(r, 80));
    },

    /** Vide un champ (focus + tout sélectionner + suppression) puis frappe la valeur. */
    async retype(selector, value, { index = 0 } = {}) {
      await page.mouse(selector, { index });
      await page.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (el) { el.focus(); el.select && el.select(); } })()`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
      await page.key('Backspace');
      await page.type(value);
    },

    /** Attente simple. */
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    /** Texte visible de la page (ou d'un sélecteur). */
    text: (selector) => page.eval(selector
      ? `(document.querySelector(${JSON.stringify(selector)}) || {}).innerText || ''`
      : 'document.body.innerText'),

    async shot(file, { full = false } = {}) {
      const params = { format: 'png', captureBeyondViewport: full };
      if (full) {
        const m = await cdp.send('Page.getLayoutMetrics');
        const h = Math.min(Math.ceil(m.cssContentSize.height), 16000);
        params.clip = { x: 0, y: 0, width: Math.ceil(m.cssContentSize.width), height: h, scale: 1 };
      }
      const { data } = await cdp.send('Page.captureScreenshot', params);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },

    /** Erreurs console accumulées — un écran « qui s'affiche » peut hurler en dessous. */
    errors: () => logs.filter((l) => l.level === 'error' || l.level === 'exception'),

    async close() {
      cdp.close();
      try { chrome.kill(); } catch { /* déjà mort */ }
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* laissé au système */ }
    },
  };

  // Une page hors de l'app (email rendu en file://) n'a pas de #root à attendre.
  await page.goto(go || role?.route || '/', { wait: !/^file:/.test(go || '') });
  return page;
}

// ------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || (!a.as && !a.email)) {
    console.log(`Pilote démo
  --as <rôle>      ${Object.keys(ROLES).join(' | ')}
  --email <a@womber.fr>  compte démo précis (sinon celui du rôle)
  --go <route>     route à ouvrir (sinon la route du rôle)
  --shot <fichier> capture PNG
  --full           capture pleine page
  --wait <cond>    "text=…", un sélecteur CSS ou "() => …"
  --eval <js>      évalue et affiche le résultat
  --device <desktop|iphone>
  --lang <fr|en|es>
  --headed         fenêtre visible
  --keep           ne ferme pas le navigateur (--headed)
  --demo-button    laisse le bouton Démo visible`);
    process.exit(0);
  }
  const page = await open({
    as: a.as || 'owner', email: a.email, go: a.go, device: a.device,
    lang: a.lang || 'fr', headed: !!a.headed, showDemoButton: !!a['demo-button'],
  });
  try {
    if (a.wait) await page.waitFor(a.wait);
    const url = await page.eval('location.pathname + location.search');
    console.log(`connecté : ${page.email} → ${url}`);
    if (a.eval) console.log(JSON.stringify(await page.eval(a.eval), null, 2));
    if (a.shot) console.log(`capture : ${await page.shot(a.shot, { full: !!a.full })}`);
    const errs = page.errors();
    if (errs.length) {
      console.log(`\n${errs.length} erreur(s) console :`);
      for (const e of errs.slice(0, 8)) console.log('  ·', e.text.slice(0, 200));
    }
  } finally {
    if (!a.keep) await page.close();
    else console.log('navigateur laissé ouvert (--keep).');
  }
}
