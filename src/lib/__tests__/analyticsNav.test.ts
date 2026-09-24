import { describe, expect, it } from 'vitest';
import { analyticsHref, eventReportHref, needsCanonicalUrl, resolveAnalyticsRoute } from '../analyticsNav';

describe('resolveAnalyticsRoute', () => {
  it('ouvre Ventes par défaut', () => {
    expect(resolveAnalyticsRoute(null, null)).toEqual({ family: 'sales', view: 'overview' });
    expect(resolveAnalyticsRoute('nimportequoi', 'x')).toEqual({ family: 'sales', view: 'overview' });
  });
  it('traduit les anciens onglets', () => {
    expect(resolveAnalyticsRoute('global', null)).toEqual({ family: 'sales', view: 'overview' });
    expect(resolveAnalyticsRoute('event', null, true)).toEqual({ family: 'sales', view: 'event' });
    expect(resolveAnalyticsRoute('purchase', null)).toEqual({ family: 'community', view: 'purchase' });
  });
  it('garde une vue valide, remplace une vue inconnue par la première de la famille', () => {
    expect(resolveAnalyticsRoute('traffic', 'sources')).toEqual({ family: 'traffic', view: 'sources' });
    expect(resolveAnalyticsRoute('traffic', 'overview')).toEqual({ family: 'traffic', view: 'page' });
    expect(resolveAnalyticsRoute('community', null)).toEqual({ family: 'community', view: 'overview' });
  });
  it('une soirée sans vue ouvre son rapport', () => {
    expect(resolveAnalyticsRoute('sales', null, true)).toEqual({ family: 'sales', view: 'event' });
    expect(resolveAnalyticsRoute(null, null, true)).toEqual({ family: 'sales', view: 'event' });
    expect(resolveAnalyticsRoute('sales', 'partners', true)).toEqual({ family: 'sales', view: 'partners' });
  });
});

describe('adresses', () => {
  it('réécrit ce qui n’est pas canonique', () => {
    expect(needsCanonicalUrl('global', null, resolveAnalyticsRoute('global', null))).toBe(true);
    expect(needsCanonicalUrl('sales', 'overview', resolveAnalyticsRoute('sales', 'overview'))).toBe(false);
    expect(needsCanonicalUrl('live', null, resolveAnalyticsRoute('live', null))).toBe(false);
  });
  it('construit les liens', () => {
    expect(analyticsHref('/owner/analytics', 'traffic')).toBe('/owner/analytics?tab=traffic&view=page');
    expect(analyticsHref('/owner/analytics', 'live')).toBe('/owner/analytics?tab=live');
    expect(eventReportHref('/organizer-app/analytics', 'e1')).toBe('/organizer-app/analytics?tab=sales&view=event&event=e1');
  });
});
