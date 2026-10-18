import { describe, expect, it } from 'vitest';
import { buildFounderOfferEmail, founderOfferWhatsAppText, inviteBadge, waDigits, whatsAppUrl } from '../founderOffer';

const base = {
  orgName: '3AM', contactName: 'Kevin Martin', url: 'https://crm.yunoapp.eu/fr/start?offer=abc123',
  freeMonths: 6, yunits: 15000, priceMonth: 24, expiresAt: '2026-11-16T12:00:00Z',
};

describe('offre fondateurs : WhatsApp', () => {
  it('garde les chiffres du numéro, sinon laisse WhatsApp choisir le contact', () => {
    expect(waDigits('+33 6 12 34 56 78')).toBe('33612345678');
    expect(waDigits('')).toBeNull();
    expect(waDigits('12')).toBeNull();
    expect(whatsAppUrl('+33 6 12 34 56 78', 'Bonjour & bienvenue')).toBe('https://wa.me/33612345678?text=Bonjour%20%26%20bienvenue');
    expect(whatsAppUrl(null, 'x')).toBe('https://wa.me/?text=x');
  });

  it('le message porte le lien, le prénom, les mois et les Yunits', () => {
    const fr = founderOfferWhatsAppText({ ...base, lang: 'fr' });
    expect(fr).toContain('Bonjour Kevin,');
    expect(fr).toContain(base.url);
    expect(fr).toContain('6 mois d’abonnement offerts');
    expect(fr.replace(/\u202f|\u00a0/g, ' ')).toContain('15 000 Yunits');
    expect(fr).toContain('24 € HT / mois');
    const en = founderOfferWhatsAppText({ ...base, lang: 'en', contactName: null });
    expect(en.startsWith('Hi,')).toBe(true);
    expect(en).toContain('15,000 Yunits');
  });
});

describe('offre fondateurs : e-mail', () => {
  it('objet, bouton et lien dans la langue de l’invitation', () => {
    const fr = buildFounderOfferEmail({ ...base, lang: 'fr' });
    expect(fr.subject).toBe('3AM × Yuno CRM : votre offre fondateur');
    expect(fr.html).toContain('href="https://crm.yunoapp.eu/fr/start?offer=abc123"');
    expect(fr.html).toContain('Créer mon compte');
    expect(fr.html).toContain('6 mois de Yuno CRM offerts à 3AM');
    expect(fr.text).toContain(base.url);
    const es = buildFounderOfferEmail({ ...base, lang: 'es' });
    expect(es.subject).toBe('3AM × Yuno CRM: su oferta fundador');
    expect(es.html).toContain('Crear mi cuenta');
  });

  it('échappe le nom de l’organisation', () => {
    const m = buildFounderOfferEmail({ ...base, lang: 'fr', orgName: 'A <b>&</b> B' });
    expect(m.html).not.toContain('<b>&</b>');
    expect(m.html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
  });
});

describe('offre fondateurs : statut affiché', () => {
  it('distingue un lien ouvert d’un lien encore jamais ouvert', () => {
    expect(inviteBadge({ status: 'pending', opened_at: null })).toBe('pending');
    expect(inviteBadge({ status: 'pending', opened_at: '2026-10-17T10:00:00Z' })).toBe('opened');
    expect(inviteBadge({ status: 'claimed', opened_at: '2026-10-17T10:00:00Z' })).toBe('claimed');
    expect(inviteBadge({ status: 'expired', opened_at: null })).toBe('expired');
  });
});
