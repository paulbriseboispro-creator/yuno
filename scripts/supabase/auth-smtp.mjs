#!/usr/bin/env node
// Branche les e-mails d'authentification de Supabase (confirmation, mot de passe
// oublié, lien magique) sur Resend, au lieu du SMTP intégré limité à 2 e-mails
// par heure. À jouer UNE fois, avant d'activer la confirmation d'adresse.
//
//   RESEND_API_KEY=re_… node scripts/supabase/auth-smtp.mjs            # à blanc : montre ce qui changerait
//   RESEND_API_KEY=re_… node scripts/supabase/auth-smtp.mjs --apply    # applique
//   … --apply --confirm-email                                          # + active la confirmation d'adresse
//
// SUPABASE_ACCESS_TOKEN est lu dans .env.local. La clé Resend n'est jamais écrite
// ici ni affichée : elle ne vit que dans l'environnement du processus.
// Les modèles d'e-mail se règlent à part (auth-emails.mjs).
// Prérequis côté Resend : le domaine d'envoi (SENDER_EMAIL) est vérifié
// (SPF / DKIM, voir docs/EMAIL_DELIVERABILITY.md).
import { readFileSync } from 'node:fs';

const REF = 'fulawxvdlwtdlpkycixe';
const SENDER_EMAIL = process.env.AUTH_SENDER_EMAIL || 'no-reply@yunoapp.eu';
const SENDER_NAME = 'Yuno';
const apply = process.argv.includes('--apply');
const confirmEmail = process.argv.includes('--confirm-email');

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
  } catch { return ''; }
}

const token = env('SUPABASE_ACCESS_TOKEN');
const resendKey = env('RESEND_API_KEY');
if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant (.env.local).'); process.exit(1); }
if (!resendKey) { console.error('RESEND_API_KEY manquant : créez une clé « Sending access » dans Resend, puis relancez.'); process.exit(1); }

const patch = {
  smtp_host: 'smtp.resend.com',
  smtp_port: '465',
  smtp_user: 'resend',
  smtp_pass: resendKey,
  smtp_admin_email: SENDER_EMAIL,
  smtp_sender_name: SENDER_NAME,
  rate_limit_email_sent: 100,
  ...(confirmEmail ? { mailer_autoconfirm: false } : {}),
};

const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const cur = await (await fetch(url, { headers })).json();

console.log('Réglage actuel → prévu');
for (const k of Object.keys(patch)) {
  const show = (v) => (k === 'smtp_pass' ? (v ? '••••' : '(vide)') : typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : String(v));
  console.log(`  ${k}: ${show(cur[k])} → ${show(patch[k])}`);
}
if (!apply) { console.log('\nÀ blanc. Ajoutez --apply pour appliquer.'); process.exit(0); }

const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(patch) });
if (!res.ok) { console.error('Refusé :', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
console.log('\nAppliqué. Testez : créez un compte, ou « mot de passe oublié » sur yunoapp.eu/auth.');
if (!confirmEmail) console.log('La confirmation d\'adresse reste DÉSACTIVÉE (mailer_autoconfirm). Pour l\'activer : --apply --confirm-email.');
