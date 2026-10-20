// Messages Telegram des alertes d'inscription pro (migration 20261104200000) :
// la fiche (tout de suite) puis la recherche sur la structure (en réponse).
// Module PUR : testé par src/lib/__tests__/proSignupFiche.test.ts.
//
// Telegram rend un numéro au format international cliquable (appel) ; ses
// boutons n'acceptent que des liens https : Cockpit, WhatsApp, admin Yuno.

import type { Fiche } from './pro-signup-fiche.ts';
import type { OrgResearch } from './org-research.ts';

const COCKPIT = 'https://yuno-cockpit.vercel.app';

export type TelegramButton = { text: string; url: string };
export type TelegramMessage = { text: string; buttons: TelegramButton[][] };

/** Échappement du mode HTML de Telegram (&, <, > seulement). */
export function tgEsc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** « +33 7 56 38 87 60 » : international ET lisible, Telegram en fait un lien d'appel. */
export function phoneIntl(e164: string): string {
  if (e164.startsWith('+33') && e164.length === 12) {
    const d = e164.slice(3);
    return `+33 ${d[0]} ${d.slice(1).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
  }
  return e164;
}

const LEAD: Record<string, string> = {
  account: '🆕', lead: '📩', app_lead: '📩', links_lead: '📩', contact: '✉️',
  stalled: '⚠️', retry: '⚠️', deleted: '🗑️',
};

export function telegramFicheMessage(f: Fiche, prospectId: string | null): TelegramMessage {
  const org = f.org?.name || f.person?.full_name || f.person?.email || 'Inscription';
  const title = f.push.title.replace(/^\S+\s/, ''); // l'emoji vient de LEAD
  const lines: string[] = [
    `${LEAD[f.kind] ?? '🔔'} <b>${tgEsc(title)}</b>`,
    `<b>${tgEsc(org)}</b>${f.org?.city ? ` · ${tgEsc(f.org.city)}` : ''}${f.labels.kind ? ` · ${tgEsc(f.labels.kind)}` : ''}`,
    '',
  ];
  if (f.person?.full_name) lines.push(`👤 ${tgEsc(f.person.full_name)}`);
  for (const p of f.phones) lines.push(`📞 ${tgEsc(phoneIntl(p.e164))}`);
  if (f.person?.email) lines.push(`✉️ ${tgEsc(f.person.email)}`);
  lines.push(`🧭 ${tgEsc(f.labels.source)}`);
  const facts = [
    f.labels.size, f.labels.frequency,
    f.labels.next_night ? `prochaine soirée : ${f.labels.next_night}` : null,
    f.labels.tool && f.labels.tool !== 'aucun outil' ? `billetterie : ${f.labels.tool}` : null,
    f.org?.product === 'crm' ? 'Yuno CRM' : null,
  ].filter(Boolean) as string[];
  if (facts.length) lines.push(`📋 ${tgEsc(facts.join(' · '))}`);
  if (f.notes.length) {
    lines.push('');
    for (const n of f.notes) lines.push(`• ${tgEsc(n)}`);
  }
  if (f.org?.message) lines.push('', `💬 « ${tgEsc(f.org.message.slice(0, 600))} »`);
  lines.push('', '<i>🔎 Recherche sur la structure : elle arrive en réponse.</i>');

  const buttons: TelegramButton[][] = [[
    { text: 'Fiche Cockpit', url: prospectId ? `${COCKPIT}/prospects/${prospectId}` : `${COCKPIT}/inscriptions` },
  ]];
  const wa = f.phones[0];
  if (wa) buttons[0].push({ text: 'WhatsApp', url: `https://wa.me/${wa.e164.replace(/\D/g, '')}` });
  if (f.admin_url) buttons.push([{ text: 'Admin Yuno', url: f.admin_url }]);
  return { text: lines.join('\n').slice(0, 3900), buttons };
}

export function telegramResearchMessage(
  r: OrgResearch | null,
  searchLinks: Array<{ label: string; url: string }>,
): TelegramMessage {
  const a = (label: string, url: string) => `<a href="${tgEsc(url)}">${tgEsc(label)}</a>`;
  const lines: string[] = [];
  if (!r || !r.found) {
    lines.push('🔎 <b>Sa structure</b> : rien de net trouvé sur le web.');
  } else {
    const conf = r.confidence === 'high' ? 'fiable' : r.confidence === 'medium' ? 'à vérifier' : 'peu sûr';
    lines.push(`🔎 <b>Sa structure</b> (web · ${conf})`);
    if (r.summary) lines.push('', tgEsc(r.summary));
    const links: string[] = [];
    if (r.instagram?.url) links.push(a(`${r.instagram.handle ?? 'Instagram'}${r.instagram.followers ? ` · ${r.instagram.followers}` : ''}`, r.instagram.url));
    if (r.website) links.push(a('Site', r.website));
    if (r.ticketing?.url) links.push(a(r.ticketing.platform ?? 'Billetterie', r.ticketing.url));
    if (links.length) lines.push('', links.join(' · '));
    if (r.recent_events.length) lines.push('', `🎉 ${tgEsc(r.recent_events.join(' · '))}`);
    if (r.people.length) lines.push(`👥 ${tgEsc(r.people.join(', '))}`);
    if (r.call_angles.length) {
      lines.push('', '<b>Angles pour l’appel</b>');
      for (const x of r.call_angles) lines.push(`• ${tgEsc(x)}`);
    }
    for (const x of r.red_flags) lines.push(`⚠︎ ${tgEsc(x)}`);
    if (r.sources.length) lines.push('', `Sources : ${r.sources.slice(0, 5).map((s, i) => a(String(i + 1), s.url)).join(' ')}`);
  }
  if (searchLinks.length) lines.push('', `Chercher : ${searchLinks.map((l) => a(l.label, l.url)).join(' · ')}`);
  return { text: lines.join('\n').slice(0, 3900), buttons: [] };
}
