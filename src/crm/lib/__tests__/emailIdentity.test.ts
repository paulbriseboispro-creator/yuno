import { describe, expect, it } from 'vitest';
import { formMissing, fromLine, isIdentityRefusal, legalNameOk, postalAddressOk, previewIdentity, senderNameOk } from '../emailIdentity';

// Miroir des règles de _crm_email_identity (migration 20261019103000).
describe('identité de l’expéditeur (Réglages › Envoi)', () => {
  it('nom affiché : 2 à 60 caractères, rien qui casse l’en-tête « De : »', () => {
    expect(senderNameOk('WOH')).toBe(true);
    expect(senderNameOk(' W ')).toBe(false);
    expect(senderNameOk('x'.repeat(61))).toBe(false);
    expect(senderNameOk('W<OH>')).toBe(false);
    expect(senderNameOk('Le "Club"')).toBe(false);
  });

  it('raison sociale : 2 à 160 caractères', () => {
    expect(legalNameOk('WOH Productions SAS')).toBe(true);
    expect(legalNameOk('')).toBe(false);
    expect(legalNameOk('x'.repeat(161))).toBe(false);
  });

  it('adresse postale : une vraie adresse, pas une ville', () => {
    expect(postalAddressOk('10 rue Oberkampf, 75011 Paris')).toBe(true);
    expect(postalAddressOk('Calle de Alcalá 12, 28014 Madrid')).toBe(true);
    expect(postalAddressOk('Paris')).toBe(false);
    expect(postalAddressOk('Paris, France')).toBe(false); // aucun chiffre
    expect(postalAddressOk('75011 75011')).toBe(false); // aucune lettre
    expect(postalAddressOk('   ')).toBe(false);
  });

  it('formMissing liste exactement ce que la base refuserait', () => {
    expect(formMissing({ sender_name: '', legal_name: '', postal_address: 'Madrid' }))
      .toEqual(['sender_name', 'legal_name', 'postal_address']);
    expect(formMissing({ sender_name: 'WOH', legal_name: 'WOH SAS', postal_address: '10 rue Oberkampf, 75011 Paris' })).toEqual([]);
  });

  it('« De : » = nom affiché + adresse fixée par Yuno', () => {
    expect(fromLine('WOH', 'amoris', 'news.yunoapp.eu')).toBe('WOH <amoris@news.yunoapp.eu>');
    expect(fromLine(' W"OH ', 'amoris', 'news.yunoapp.eu')).toBe('WOH <amoris@news.yunoapp.eu>');
  });

  it('l’aperçu rend la marque et le pied de page de l’envoi', () => {
    expect(previewIdentity({ sender_name: 'WOH', legal_name: 'WOH SAS', postal_address: ' 10 rue X, 75011 Paris ' }, 'Amoris'))
      .toEqual({ venueName: 'WOH', legalName: 'WOH SAS', postalAddress: '10 rue X, 75011 Paris' });
    expect(previewIdentity(null, 'Amoris')).toEqual({ venueName: 'Amoris', legalName: null, postalAddress: null });
  });

  it('reconnaît le refus du serveur', () => {
    expect(isIdentityRefusal('{"error":"crm_sender_identity","missing":["postal_address"]}')).toBe(true);
    expect(isIdentityRefusal('crm_paused')).toBe(false);
  });
});
