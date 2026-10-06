import { describe, expect, it } from 'vitest';
import smsDict from '@/i18n/locales/crm/modules/sms';
import {
  countSms, defaultSender, displayPhone, inQuiet, resolveSmsVars, simplifySms, SMS_TEMPLATES, smsBestSlots, smsCost,
  smsDraftGaps, smsEffectiveAt, smsFinalText, toE164, validSender,
} from '@/crm/lib/sms';

const LANGS = ['en', 'fr', 'es'] as const;
const sample = { 'prénom': 'Camille', nom_club: 'Le Bunker', 'soirée': 'Techno Night', lien: 'yunoapp.eu/l/k7Qp2xRa' };

describe('SMS CRM : texte qui part', () => {
  it('remplit les variables connues et laisse les autres visibles', () => {
    expect(resolveSmsVars('Salut {{prénom}}, {{soiree}} : {{lien}}', sample)).toBe('Salut Camille, Techno Night : yunoapp.eu/l/k7Qp2xRa');
    expect(resolveSmsVars('{{ prenom }} et {{inconnue}}', sample)).toBe('Camille et {{inconnue}}');
    expect(resolveSmsVars('Bonsoir {{prénom}} !', { 'prénom': '' })).toBe('Bonsoir !');
  });

  it('ajoute le nom d’expéditeur et la mention STOP comme le moteur', () => {
    const fr = smsFinalText('Ce soir {{soirée}}', { sender: 'LEBUNKER', lang: 'fr', vals: sample });
    expect(fr.startsWith('LEBUNKER')).toBe(true);
    expect(fr).toContain('Ce soir Techno Night');
    // Les clients du CRM ont un numéro français : la mention est le code court d'Octopush.
    expect(fr.endsWith('STOP au 30101')).toBe(true);
    expect(smsFinalText('Last tickets', { sender: 'BUNKER', lang: 'en', vals: sample })).toMatch(/STOP au 30101$/);
  });

  it('compte les SMS : 160 puis 153 en GSM-7, 70 puis 67 dès un caractère spécial', () => {
    expect(countSms('a'.repeat(160))).toMatchObject({ parts: 1, encoding: 'GSM-7', left: 0 });
    expect(countSms('a'.repeat(161))).toMatchObject({ parts: 2, encoding: 'GSM-7', left: 306 - 161 });
    const u = countSms(`${'a'.repeat(69)}ô`);
    expect(u).toMatchObject({ parts: 1, encoding: 'UCS-2', bad: ['ô'] });
    expect(countSms(`${'a'.repeat(70)}ô`).parts).toBe(2);
  });

  it('simplifie les caractères qui coûtent cher', () => {
    const s = simplifySms('L’été « ça » arrive… 🎉');
    expect(countSms(s).encoding).toBe('GSM-7');
    // « é » est dans l'alphabet SMS standard : il reste ; « ç », les guillemets et l'émoji partent.
    expect(s).toContain('L\'été " ca " arrive...');
    expect(s).not.toContain('🎉');
  });

  it('chaque modèle part en GSM-7 dans les trois langues', () => {
    for (const tpl of SMS_TEMPLATES) {
      const row = smsDict[`yc.sm.tpl.${tpl.id}.body`];
      expect(row, tpl.id).toBeDefined();
      LANGS.forEach((lang, i) => {
        const body = row[i];
        if (!body) return;
        const k = countSms(smsFinalText(body, { sender: 'LEBUNKER', lang, vals: sample }));
        expect(k.bad, `${tpl.id} ${lang}`).toEqual([]);
        expect(k.encoding, `${tpl.id} ${lang}`).toBe('GSM-7');
      });
    }
  });
});

describe('SMS CRM : expéditeur, numéro, coût', () => {
  it('tire un nom d’expéditeur valable du nom de l’espace', () => {
    expect(defaultSender('Le Bunker')).toBe('LEBUNKER');
    expect(defaultSender('Café de l’Été — Paris 11e')).toBe('CAFEDELETEP');
    expect(defaultSender('Ô')).toBe('YUNO');
    expect(validSender('LEBUNKER')).toBe(true);
    expect(validSender('LE BUNKER')).toBe(false);
    expect(validSender('AB')).toBe(false);
    expect(validSender('ÉTÉ2026')).toBe(false);
  });

  it('met un numéro au format international', () => {
    expect(toE164('06 12 34 56 78')).toBe('+33612345678');
    expect(toE164('+44 7700 900123')).toBe('+447700900123');
    expect(toE164('0034 612 345 678')).toBe('+34612345678');
    expect(toE164('12')).toBeNull();
    expect(toE164('')).toBeNull();
    expect(displayPhone('+33612345678')).toBe('06 12 34 56 78');
    expect(displayPhone('+447700900123')).toBe('+447700900123');
  });

  it('compte les Yunits : contacts × SMS × tarif', () => {
    expect(smsCost(100, 2, 40)).toBe(8000);
    expect(smsCost(100, 0, 40)).toBe(4000);
    expect(smsCost(-3, 1, 40)).toBe(0);
  });

  it('dit ce qu’il manque à un brouillon', () => {
    expect(smsDraftGaps({ body: '', audiences: [], scheduled_at: null })).toEqual(['body', 'audience', 'date']);
    expect(smsDraftGaps({ body: 'Ce soir', audiences: [{ kind: 'crm', key: 'hab' }], scheduled_at: '2026-10-10T16:00:00Z' })).toEqual([]);
    expect(smsDraftGaps({ body: 'Ce soir', audiences: [{ kind: 'all' }], scheduled_at: null })).toEqual(['audience', 'date']);
  });
});

describe('SMS CRM : heures d’envoi', () => {
  const q = { on: true, from: 20, to: 8, noSunday: true };

  it('reconnaît les heures calmes à cheval sur minuit', () => {
    expect(inQuiet(21, 20, 8)).toBe(true);
    expect(inQuiet(7, 20, 8)).toBe(true);
    expect(inQuiet(8, 20, 8)).toBe(false);
    expect(inQuiet(19.5, 20, 8)).toBe(false);
    expect(inQuiet(12, 12, 12)).toBe(false);
  });

  it('décale un SMS prévu la nuit au matin suivant', () => {
    const r = smsEffectiveAt(new Date(2026, 9, 9, 22, 30), q); // vendredi 22 h 30
    expect(r.shifted).toBe(true);
    expect(r.at).toEqual(new Date(2026, 9, 10, 8, 0));
  });

  it('décale un SMS prévu tôt le matin à l’heure de fin du même jour', () => {
    const r = smsEffectiveAt(new Date(2026, 9, 9, 6, 0), q);
    expect(r.at).toEqual(new Date(2026, 9, 9, 8, 0));
  });

  it('repousse le dimanche au lundi matin', () => {
    const r = smsEffectiveAt(new Date(2026, 9, 11, 15, 0), q); // dimanche 15 h
    expect(r.at).toEqual(new Date(2026, 9, 12, 8, 0));
    const late = smsEffectiveAt(new Date(2026, 9, 10, 23, 0), q); // samedi 23 h → dimanche → lundi
    expect(late.at).toEqual(new Date(2026, 9, 12, 8, 0));
  });

  it('ne touche à rien hors des heures calmes ou sans elles', () => {
    const at = new Date(2026, 9, 9, 18, 0);
    expect(smsEffectiveAt(at, q)).toEqual({ at, shifted: false });
    expect(smsEffectiveAt(new Date(2026, 9, 9, 21, 0), { ...q, on: false }).shifted).toBe(false);
  });

  it('ne fait jamais partir un SMS entre 21 h 30 et 8 h, heures calmes ou non', () => {
    const off = { ...q, on: false };
    expect(smsEffectiveAt(new Date(2026, 9, 9, 3, 0), off).at).toEqual(new Date(2026, 9, 9, 8, 0));
    expect(smsEffectiveAt(new Date(2026, 9, 9, 21, 45), off).at).toEqual(new Date(2026, 9, 10, 8, 0));
    // Heures calmes réglées après 21 h 30 : la nuit légale l'emporte.
    expect(smsEffectiveAt(new Date(2026, 9, 9, 21, 40), { ...q, from: 23 }).at).toEqual(new Date(2026, 9, 10, 8, 0));
  });

  it('repousse un jour férié au lendemain matin', () => {
    // Mercredi 11 novembre 2026, 15 h → jeudi 12 à 8 h.
    expect(smsEffectiveAt(new Date(2026, 10, 11, 15, 0), q).at).toEqual(new Date(2026, 10, 12, 8, 0));
    // Lundi de Pentecôte 2027 (17 mai).
    expect(smsEffectiveAt(new Date(2027, 4, 17, 10, 0), q).at).toEqual(new Date(2027, 4, 18, 8, 0));
  });

  it('classe les meilleurs jours (0 = lundi) et heures dès trois SMS', () => {
    expect(smsBestSlots([{ dow: 5, hour: 18, delivered: 100, clicked: 30 }])).toEqual({ days: [], hours: [] });
    const r = smsBestSlots([
      { dow: 5, hour: 18, delivered: 100, clicked: 36 },
      { dow: 4, hour: 11, delivered: 100, clicked: 29 },
      { dow: 6, hour: 11, delivered: 100, clicked: 7 },
    ]);
    expect(r.days).toEqual([4, 3]);
    expect(r.hours).toEqual([18, 11]);
  });
});
