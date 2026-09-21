#!/usr/bin/env node
// Rapport d'état des comptes démo : ce qu'un prospect verrait aujourd'hui.
//
//   node scripts/demo/audit.mjs
//
// Lecture seule. Le but n'est pas de compter pour compter : chaque ligne porte
// un verdict, parce qu'une démo se dégrade toute seule (les soirées passent,
// les nouveautés ne sont mises en scène nulle part) et que personne ne le voit
// avant de la montrer à quelqu'un.

import { DEMO_VENUE_ID, demoScope, fmt, rest } from './lib.mjs';

const NOW = new Date().toISOString();
const ok = (b) => (b ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m');
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const head = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

const issues = [];
function check(condition, label, fix) {
  console.log(`  ${ok(condition)} ${label}`);
  if (!condition) issues.push(fix);
}

async function pillarsFor(events) {
  if (!events.length) return { tickets: 0, tables: 0, guests: 0 };
  const ids = events.map((e) => e.id);
  const inList = `(${ids.join(',')})`;
  const [tickets, tables, guests] = await Promise.all([
    rest.count(`tickets?select=id&event_id=in.${inList}`),
    rest.count(`table_reservations?select=id&event_id=in.${inList}`),
    rest.count(`guest_list_entries?select=id,guest_lists!inner(event_id)&guest_lists.event_id=in.${inList}`)
      .catch(() => 0),
  ]);
  return { tickets, tables, guests };
}

async function main() {
  const scope = await demoScope();
  console.log(`\x1b[1mÉTAT DE LA DÉMO — ${fmt.day(NOW)}\x1b[0m`);
  console.log(`club ${DEMO_VENUE_ID} · ${scope.userIds.size} comptes @womber.fr · ${scope.eventIds.size} soirées`);

  // ------------------------------------------------------------------ club
  head('CLUB (owner@womber.fr)');
  const clubEvents = await rest.get(
    `events?select=id,title,start_at,status,ticketing_enabled,tables_enabled,tickets_sold_out,tables_sold_out&venue_id=eq.${DEMO_VENUE_ID}&order=start_at.asc&limit=500`,
  );
  const clubFuture = clubEvents.filter((e) => e.start_at > NOW && e.status === 'active');
  check(clubFuture.length >= 3, `${clubFuture.length} soirée(s) à venir`, 'Club : moins de 3 soirées à venir — reprogrammer des dates.');
  if (clubFuture.length) {
    console.log(`      prochaine : ${fmt.day(clubFuture[0].start_at)} — ${clubFuture[0].title}`);
    console.log(`      dernière  : ${fmt.day(clubFuture[clubFuture.length - 1].start_at)}`);
  }
  check(clubFuture.some((e) => e.ticketing_enabled), 'billetterie ouverte sur au moins une soirée', 'Club : aucune billetterie ouverte à venir.');
  check(clubFuture.some((e) => e.tables_enabled), 'tables VIP ouvertes sur au moins une soirée', 'Club : aucune table VIP ouverte à venir.');

  const [zones, packs, plans, drinks] = await Promise.all([
    rest.count(`table_zones?select=id&venue_id=eq.${DEMO_VENUE_ID}`),
    rest.count(`table_packs?select=id&venue_id=eq.${DEMO_VENUE_ID}`),
    rest.count(`venue_floor_plans?select=id&venue_id=eq.${DEMO_VENUE_ID}`),
    rest.count(`drinks?select=id&venue_id=eq.${DEMO_VENUE_ID}`).catch(() => 0),
  ]);
  check(zones > 0 && packs > 0, `catalogue VIP : ${zones} zone(s), ${packs} formule(s), ${plans} plan(s) de salle`, 'Club : catalogue VIP incomplet.');
  check(drinks > 0, `carte du bar : ${drinks} référence(s)`, 'Club : carte du bar vide.');

  const clubSales = await pillarsFor(clubFuture);
  check(
    clubSales.tickets + clubSales.tables + clubSales.guests > 0,
    `ventes sur les soirées à venir : ${clubSales.tickets} billet(s), ${clubSales.tables} table(s), ${clubSales.guests} invité(s)`,
    'Club : aucune vente sur les soirées à venir — une démo vide ne démontre rien.',
  );

  // ----------------------------------------------------------- organisateur
  head('ORGANISATEUR (organizer@womber.fr / bde@womber.fr)');
  const orgIds = ['organizer@womber.fr', 'bde@womber.fr']
    .map((e) => scope.byEmail.get(e)).filter(Boolean);
  const orgEvents = await rest.get(
    `events?select=id,title,start_at,status,venue_id,ticketing_enabled,tables_enabled&organizer_user_id=in.(${orgIds.join(',')})&order=start_at.asc&limit=500`,
  );
  const orgFuture = orgEvents.filter((e) => e.start_at > NOW && e.status === 'active');
  check(orgFuture.length >= 3, `${orgFuture.length} soirée(s) à venir`, 'Orga : moins de 3 soirées à venir — le côté organisateur paraît mort.');
  if (orgFuture.length) console.log(`      prochaine : ${fmt.day(orgFuture[0].start_at)} — ${orgFuture[0].title}`);
  check(orgFuture.some((e) => e.venue_id), 'au moins une soirée en collab avec un club', 'Orga : aucune soirée en collab à venir — le contrat club↔orga n\'est pas montrable.');
  check(orgFuture.some((e) => !e.venue_id), 'au moins une soirée sans club (orga seul)', 'Orga : aucune soirée sans club à venir.');
  check(orgFuture.some((e) => e.tables_enabled), 'tables VIP ouvertes côté orga', 'Orga : aucune table VIP ouverte à venir.');

  const orgSales = await pillarsFor(orgFuture);
  check(
    orgSales.tickets + orgSales.tables + orgSales.guests > 0,
    `ventes sur les soirées à venir : ${orgSales.tickets} billet(s), ${orgSales.tables} table(s), ${orgSales.guests} invité(s)`,
    'Orga : aucune vente sur les soirées à venir.',
  );
  const team = await rest.count(`org_members?select=id&organizer_user_id=in.(${orgIds.join(',')})`);
  check(team > 0, `${team} membre(s) d'équipe`, 'Orga : aucune équipe — le partage de scope n\'est pas montrable.');

  // -------------------------------------------------------------- marketing
  head('MARKETING (les deux portées)');
  const scopes = [
    ['club', `venue_id=eq.${DEMO_VENUE_ID}`],
    ['orga', `organizer_user_id=in.(${orgIds.join(',')})`],
  ];
  for (const [label, filter] of scopes) {
    const [contacts, sms, campaigns, autos] = await Promise.all([
      rest.count(`newsletter_subscriptions?select=id&${filter}`),
      rest.count(`venue_sms_contacts?select=id&${filter}`),
      rest.count(`email_campaigns?select=id&${filter}`),
      rest.count(`email_automations?select=id&${filter}&enabled=eq.true`),
    ]);
    console.log(`  ${label} : ${fmt.n(contacts)} contact(s) email · ${fmt.n(sms)} SMS · ${campaigns} campagne(s) · ${autos} automatisation(s) allumée(s)`);
    if (autos === 0) issues.push(`${label} : aucune automatisation email allumée — la plaquette en vend neuf.`);
  }

  // ------------------------------------------------------------------ bilan
  head('VERDICT');
  if (!issues.length) {
    console.log('  Rien à signaler. La démo est montrable en l\'état.');
  } else {
    console.log(`  ${warn(`${issues.length} point(s) à reprendre :`)}`);
    issues.forEach((i, n) => console.log(`   ${n + 1}. ${i}`));
  }
  console.log('');
}

main().catch((e) => { console.error('\x1b[31mKO\x1b[0m', e.message); process.exit(1); });
