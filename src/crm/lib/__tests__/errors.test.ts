import { describe, expect, it } from 'vitest';
import { classifyLoadError, loginUrl, makeErrorRef, retryDelaySeconds } from '../errors';

describe('états d’erreur : qualification', () => {
  it('reconnaît un délai dépassé, un refus et une panne de réseau', () => {
    expect(classifyLoadError({ code: 'timeout' })).toBe('timeout');
    expect(classifyLoadError({ code: '42501', message: 'permission denied' })).toBe('forbidden');
    expect(classifyLoadError({ message: 'TypeError: Failed to fetch' })).toBe('offline');
    expect(classifyLoadError({ message: 'boom' }, false)).toBe('offline');
    expect(classifyLoadError({ message: 'boom' })).toBe('generic');
    expect(classifyLoadError(null)).toBe('generic');
  });
  it('un délai gagne sur l’absence de réseau', () => {
    expect(classifyLoadError({ code: 'timeout' }, false)).toBe('timeout');
  });
});

describe('états d’erreur : références et adresses', () => {
  it('fabrique des références lisibles', () => {
    expect(makeErrorRef('500', () => 0.5)).toBe('YN-500-888888');
    expect(makeErrorRef('TMO', () => 0)).toBe('TMO-0000');
    expect(makeErrorRef('500')).toMatch(/^YN-500-[0-9A-F]{6}$/);
  });
  it('ne ramène jamais hors de l’app après la connexion', () => {
    expect(loginUrl('/crm/segments')).toBe('/auth?redirect=%2Fcrm%2Fsegments');
    expect(loginUrl('//evil.com')).toBe('/auth?redirect=%2Fcrm');
    expect(loginUrl('https://evil.com')).toBe('/auth?redirect=%2Fcrm');
  });
  it('réessaie à 5 s puis toutes les 10 s', () => {
    expect([0, 1, 2].map(retryDelaySeconds)).toEqual([5, 10, 10]);
  });
});
