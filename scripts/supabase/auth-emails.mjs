#!/usr/bin/env node
// Modèles des e-mails d'authentification de Supabase (confirmation, mot de passe
// oublié, lien magique, invitation, changement d'adresse, ré-authentification),
// dans la DA de Yuno CRM : papier clair, carte arrondie, bouton rouge, FR puis EN.
//
//   node scripts/supabase/auth-emails.mjs --preview   # écrit un HTML par modèle dans /tmp/yuno-auth-emails
//   node scripts/supabase/auth-emails.mjs             # à blanc : montre ce qui changerait
//   node scripts/supabase/auth-emails.mjs --apply     # applique chez Supabase Auth
//
// SUPABASE_ACCESS_TOKEN est lu dans .env.local. Le SMTP se règle à part (auth-smtp.mjs).
// Variables Go de Supabase utilisées : {{ .ConfirmationURL }}, {{ .Token }}, {{ .NewEmail }}.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const REF = 'fulawxvdlwtdlpkycixe';
const ORIGIN = 'https://yunoapp.eu';
const apply = process.argv.includes('--apply');
const preview = process.argv.includes('--preview');

// Jetons de la DA Yuno CRM (landing : src/styles/crm.css).
const T = { ink: '#1c1517', sand50: '#f7f4f3', sand200: '#e6dfdd', sand400: '#a39a98', sand500: '#857b7d', sand600: '#5e5457', red: '#e3141b' };
const FONT = `'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif`;
const BODY = `Geist,'Helvetica Neue',Helvetica,Arial,sans-serif`;

const COPY = {
  confirmation: {
    subject: 'Confirmez votre adresse e-mail · Yuno',
    fr: { title: 'Confirmez votre e-mail', body: 'Un clic suffit pour ouvrir votre console Yuno.', cta: 'Confirmer mon e-mail', note: 'Vous n’avez pas créé de compte Yuno ? Ignorez cet e-mail.' },
    en: { title: 'Confirm your email', body: 'One click opens your Yuno console.', cta: 'Confirm my email', note: 'Didn’t create a Yuno account? Ignore this email.' },
  },
  recovery: {
    subject: 'Réinitialisez votre mot de passe · Yuno',
    fr: { title: 'Réinitialisez votre mot de passe', body: 'Vous avez demandé à changer de mot de passe. Le lien est valable une heure.', cta: 'Choisir un nouveau mot de passe', note: 'Vous n’avez rien demandé ? Ignorez cet e-mail, votre mot de passe reste inchangé.' },
    en: { title: 'Reset your password', body: 'You asked to change your password. The link is valid for one hour.', cta: 'Choose a new password', note: 'Didn’t ask for this? Ignore this email, your password stays the same.' },
  },
  magic_link: {
    subject: 'Votre lien de connexion · Yuno',
    fr: { title: 'Votre lien de connexion', body: 'Ouvrez-le pour entrer dans Yuno, sans mot de passe. Il ne marche qu’une fois.', cta: 'Me connecter', note: 'Vous ne l’avez pas demandé ? Ignorez cet e-mail.' },
    en: { title: 'Your sign-in link', body: 'Open it to enter Yuno, no password needed. It works once.', cta: 'Sign me in', note: 'Didn’t request it? Ignore this email.' },
  },
  invite: {
    subject: 'Vous êtes invité sur Yuno',
    fr: { title: 'Vous êtes invité sur Yuno', body: 'Acceptez l’invitation pour créer votre accès.', cta: 'Accepter l’invitation', note: 'Vous ne connaissez pas l’expéditeur ? Ignorez cet e-mail.' },
    en: { title: 'You’re invited to Yuno', body: 'Accept the invitation to create your access.', cta: 'Accept the invitation', note: 'Don’t know the sender? Ignore this email.' },
  },
  email_change: {
    subject: 'Confirmez votre nouvelle adresse · Yuno',
    fr: { title: 'Confirmez votre nouvelle adresse', body: 'Vous voulez utiliser <strong>{{ .NewEmail }}</strong> pour votre compte Yuno. Confirmez le changement.', cta: 'Confirmer le changement', note: 'Vous n’avez pas demandé ce changement ? Ignorez cet e-mail.' },
    en: { title: 'Confirm your new address', body: 'You want to use <strong>{{ .NewEmail }}</strong> for your Yuno account. Confirm the change.', cta: 'Confirm the change', note: 'Didn’t request this change? Ignore this email.' },
  },
  reauthentication: {
    subject: 'Votre code de vérification · Yuno',
    code: true,
    fr: { title: 'Votre code de vérification', body: 'Entrez ce code pour confirmer cette action. Ne le partagez avec personne.', note: 'Vous n’êtes pas à l’origine de cette demande ? Ignorez cet e-mail.' },
    en: { title: 'Your verification code', body: 'Enter this code to confirm the action. Don’t share it with anyone.', note: 'Didn’t request it? Ignore this email.' },
  },
};

function block(c, withCode, withCta, first) {
  return `<tr><td style="padding:${first ? '8px' : '28px'} 0 0">
    <div style="font-family:${FONT};font-size:${first ? 26 : 20}px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${T.ink}">${c.title}</div>
    <p style="margin:12px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.sand600}">${c.body}</p>
    ${withCode ? `<div style="margin:22px 0 4px;font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:.3em;color:${T.ink}">{{ .Token }}</div>` : ''}
    ${withCta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td align="center" bgcolor="${T.red}" style="border-radius:999px;background:linear-gradient(110deg,#e3141b 0%,#f2392a 45%,#ff6b35 100%)"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 30px;font-family:${BODY};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${c.cta}</a></td></tr></table>` : ''}
    <p style="margin:18px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${T.sand500}">${c.note}</p>
  </td></tr>`;
}

export function render(key) {
  const k = COPY[key];
  const withCta = !k.code;
  const fallback = withCta
    ? `<p style="margin:26px 0 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400};word-break:break-all">Le bouton ne marche pas ? Copiez ce lien · If the button doesn’t work, copy this link:<br><a href="{{ .ConfirmationURL }}" style="color:${T.sand500}">{{ .ConfirmationURL }}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${k.subject}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Geist:wght@400..600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${T.sand50}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.sand50}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%">
    <tr><td style="padding:0 4px 18px"><img src="${ORIGIN}/yuno-wordmark-dark.png" width="88" height="30" alt="Yuno" style="display:block;border:0;width:88px;height:30px"></td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${T.sand200};border-radius:24px;padding:32px 32px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${block(k.fr, k.code, withCta, true)}
        <tr><td style="padding:26px 0 0"><div style="height:1px;background:${T.sand200};font-size:0;line-height:0">&nbsp;</div></td></tr>
        ${block(k.en, k.code, false, false)}
        <tr><td>${fallback}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400}">Yuno · yunoapp.eu</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

if (preview) {
  mkdirSync('/tmp/yuno-auth-emails', { recursive: true });
  for (const key of Object.keys(COPY)) writeFileSync(`/tmp/yuno-auth-emails/${key}.html`, render(key));
  console.log('Aperçus écrits dans /tmp/yuno-auth-emails/');
  process.exit(0);
}

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
  } catch { return ''; }
}
const token = env('SUPABASE_ACCESS_TOKEN');
if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant (.env.local).'); process.exit(1); }

const patch = {};
for (const [key, k] of Object.entries(COPY)) {
  patch[`mailer_subjects_${key}`] = k.subject;
  patch[`mailer_templates_${key}_content`] = render(key);
}
const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const cur = await (await fetch(url, { headers })).json();
for (const key of Object.keys(COPY)) console.log(`  ${key}: « ${cur[`mailer_subjects_${key}`]} » → « ${COPY[key].subject} »`);
if (!apply) { console.log('\nÀ blanc. Ajoutez --apply pour appliquer.'); process.exit(0); }
const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(patch) });
if (!res.ok) { console.error('Refusé :', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
console.log('\nAppliqué.');
