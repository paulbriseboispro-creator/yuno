import { describe, expect, it } from 'vitest';
import { buildGuestNotifEmail } from '../../../supabase/functions/_shared/guest-pass-notify-email';

const base = {
  id: 'n1', email: 'club@example.com', language: 'fr', guest_name: 'Tia Felisa', event_title: 'House Of Masquerade',
  event_start_at: '2026-10-28T22:00:00Z', timezone: 'Europe/Paris', poster_url: null, inviter_name: 'Amoris',
};

describe('e-mail d’une notification de l’invité', () => {
  it('le contrat : objet = soirée + phrase, lien vers l’onglet de l’espace', () => {
    const m = buildGuestNotifEmail({ ...base, type: 'contract', data: { org: 'Amoris', n: 1 }, path: '/invite/02f4bbef-e584-4889-a6ba-e58b19452513' })!;
    expect(m.subject).toBe('House Of Masquerade : Amoris te propose un contrat pour la soirée');
    expect(m.html).toContain('https://yunoapp.eu/invite/02f4bbef-e584-4889-a6ba-e58b19452513?tab=money');
  });
  it('sans compte rattaché, le lien est l’invitation, sans onglet', () => {
    const m = buildGuestNotifEmail({ ...base, type: 'recapReady', data: {}, path: '/h/0123456789abcdef0123456789abcdef' })!;
    expect(m.html).toContain('https://yunoapp.eu/h/0123456789abcdef0123456789abcdef"');
    expect(m.subject).toContain('Le bilan de la soirée est prêt');
  });
  it('un type inconnu ne part pas', () => {
    expect(buildGuestNotifEmail({ ...base, type: 'inconnu', data: {}, path: '/invite/x' })).toBeNull();
  });
});
