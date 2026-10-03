#!/usr/bin/env node
// Compte de RELECTURE des annuaires d'IA (Claude, ChatGPT…) pour le serveur MCP
// (docs/MCP.md § Kit annuaires) : review@womber.fr, dans le périmètre démo.
//
// Les annuaires exigent « un compte rempli, utilisable tout de suite, sans 2FA,
// sans code par email ». Ce compte n'a AUCUNE donnée réelle : il lit le club
// démo (manager analytique / finance / clients), l'organisation démo et le
// compte Yuno CRM démo (admin d'équipe), c'est-à-dire trois espaces à cocher au
// consentement. Il ne peut rien envoyer (garde démo `demo_no_send`).
//
// À lancer par Paul (la création d'un compte en production lui revient) :
//
//   node scripts/demo/create-reviewer-account.mjs
//
// Le mot de passe est généré ici et affiché UNE fois : le copier dans les
// formulaires de relecture (champ « test credentials » / « Review details »).
// Idempotent : un compte déjà là n'est pas recréé, ses accès sont reposés.
import crypto from 'node:crypto';
import { adminFetch, adminListUsers, rest, invalidateScope } from './lib.mjs';

const EMAIL = 'review@womber.fr';
const CLUB = 'womber';
const ORGS = { 'organizer@womber.fr': 'Organisateur Démo', 'crm@womber.fr': 'Yuno CRM démo' };

const users = await adminListUsers();
let reviewer = users.find((u) => (u.email || '').toLowerCase() === EMAIL);
let password = null;

if (!reviewer) {
  password = `Yuno-${crypto.randomBytes(12).toString('base64url')}`;
  const res = await adminFetch('admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      email_confirm: true,
      password,
      user_metadata: { first_name: 'Review', last_name: 'Yuno' },
    }),
  });
  if (!res.ok) {
    console.error(`création refusée : ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    process.exit(1);
  }
  reviewer = res.body;
  console.log(`créé : ${EMAIL} → ${reviewer.id}`);
  invalidateScope();
} else {
  console.log(`déjà là : ${EMAIL} → ${reviewer.id} (mot de passe inchangé)`);
}

// 1. Club démo : manager qui LIT (analytique, finance, clients), rien d'autre.
const mp = await rest.get(`manager_permissions?select=id&user_id=eq.${reviewer.id}&venue_id=eq.${CLUB}`);
if (mp.length === 0) {
  await rest.post('manager_permissions', {
    user_id: reviewer.id, venue_id: CLUB,
    can_view_analytics: true, can_view_finance: true, can_view_customers: true, can_manage_crm: true,
  }).then(() => console.log(`club ${CLUB} : manager (lecture) ajouté`))
    .catch((err) => console.log(`club ${CLUB} : non ajouté (${String(err.message).slice(0, 160)})`));
} else {
  console.log(`club ${CLUB} : déjà manager`);
}

// 2. Organisation démo et compte CRM démo : admin d'équipe accepté.
for (const [ownerEmail, label] of Object.entries(ORGS)) {
  const owner = users.find((u) => (u.email || '').toLowerCase() === ownerEmail);
  if (!owner) { console.log(`${label} : compte ${ownerEmail} introuvable, ignoré`); continue; }
  const m = await rest.get(`org_members?select=id,invitation_status&organizer_user_id=eq.${owner.id}&member_user_id=eq.${reviewer.id}`);
  if (m.length === 0) {
    await rest.post('org_members', {
      organizer_user_id: owner.id, member_user_id: reviewer.id, member_email: EMAIL, invited_by: owner.id,
      role: 'admin', invitation_status: 'accepted', accepted_at: new Date().toISOString(),
      can_view_finance: true,
    }).then(() => console.log(`${label} : admin d'équipe ajouté`))
      // Une limite de membres (offre Yuno CRM) peut refuser : les autres espaces restent.
      .catch((err) => console.log(`${label} : non ajouté (${String(err.message).slice(0, 160)})`));
  } else if (m[0].invitation_status !== 'accepted') {
    await rest.patch(`org_members?id=eq.${m[0].id}&organizer_user_id=eq.${owner.id}`, { invitation_status: 'accepted', accepted_at: new Date().toISOString() });
    console.log(`${label} : appartenance acceptée`);
  } else {
    console.log(`${label} : déjà admin d'équipe`);
  }
}

// 3. Ce que le consentement proposera (même règle que le serveur).
const spaces = await rest.rpc('_mcp_user_spaces', { p_uid: reviewer.id }).catch(() => null);
if (Array.isArray(spaces)) console.log(`espaces proposés au consentement : ${spaces.map((s) => s.name).join(' · ')}`);

if (password) {
  console.log('\n──────── À COPIER DANS LES FORMULAIRES DE RELECTURE ────────');
  console.log(`URL du serveur  : https://yunoapp.eu/mcp`);
  console.log(`Identifiant     : ${EMAIL}`);
  console.log(`Mot de passe    : ${password}`);
  console.log('Ce mot de passe ne sera plus jamais affiché. Le garder dans ton gestionnaire.');
}
