import { describe, expect, it } from 'vitest';
import { an3Href, an3NeedsCanonicalUrl, an3Window, parseAn3Route, writeAn3Route } from '../analytics/an3Nav';

const P = (s: string) => new URLSearchParams(s);

describe('adresse d un écran Analytics v3', () => {
  it('lit les sept onglets et retombe sur la vue d ensemble', () => {
    expect(parseAn3Route(P('tab=door')).tab).toBe('door');
    expect(parseAn3Route(P('tab=nope')).tab).toBe('overview');
    expect(parseAn3Route(P('')).tab).toBe('overview');
  });
  it('traduit les anciennes adresses des quatre familles', () => {
    expect(parseAn3Route(P('tab=sales&view=overview')).tab).toBe('overview');
    expect(parseAn3Route(P('tab=sales&view=partners')).tab).toBe('promoters');
    expect(parseAn3Route(P('tab=traffic&view=page')).tab).toBe('sources');
    expect(parseAn3Route(P('tab=community&view=purchase')).tab).toBe('sales');
    expect(parseAn3Route(P('tab=community&view=subscribers')).tab).toBe('audience');
    expect(parseAn3Route(P('tab=live')).tab).toBe('tonight');
    expect(parseAn3Route(P('tab=global')).tab).toBe('overview');
  });
  it('garde la soirée, la période et la comparaison', () => {
    const r = parseAn3Route(P('tab=overview&event=3FB4E1D2-66ea-4154-b707-327ea7e2af59&period=90d&compare=median5'));
    expect(r.eventId).toBe('3fb4e1d2-66ea-4154-b707-327ea7e2af59');
    expect(r.period).toBe('90d');
    expect(r.compare).toBe('median5');
    expect(parseAn3Route(P('event=abc')).eventId).toBeNull();
    expect(parseAn3Route(P('period=1y')).period).toBe('30d');
    expect(parseAn3Route(P('compare=zzz')).compare).toBe('comparable');
  });
  it('accepte une période personnalisée seulement avec deux dates valides', () => {
    expect(parseAn3Route(P('period=custom&from=2026-09-01&to=2026-09-30')).period).toBe('custom');
    expect(parseAn3Route(P('period=custom&from=2026-09-30&to=2026-09-01')).period).toBe('30d');
    expect(parseAn3Route(P('period=custom')).period).toBe('30d');
  });
  it('sait quand réécrire l URL', () => {
    expect(an3NeedsCanonicalUrl(P('tab=sales&view=overview'), parseAn3Route(P('tab=sales&view=overview')))).toBe(true);
    expect(an3NeedsCanonicalUrl(P('tab=door&period=7d'), parseAn3Route(P('tab=door&period=7d')))).toBe(false);
  });
  it('écrit une route sans perdre les autres paramètres', () => {
    const next = writeAn3Route(P('tab=overview&foo=1&view=x'), { tab: 'sales', eventId: null, compare: 'comparable' });
    expect(next.get('tab')).toBe('sales');
    expect(next.get('foo')).toBe('1');
    expect(next.has('view')).toBe(false);
    expect(next.has('compare')).toBe(false);
    expect(an3Href('/owner/analytics', { tab: 'door', eventId: '3fb4e1d2-66ea-4154-b707-327ea7e2af59' }))
      .toBe('/owner/analytics?tab=door&period=30d&event=3fb4e1d2-66ea-4154-b707-327ea7e2af59');
  });
  it('donne une fenêtre en instants', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(an3Window(parseAn3Route(P('period=7d')), now)).toEqual({ from: '2026-09-24T10:00:00.000Z', to: '2026-10-01T10:00:00.000Z' });
    expect(an3Window(parseAn3Route(P('period=custom&from=2026-09-01&to=2026-09-30')), now))
      .toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' });
  });
});
