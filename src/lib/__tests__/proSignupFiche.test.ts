import { describe, expect, it } from 'vitest';
import {
  callNotes,
  distinctPhones,
  enrichFiche,
  phoneE164,
  phonePretty,
  researchInput,
  sourceLabel,
  type RawFiche,
} from '../../../supabase/functions/_shared/pro-signup-fiche.ts';
import { normalizeResearch, parseResearchText } from '../../../supabase/functions/_shared/org-research.ts';

describe('phoneE164', () => {
  it('reads French numbers with or without the leading 0', () => {
    expect(phoneE164('0756388760')).toBe('+33756388760');
    expect(phoneE164('756388760')).toBe('+33756388760'); // Pascal, landing 19/10
    expect(phoneE164('07 56 38 87 60')).toBe('+33756388760');
    expect(phoneE164('+33 7 56 38 87 68')).toBe('+33756388768');
    expect(phoneE164('+33769012254')).toBe('+33769012254');
    expect(phoneE164('0033 6 12 34 56 78')).toBe('+33612345678');
    expect(phoneE164('+33 06 12 34 56 78')).toBe('+33612345678');
  });
  it('uses the country for numbers without a prefix', () => {
    expect(phoneE164('612345678', 'ES')).toBe('+34612345678');
    expect(phoneE164('0470123456', 'BE')).toBe('+32470123456');
  });
  it('gives up on garbage', () => {
    expect(phoneE164('')).toBeNull();
    expect(phoneE164('123')).toBeNull();
    expect(phoneE164(null)).toBeNull();
  });
  it('prints French numbers the French way', () => {
    expect(phonePretty('+33756388760')).toBe('07 56 38 87 60');
    expect(phonePretty('+34612345678')).toBe('+34 612 345 678');
  });
});

describe('sourceLabel', () => {
  it('names the channel then the page', () => {
    expect(sourceLabel({ source: 'landing', utm_source: 'chatgpt.com' })).toBe('ChatGPT → la landing');
    expect(sourceLabel({ source: 'landing', referrer_host: 'www.google.com' })).toBe('Google → la landing');
    expect(sourceLabel({ source: 'start', utm_source: 'yuno_app', utm_medium: 'auth' }))
      .toBe("l'app Yuno → la page d'inscription");
    expect(sourceLabel({ source: 'start_crm' })).toBe("la page d'inscription Yuno CRM");
    expect(sourceLabel({ source: 'app_form' })).toBe("le formulaire « Ouvrir un club » de l'app");
    expect(sourceLabel(null)).toBe('inconnue');
  });
});

const POUPEE: RawFiche = {
  kind: 'retry',
  person: { full_name: 'Pascal Delatour', email: 'delatourpascal20@outlook.fr', phone: '756388760', profile_phone: '0756388760' },
  org: { kind: 'club', name: 'Poupée', city: 'Bastia', country: 'FR', size_band: '800_1500' },
  origin: { source: 'start', utm_source: 'yuno_app', step: 'account' },
  account: { exists: true, events: 1, payments: false, console_opened_at: '2026-10-19T09:29:09Z' },
  attempts: [
    { at: '2026-10-19T09:26:49Z', phone: '0756388760', account_created_at: '2026-10-19T09:29:09Z' },
    { at: '2026-10-19T09:46:21Z', phone: '756388760', account_created_at: null },
    { at: '2026-10-19T16:05:18Z', phone: '756388760', account_created_at: null },
  ],
  app_leads: [{ phone: '+33 7 56 38 87 68', club_name: 'Poupée', city: 'Paris' }],
  stalled: { step: 'account' },
};

describe('enrichFiche', () => {
  it('flags a pro who already has an account and keeps trying to sign up', () => {
    const f = enrichFiche(POUPEE);
    expect(f.push.title).toContain('arrive plus');
    expect(f.push.body).toContain('Poupée');
    expect(f.push.body).toContain('07 56 38 87 60');
    expect(f.notes.join(' ')).toContain("déjà un compte");
    expect(f.notes.join(' ')).toContain('3 parcours');
    expect(f.notes.join(' ')).toContain('pas relié ses paiements');
  });
  it('lists every distinct number, typos included', () => {
    expect(distinctPhones(POUPEE).map((p) => p.pretty)).toEqual(['07 56 38 87 60', '07 56 38 87 68']);
    expect(callNotes(POUPEE).join(' ')).toContain('Numéros différents');
  });
  it('says when a first account was deleted then recreated', () => {
    const f = enrichFiche({
      kind: 'account',
      person: { full_name: 'Lillo Bacio', email: 'lillobacioevenement@gmail.com', phone: null },
      org: { kind: 'organizer', name: 'Lillo Bacio', city: 'Lille', next_night: 'month', size_band: 'lt200' },
      origin: { source: 'landing', utm_source: 'chatgpt.com', started_at: '2026-10-19T17:11:13Z', account_at: '2026-10-19T17:12:59Z' },
      account: { exists: true, events: 0, console_opened_at: '2026-10-19T17:13:00Z' },
      attempts: [
        { at: '2026-10-19T16:57:07Z', phone: '+33769012254', account_created_at: '2026-10-19T17:01:15Z', account_deleted: true },
        { at: '2026-10-19T17:11:13Z', phone: null, account_created_at: '2026-10-19T17:12:59Z' },
      ],
    });
    expect(f.push.title).toBe('🆕 Nouvel organisateur inscrit');
    expect(f.push.body).toBe('Lillo Bacio (Lille) · Lillo Bacio · 07 69 01 22 54 · via ChatGPT → la landing');
    expect(f.notes.join(' ')).toContain('supprimé un premier compte');
    expect(f.labels.duration_min).toBe(2);
    expect(f.labels.size).toBe('< 200 personnes');
    expect(f.search_links.map((l) => l.label)).toEqual(['Google', 'Instagram', 'Shotgun']);
    expect(f.search_links[1].url).toContain(encodeURIComponent('site:instagram.com "Lillo Bacio" Lille'));
  });
});

describe('researchInput', () => {
  it('never sends the phone or the full email, only a company domain', () => {
    const i = researchInput({ ...POUPEE, person: { ...POUPEE.person, email: 'pascal@poupee-bastia.fr' } });
    expect(i).toEqual({ name: 'Poupée', city: 'Bastia', country: 'FR', kind: 'club', person: 'Pascal Delatour', domain: 'poupee-bastia.fr' });
    expect(researchInput(POUPEE)?.domain).toBeNull(); // outlook.fr = webmail
    expect(researchInput({ ...POUPEE, kind: 'deleted' })).toBeNull();
  });
});

describe('research parsing', () => {
  it('reads the JSON answer and keeps only real links', () => {
    const raw = parseResearchText('```json\n{"found": true, "summary": "Club de Bastia.", "instagram": {"handle": "@poupee.bastia", "followers": "3 k"}, "website": "pas un lien", "confidence": "medium", "call_angles": ["a","b","c","d"]}\n```');
    expect(raw).not.toBeNull();
    const r = normalizeResearch(raw!, { name: 'Poupée', city: 'Bastia', country: 'FR', kind: 'club', person: null, domain: null },
      [{ title: 'Instagram', url: 'https://www.instagram.com/poupee.bastia/' }], 'gpt-4.1-mini');
    expect(r.instagram?.url).toBe('https://www.instagram.com/poupee.bastia/');
    expect(r.website).toBeNull();
    expect(r.call_angles).toHaveLength(3);
    expect(r.confidence).toBe('medium');
    expect(r.org_name).toBe('Poupée');
    const withModelSources = normalizeResearch({ found: true, sources: ['https://shotgun.live/fr/venues/x', 'pas un lien'] },
      { name: 'X', city: null, country: null, kind: 'club', person: null, domain: null }, [], 'gpt-4.1-mini');
    expect(withModelSources.sources).toEqual([{ title: null, url: 'https://shotgun.live/fr/venues/x' }]);
  });
  it('returns null on prose', () => {
    expect(parseResearchText('Je n’ai rien trouvé.')).toBeNull();
  });
});

describe('fallback email', () => {
  it('carries the call links, the notes and the research', async () => {
    const { buildProSignupEmail } = await import('../../../supabase/functions/_shared/pro-signup-email.ts');
    const f = enrichFiche(POUPEE);
    const r = normalizeResearch(
      { found: true, summary: 'Club de Bastia.', call_angles: ['Tables VIP'] },
      { name: 'Poupée', city: 'Bastia', country: 'FR', kind: 'club', person: null, domain: null },
      [{ title: 'Instagram', url: 'https://www.instagram.com/poupee/' }], 'gpt-4.1-mini',
    );
    const { subject, html } = buildProSignupEmail(f, r, 'abc');
    expect(subject).toContain('Poupée (Bastia)');
    expect(html).toContain('tel:+33756388760');
    expect(html).toContain('https://wa.me/33756388760');
    expect(html).toContain('Club de Bastia.');
    expect(html).toContain('https://yuno-cockpit.vercel.app/prospects/abc');
    expect(html).toContain('Numéros différents');
  });
});
