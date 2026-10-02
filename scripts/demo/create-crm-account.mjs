#!/usr/bin/env node
// Compte démo Yuno CRM : crm@womber.fr (organisateur, produit « crm »).
// Idempotent : crée l'utilisateur s'il n'existe pas, sans mot de passe connu
// (la démo s'ouvre par lien magique, mintSession). Le remplissage (organisation,
// billetterie connectée fictive, soirées et billets) est dans seed-crm-demo.sql.
//
//   node scripts/demo/create-crm-account.mjs
import crypto from 'node:crypto';
import { adminFetch, adminListUsers } from './lib.mjs';

const EMAIL = 'crm@womber.fr';

const users = await adminListUsers();
const existing = users.find((u) => (u.email || '').toLowerCase() === EMAIL);
if (existing) {
  console.log(`déjà là : ${EMAIL} → ${existing.id}`);
  process.exit(0);
}
const res = await adminFetch('admin/users', {
  method: 'POST',
  body: JSON.stringify({
    email: EMAIL,
    email_confirm: true,
    password: crypto.randomBytes(24).toString('base64url'),
    user_metadata: { first_name: 'Démo', last_name: 'CRM' },
  }),
});
if (!res.ok) {
  console.error(`création refusée : ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  process.exit(1);
}
console.log(`créé : ${EMAIL} → ${res.body.id}`);
