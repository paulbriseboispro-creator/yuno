import { describe, expect, it } from 'vitest';
import {
  buildCrmDemoEmail, buildCrmInviteEmail, buildCrmSupportEmail, crmDemoWhatsAppText, crmInviteWhatsAppText,
  demoIsLive, initialsOf, inviteStage,
} from '../crmInvites';

const base = {
  orgName: 'Le Rex', contactName: 'Kevin Martin', url: 'https://crm.yunoapp.eu/fr/start?offer=abc123',
  freeMonths: 0, yunits: 0, priceMonth: 24, trialDays: 14, trialYunits: 2000, expiresAt: '2026-11-16T12:00:00Z',
};
const nb = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

describe('invitation Yuno CRM : e-mail', () => {
  it('essai standard : objet, essai et Yunits de l’essai, prix, bouton', () => {
    const m = buildCrmInviteEmail({ ...base, lang: 'fr', offer: 'standard' });
    expect(m.subject).toBe('Le Rex, votre compte Yuno CRM vous attend');
    expect(m.html).toContain('href="https://crm.yunoapp.eu/fr/start?offer=abc123"');
    expect(m.html).toContain('Bonjour Kevin,');
    expect(m.html).toContain('14 jours d’essai, sans carte bancaire');
    expect(nb(m.html)).toContain('2 000 Yunits offerts pendant l’essai');
    expect(m.html).toContain('Ensuite 24 € HT / mois');
    expect(m.html).not.toContain('Mot de passe');
    expect(m.text).toContain(base.url);
  });

  it('offre fondateurs : mêmes promesses que l’e-mail de 20261017230000', () => {
    const m = buildCrmInviteEmail({ ...base, lang: 'fr', offer: 'founder', freeMonths: 6, yunits: 15000 });
    expect(m.subject).toBe('Le Rex × Yuno CRM : votre offre fondateur');
    expect(m.html).toContain('6 mois de Yuno CRM offerts à Le Rex');
    expect(nb(m.html)).toContain('15 000 Yunits offerts à l’ouverture du compte');
    const es = buildCrmInviteEmail({ ...base, lang: 'es', offer: 'founder', freeMonths: 6, yunits: 15000 });
    expect(es.subject).toBe('Le Rex × Yuno CRM: su oferta fundador');
  });

  it('joint la démo (lien + mot de passe) et l’accès assisté quand ils sont demandés', () => {
    const m = buildCrmInviteEmail({ ...base, lang: 'en', offer: 'standard', supportOffer: true, demo: { url: 'https://crm.yunoapp.eu/crm/preview?token=t0k', password: 'k7p2qm' } });
    expect(m.html).toContain('href="https://crm.yunoapp.eu/crm/preview?token=t0k"');
    expect(m.html).toContain('k7p2qm');
    expect(m.html).toContain('We set it up with you');
    expect(m.text).toContain('Password: k7p2qm');
  });

  it('échappe le nom de l’organisation et le mot de passe', () => {
    const m = buildCrmInviteEmail({ ...base, lang: 'fr', offer: 'standard', orgName: 'A <b>&</b> B', demo: { url: 'https://x.yunoapp.eu', password: '<i>' } });
    expect(m.html).not.toContain('<b>&</b>');
    expect(m.html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
    expect(m.html).not.toContain('<i>');
  });

  it('le message WhatsApp dit la même chose', () => {
    const w = crmInviteWhatsAppText({ ...base, lang: 'fr', offer: 'standard', supportOffer: true, demo: { url: 'https://crm.yunoapp.eu/crm/preview?token=t0k', password: 'k7p2qm' } });
    expect(w.startsWith('Bonjour Kevin,')).toBe(true);
    expect(w).toContain(base.url);
    expect(w).toContain('Mot de passe : k7p2qm');
    expect(w).toContain('l’équipe Yuno met votre compte en place avec vous');
    const en = crmInviteWhatsAppText({ ...base, lang: 'en', offer: 'standard', contactName: null });
    expect(en.startsWith('Hi,')).toBe(true);
  });
});

describe('accès démo : e-mail et WhatsApp', () => {
  const demo = { contactName: 'Nina', url: 'https://crm.yunoapp.eu/crm/preview?token=t0k', password: 'k7p2qm', expiresAt: '2026-11-16T12:00:00Z' };
  it('porte le lien, le mot de passe, la date de fin et l’inscription si une invitation est liée', () => {
    const m = buildCrmDemoEmail({ ...demo, lang: 'fr', signupUrl: 'https://crm.yunoapp.eu/fr/start?offer=abc' });
    expect(m.subject).toBe('Votre accès à la démo de Yuno CRM');
    expect(m.html).toContain('href="https://crm.yunoapp.eu/crm/preview?token=t0k"');
    expect(m.html).toContain('k7p2qm');
    expect(m.html).toContain('16 novembre 2026');
    expect(m.html).toContain('href="https://crm.yunoapp.eu/fr/start?offer=abc"');
    const w = crmDemoWhatsAppText({ ...demo, lang: 'es' });
    expect(w.startsWith('Hola, Nina:')).toBe(true);
    expect(w).toContain('Su contraseña: k7p2qm');
  });
});

describe('accès assisté : e-mail Yuno CRM', () => {
  it('mène à la page de consentement de la Console CRM, motif compris', () => {
    const m = buildCrmSupportEmail({ lang: 'fr', contactName: 'Kevin', reason: 'Brancher Shotgun', url: 'https://crm.yunoapp.eu/crm/account/support?approve=g1' });
    expect(m.html).toContain('href="https://crm.yunoapp.eu/crm/account/support?approve=g1"');
    expect(m.html).toContain('Motif : Brancher Shotgun');
    expect(m.html).toContain('Rien ne s’ouvre tant que vous n’avez pas accepté');
  });
});

describe('états affichés', () => {
  const inv = { status: 'pending' as const, opened_at: null, emailed_at: null, shared_at: null, journey: null };
  it('une invitation avance : prête, envoyée, ouverte, inscription, compte', () => {
    expect(inviteStage(inv)).toBe('ready');
    expect(inviteStage({ ...inv, shared_at: '2026-10-18T10:00:00Z' })).toBe('sent');
    expect(inviteStage({ ...inv, opened_at: '2026-10-18T10:00:00Z' })).toBe('opened');
    expect(inviteStage({ ...inv, opened_at: '2026-10-18T10:00:00Z', journey: { started_at: 'x', last_step: 'role' } })).toBe('started');
    expect(inviteStage({ ...inv, opened_at: 'x', journey: { started_at: 'x', last_step: 'opened' } })).toBe('opened');
    expect(inviteStage({ ...inv, status: 'claimed' })).toBe('claimed');
    expect(inviteStage({ ...inv, status: 'expired' })).toBe('expired');
  });
  it('un accès démo ne vit que prêt ou ouvert', () => {
    expect(demoIsLive('ready')).toBe(true);
    expect(demoIsLive('opened')).toBe(true);
    expect(demoIsLive('revoked')).toBe(false);
    expect(demoIsLive('locked')).toBe(false);
  });
  it('initiales', () => {
    expect(initialsOf('Kevin Martin')).toBe('KM');
    expect(initialsOf('3AM')).toBe('3');
    expect(initialsOf('')).toBe('·');
  });
});
