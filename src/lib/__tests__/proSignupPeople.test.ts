import { describe, expect, it } from 'vitest';
import { alertChannels, journeyResult, personPhones, sourceRows, sourceText } from '../proSignupPeople';

const t = (k: string) => `<${k.replace('adm.signups.src.', '')}>`;

describe('personPhones', () => {
  it('folds the same number typed with and without the leading 0 (Pascal, 19/10)', () => {
    expect(personPhones(['756388760', '0756388760'], 'FR')).toEqual([
      { e164: '+33756388760', pretty: '+33 7 56 38 87 60', wa: '33756388760' },
    ]);
  });
  it('reads a number in the country of the person', () => {
    expect(personPhones(['629111561'], 'ES')).toEqual([{ e164: '+34629111561', pretty: '+34 629 111 561', wa: '34629111561' }]);
  });
  it('keeps two different numbers and drops garbage', () => {
    expect(personPhones(['+33769012254', '123', null, '0612345678']).map((p) => p.pretty))
      .toEqual(['+33 7 69 01 22 54', '+33 6 12 34 56 78']);
  });
});

describe('sourceText', () => {
  it('names the channel then the page, in the language of the screen', () => {
    expect(sourceText({ source: 'landing', utm_source: 'chatgpt.com' }, t)).toBe('ChatGPT → <landing>');
    expect(sourceText({ source: 'start', utm_source: 'yuno_app' }, t)).toBe('<yunoApp> → <start>');
    expect(sourceText({ source: 'landing-fr', referrer_host: 'www.google.com' }, t)).toBe('Google → <landing>');
    expect(sourceText({ source: 'demo_preview', utm_source: 'demo' }, t)).toBe('<demo_preview>');
    expect(sourceText({ source: 'weird' }, t)).toBe('weird');
    expect(sourceText(null, t)).toBe('<unknown>');
  });
});

describe('sourceRows', () => {
  it('merges origins that read the same', () => {
    expect(sourceRows([
      { origin: { source: 'landing' }, started: 3, created: 0 },
      { origin: { source: 'landing', referrer_host: 'www.google.com' }, started: 4, created: 4 },
      { origin: { source: 'landing-es' }, started: 1, created: 1 },
    ], t)).toEqual([
      { label: 'Google → <landing>', started: 4, created: 4 },
      { label: '<landing>', started: 4, created: 1 },
    ]);
  });
});

describe('journeyResult', () => {
  it('says what happened to one journey', () => {
    expect(journeyResult({ account: true, deleted: false, step: 'console', account_created_at: 'x' }).key).toBe('account');
    expect(journeyResult({ account: false, deleted: true, step: 'console', account_created_at: 'x' }).key).toBe('deleted');
    expect(journeyResult({ account: false, deleted: false, step: 'lead', account_created_at: null }).key).toBe('request');
    expect(journeyResult({ account: false, deleted: false, step: 'account', account_created_at: null }))
      .toEqual({ key: 'stopped', step: 'account' });
    expect(journeyResult({ account: false, deleted: false, step: null, account_created_at: null }).step).toBe('opened');
  });
});

describe('alertChannels', () => {
  it('lists the channels that reached Paul', () => {
    expect(alertChannels({ kind: 'retry', status: 'sent', at: '', sent_at: '', cockpit: true, push: false, telegram: true, email: true }))
      .toEqual(['cockpit', 'telegram', 'email']);
  });
});
