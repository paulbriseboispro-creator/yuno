// L'e-mail de secours des alertes d'inscription pro : il part vers Paul quand
// le Cockpit n'a pu pousser la notification sur aucun téléphone (aucun
// appareil abonné), avec la fiche ET la recherche sur la structure.
// Dès que le téléphone de Paul est abonné dans le Cockpit, ces e-mails cessent.
//
// Construit avec le kit des e-mails Yuno (email-kit.ts). Testé par
// src/lib/__tests__/proSignupFiche.test.ts.

import { body, ctaPill, esc, infoRows, ruleLabel, section, shell, title } from './email-kit.ts';
import type { Fiche } from './pro-signup-fiche.ts';
import type { OrgResearch } from './org-research.ts';

const COCKPIT = 'https://yuno-cockpit.vercel.app';

function link(label: string, url: string): string {
  return `<a href="${esc(url)}" target="_blank" style="color:#ffffff;text-decoration:underline;">${esc(label)}</a>`;
}

export function buildProSignupEmail(
  f: Fiche,
  research: OrgResearch | null,
  prospectId: string | null,
): { subject: string; html: string } {
  const org = f.org?.name || f.person?.full_name || f.person?.email || 'Inscription';
  const city = f.org?.city ? ` (${f.org.city})` : '';
  const subject = `${f.push.title} · ${org}${city}`;

  const contact: string[] = [];
  for (const p of f.phones) {
    contact.push(`${link(`Appeler ${p.pretty}`, `tel:${p.e164}`)} · ${link('WhatsApp', `https://wa.me/${p.e164.replace(/\D/g, '')}`)}`);
  }
  if (f.person?.email) contact.push(link(f.person.email, `mailto:${f.person.email}`));

  const facts = [
    { k: 'Qui', v: f.person?.full_name ?? '' },
    { k: 'Type', v: f.labels.kind },
    { k: 'Ville', v: f.org?.city ?? '' },
    { k: 'Taille', v: f.labels.size ?? '' },
    { k: 'Rythme', v: f.labels.frequency ?? '' },
    { k: 'Billetterie actuelle', v: f.labels.tool ?? '' },
    { k: 'Prochaine soirée', v: f.labels.next_night ?? '' },
    { k: 'Produit', v: f.org?.product === 'crm' ? 'Yuno CRM' : f.org?.product === 'suite' ? 'Billetterie' : '' },
    { k: 'Venu par', v: f.labels.source },
    { k: 'Inscription', v: typeof f.labels.duration_min === 'number' ? `${Math.max(1, f.labels.duration_min)} min` : '' },
  ].filter((r) => r.v);

  const acc = f.account ?? {};
  const status = acc.exists && f.kind !== 'deleted'
    ? [
      acc.console_opened_at ? 'Console ouverte ✓' : 'Console pas encore ouverte',
      (acc.events ?? 0) > 0 ? `${acc.events} soirée(s) créée(s)` : 'pas encore de soirée',
      acc.payments ? 'paiements reliés ✓' : 'paiements pas reliés',
      acc.live ? 'en ligne ✓' : 'pas en ligne',
    ].join(' · ')
    : '';

  const parts: string[] = [
    section(ruleLabel('Inscription Yuno') + `<div style="height:14px"></div>` + title(`${org}${city}`, 28)
      + `<div style="height:10px"></div>` + body(esc(f.push.body))),
  ];
  if (contact.length) parts.push(section(ruleLabel('Le joindre') + `<div style="height:10px"></div>` + body(contact.join('<br>'))));
  if (f.notes.length) {
    parts.push(section(ruleLabel('Avant d’appeler') + `<div style="height:10px"></div>`
      + body(f.notes.map((n) => `• ${esc(n)}`).join('<br>'))));
  }
  parts.push(section(infoRows(facts)));
  if (status) parts.push(section(ruleLabel('Son compte') + `<div style="height:10px"></div>` + body(esc(status))));
  if (f.org?.message) parts.push(section(ruleLabel('Son message') + `<div style="height:10px"></div>` + body(`« ${esc(f.org.message)} »`)));

  if (research) {
    const links: string[] = [];
    if (research.instagram?.url) links.push(link(`${research.instagram.handle ?? 'Instagram'}${research.instagram.followers ? ` · ${research.instagram.followers}` : ''}`, research.instagram.url));
    if (research.website) links.push(link('Site', research.website));
    if (research.ticketing?.url) links.push(link(research.ticketing.platform ?? 'Billetterie', research.ticketing.url));
    const lines = [
      research.summary ? esc(research.summary) : (research.found ? '' : 'Rien de net trouvé sur le web.'),
      links.length ? links.join(' · ') : '',
      research.recent_events.length ? `Dernières soirées : ${esc(research.recent_events.join(' · '))}` : '',
      research.people.length ? `Qui la mène : ${esc(research.people.join(', '))}` : '',
      research.call_angles.length ? `<b>Angles pour l’appel</b><br>${research.call_angles.map((a) => `• ${esc(a)}`).join('<br>')}` : '',
      research.red_flags.length ? research.red_flags.map((a) => `⚠︎ ${esc(a)}`).join('<br>') : '',
      research.sources.length ? `Sources : ${research.sources.slice(0, 5).map((s, i) => link(String(i + 1), s.url)).join(' ')}` : '',
    ].filter(Boolean);
    parts.push(section(ruleLabel('Sa structure (recherche web)') + `<div style="height:10px"></div>` + body(lines.join('<br><br>'))));
  }

  parts.push(section(ctaPill('Ouvrir sa fiche dans le Cockpit', prospectId ? `${COCKPIT}/prospects/${prospectId}` : `${COCKPIT}/inscriptions`)
    + (f.admin_url ? `<div style="height:14px"></div>${body(link('Ouvrir dans l’admin Yuno', f.admin_url))}` : '')));
  parts.push(section(body(esc("Tu reçois cet e-mail parce qu'aucun téléphone n'est abonné aux notifications du Cockpit. Cockpit → Réglages → « Activer les rappels » sur ton iPhone (app ajoutée à l'écran d'accueil) : les alertes arriveront en notification et ces e-mails s'arrêteront."), '#8a8a8a'), { border: false }));

  return { subject, html: shell({ preheader: f.push.body, body: parts.join(''), title: subject }) };
}
