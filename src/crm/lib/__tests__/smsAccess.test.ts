import { describe, expect, it } from 'vitest';
import { SMS_USE_CASES, SMS_VOLUMES, smsAccessSteps } from '@/crm/lib/smsAccess';
import { CRM_DICT } from '@/i18n/locales/crm/modules';
import { NOTIF_KINDS } from '@/crm/shell/notifCopy';

describe('SMS en bêta privée : étapes de l’ouverture', () => {
  it('sans demande, la demande est l’étape en cours', () => {
    expect(smsAccessSteps('none')).toEqual({ request: 'now', check: 'next', line: 'next', first: 'next' });
  });
  it('un refus se lit comme une demande à refaire', () => {
    expect(smsAccessSteps('declined')).toEqual(smsAccessSteps('none'));
  });
  it('une demande envoyée passe à la vérification', () => {
    expect(smsAccessSteps('requested')).toEqual({ request: 'done', check: 'now', line: 'next', first: 'next' });
  });
  it('un accès ouvert mène au premier SMS de test', () => {
    expect(smsAccessSteps('granted')).toEqual({ request: 'done', check: 'done', line: 'done', first: 'now' });
  });
});

describe('SMS en bêta privée : textes', () => {
  const keys = [
    ...SMS_USE_CASES.map((u) => `yc.smsBeta.use.${u}`),
    ...SMS_VOLUMES.map((v) => `yc.smsBeta.vol.${v}`),
    ...['request', 'check', 'line', 'first'].flatMap((k) => [`yc.smsBeta.st.${k}`, `yc.smsBeta.st.${k}s`]),
    'yc.notif.sms_access_granted.title', 'yc.notif.sms_access_granted.body', 'yc.notif.sms_access_granted.action',
    'yc.nav.beta', 'yc.cli.msg.smsBeta', 'yc.cli.msg.smsRequested', 'yc.scn.betaAsk', 'yc.pr.beta', 'yc.pr.f.campaigns.dBeta',
  ];
  it('chaque clé existe en trois langues', () => {
    const dict = CRM_DICT as Record<string, readonly string[]>;
    const bad = keys.filter((k) => !dict[k] || dict[k].length !== 3 || dict[k].some((x) => !x?.trim()));
    expect(bad).toEqual([]);
  });
  it('la notification d’ouverture est un kind connu du fil', () => {
    expect(NOTIF_KINDS).toContain('sms_access_granted');
  });
});
