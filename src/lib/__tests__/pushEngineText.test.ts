import { describe, expect, it } from 'vitest';
import {
  composeEngineNotification, engineUrl, formatTime, indexTemplates, logTypeFor, pickTemplate, renderEngineText,
  withCampaign, type ClaimedRow, type EngineTemplate,
} from '../../../supabase/functions/_shared/push-engine-text.ts';

const TEMPLATES: EngineTemplate[] = [
  { rule_key: 'new_event', variant: 'default', reason: 'host_follower', lang: 'fr', title: '📅 Nouveau chez {name}', body: '{event} — {date}. Sois dans les premiers à réserver.' },
  { rule_key: 'new_event', variant: 'default', reason: 'host_follower', lang: 'en', title: '📅 New at {name}', body: '{event} — {date}. Be one of the first to book.' },
  { rule_key: 'new_event', variant: 'default', reason: 'dj_follower', lang: 'fr', title: '🎧 {dj} joue le {date}', body: '{event} chez {hosts}.' },
  { rule_key: 'last_tickets', variant: 'default', reason: 'any', lang: 'fr', title: '⚡ Dernières places', body: '{event} — {date}. Il en reste très peu.' },
  { rule_key: 'last_tickets', variant: 'price_rise', reason: 'any', lang: 'fr', title: '⏳ Le tarif va monter', body: '{event}' },
  { rule_key: 'event_day_reminder', variant: 'drinks', reason: 'any', lang: 'fr', title: '🎟️ Ce soir : {event}', body: 'Rendez-vous à {time}.' },
  { rule_key: 'after_thanks', variant: 'next', reason: 'any', lang: 'fr', title: 'Merci ❤️', body: 'Prochaine date : {next_event}, {next_date}.' },
];
const index = indexTemplates(TEMPLATES);

const row = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  candidate_id: 1, user_id: 'u', rule_key: 'new_event', variant: 'default', family: 'marketing',
  reason: 'host_follower', reason_party: 'venue:v1', event_id: 'e1', vars: {}, lang: 'fr',
  event_title: 'Nuit Collab', start_at: '2026-10-03T21:30:00Z', tz: 'Europe/Paris',
  venue_name: 'Club Un', host_names: 'Club Un × Orga B', party_name: 'Club Un', ...over,
});

describe('pickTemplate', () => {
  it('prend le texte de la RAISON, dans la langue de la personne', () => {
    expect(pickTemplate(index, 'new_event', 'default', 'host_follower', 'en').title).toBe('📅 New at {name}');
    expect(pickTemplate(index, 'new_event', 'default', 'dj_follower', 'fr').title).toBe('🎧 {dj} joue le {date}');
  });
  it('retombe en français, puis sur le texte « any », puis sur la variante par défaut', () => {
    expect(pickTemplate(index, 'new_event', 'default', 'dj_follower', 'es').title).toBe('🎧 {dj} joue le {date}');
    expect(pickTemplate(index, 'last_tickets', 'default', 'interested', 'fr').title).toBe('⚡ Dernières places');
    expect(pickTemplate(index, 'last_tickets', 'last_tables', 'any', 'fr').title).toBe('⚡ Dernières places');
    expect(pickTemplate(index, 'last_tickets', 'price_rise', 'host_follower', 'fr').title).toBe('⏳ Le tarif va monter');
  });
  it('jamais de notification vide, même sans texte en base', () => {
    const t = pickTemplate(indexTemplates([]), 'sales_open', 'default', 'any', 'fr');
    expect(t.title).toBe('{event}');
  });
});

describe('composeEngineNotification', () => {
  it('nomme la partie qui a touché la personne, pas toute l’affiche', () => {
    const n = composeEngineNotification(row(), index);
    expect(n.title).toBe('📅 Nouveau chez Club Un');
    expect(n.body).toBe('Nuit Collab — sam. 3 oct. Sois dans les premiers à réserver.');
    expect(n.url).toBe('/event/e1');
  });
  it('un fan de DJ lit le nom du DJ et l’affiche « A × B »', () => {
    const n = composeEngineNotification(row({ reason: 'dj_follower', reason_party: 'dj:d1', vars: { dj: 'DJ Delta' }, party_name: 'DJ Delta' }), index);
    expect(n.title).toBe('🎧 DJ Delta joue le sam. 3 oct');
    expect(n.body).toBe('Nuit Collab chez Club Un × Orga B.');
  });
  it('rend l’heure dans le fuseau de la soirée (le runtime tourne en UTC)', () => {
    expect(formatTime('2026-10-03T21:30:00Z', 'Europe/Paris')).toBe('23:30');
    const n = composeEngineNotification(row({ rule_key: 'event_day_reminder', variant: 'drinks', reason: 'ticket_holder' }), index);
    expect(n.body).toBe('Rendez-vous à 23:30.');
    expect(n.url).toBe('/order/upsell?event=e1');
  });
  it('le merci mène à la prochaine soirée', () => {
    const r = row({ rule_key: 'after_thanks', variant: 'next', reason: 'attendee', vars: { next_event_id: 'e2', next_event: 'Suite', next_start: '2026-10-10T21:00:00Z' } });
    expect(composeEngineNotification(r, index).body).toBe('Prochaine date : Suite, sam. 10 oct.');
    expect(engineUrl(r)).toBe('/event/e2');
  });
});

describe('renderEngineText', () => {
  it('efface une variable vide sans laisser de ponctuation orpheline', () => {
    expect(renderEngineText('{event} — {date}. Réserve.', { event: 'Nuit', date: '' }, 100)).toBe('Nuit. Réserve.');
    expect(renderEngineText('Ce soir : {event} {inconnu}', { event: 'X' }, 100)).toBe('Ce soir : X');
  });
  it('coupe proprement au-delà de la limite', () => {
    const out = renderEngineText('a'.repeat(120), {}, 80);
    expect(out.length).toBe(80);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('routage et journal', () => {
  it('rappels : l’inscrit guest list n’a pas d’onglet billets', () => {
    expect(engineUrl(row({ rule_key: 'doors_open', reason: 'guest' }))).toBe('/my-orders');
    expect(engineUrl(row({ rule_key: 'doors_open', reason: 'ticket_holder' }))).toBe('/my-orders?tab=tickets');
  });
  it('le paramètre de suivi s’ajoute sans casser la requête', () => {
    expect(withCampaign('/event/e1', 'c1')).toBe('/event/e1?pc=c1');
    expect(withCampaign('/order/upsell?event=e1', 'c1')).toBe('/order/upsell?event=e1&pc=c1');
  });
  it('seul le marketing entre dans les plafonds', () => {
    expect(logTypeFor('marketing')).toBe('marketing');
    expect(logTypeFor('urgent')).toBe('marketing');
    expect(logTypeFor('event')).toBe('event_campaign');
    expect(logTypeFor('reminder')).toBe('reminder');
  });
});
