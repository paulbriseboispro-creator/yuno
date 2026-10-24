import { describe, expect, it } from 'vitest';
import { analysesHrefFromLegacy, analyticsHref, eventReportHref, needsCanonicalUrl, resolveAnalyticsRoute } from '../analyticsNav';

describe('resolveAnalyticsRoute', () => {
  it('ouvre Ventes par défaut', () => {
    expect(resolveAnalyticsRoute(null, null)).toEqual({ family: 'sales', view: 'overview' });
    expect(resolveAnalyticsRoute('nimportequoi', 'x')).toEqual({ family: 'sales', view: 'overview' });
  });
  it('traduit les anciens onglets', () => {
    expect(resolveAnalyticsRoute('global', null)).toEqual({ family: 'sales', view: 'overview' });
    expect(resolveAnalyticsRoute('event', null)).toEqual({ family: 'sales', view: 'overview' });
    expect(resolveAnalyticsRoute('purchase', null)).toEqual({ family: 'community', view: 'purchase' });
  });
  it('garde une vue valide, remplace une vue inconnue par la première de la famille', () => {
    expect(resolveAnalyticsRoute('traffic', 'events')).toEqual({ family: 'traffic', view: 'events' });
    expect(resolveAnalyticsRoute('traffic', 'overview')).toEqual({ family: 'traffic', view: 'page' });
    expect(resolveAnalyticsRoute('community', null)).toEqual({ family: 'community', view: 'overview' });
  });
  it('les vues fondues ouvrent leur nouvelle maison', () => {
    expect(resolveAnalyticsRoute('traffic', 'sources')).toEqual({ family: 'traffic', view: 'page' });
    expect(resolveAnalyticsRoute('community', 'tastes')).toEqual({ family: 'community', view: 'demographics' });
    expect(needsCanonicalUrl('traffic', 'sources', resolveAnalyticsRoute('traffic', 'sources'))).toBe(true);
  });
  it("l'ancienne vue « Par soirée » ouvre la Vue d'ensemble", () => {
    expect(resolveAnalyticsRoute('sales', 'event')).toEqual({ family: 'sales', view: 'overview' });
    expect(needsCanonicalUrl('sales', 'event', resolveAnalyticsRoute('sales', 'event'))).toBe(true);
    expect(resolveAnalyticsRoute('sales', 'partners')).toEqual({ family: 'sales', view: 'partners' });
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
    expect(eventReportHref('/organizer-app/analytics', 'e1')).toBe('/organizer-app/analyses/sales?e=e1');
    expect(eventReportHref('/owner/analytics', 'e2')).toBe('/owner/analyses/sales?e=e2');
  });
});

describe('analysesHrefFromLegacy (lot 8)', () => {
  it('traduit chaque famille et vue vers les Analyses', () => {
    expect(analysesHrefFromLegacy('/owner', '')).toBe('/owner/analyses/sales');
    expect(analysesHrefFromLegacy('/owner', '?tab=sales&view=overview&event=e1')).toBe('/owner/analyses/sales?e=e1');
    expect(analysesHrefFromLegacy('/owner', '?tab=sales&view=partners')).toBe('/owner/analyses/partners');
    expect(analysesHrefFromLegacy('/organizer-app', '?tab=traffic&view=events&event=e1')).toBe('/organizer-app/analyses/traffic?e=e1');
    expect(analysesHrefFromLegacy('/owner', '?tab=community&view=overview')).toBe('/owner/analyses/community');
    expect(analysesHrefFromLegacy('/owner', '?tab=community&view=subscribers')).toBe('/owner/analyses/community?cv=subscribers');
    expect(analysesHrefFromLegacy('/manager', '?tab=community&view=purchase')).toBe('/manager/analyses/community?cv=purchase');
    expect(analysesHrefFromLegacy('/owner', '?tab=community&view=demographics')).toBe('/owner/analyses/community?cv=audience');
    expect(analysesHrefFromLegacy('/owner', '?tab=community&view=tastes')).toBe('/owner/analyses/community?cv=audience');
    expect(analysesHrefFromLegacy('/owner', '?tab=live')).toBe('/owner/analyses/live');
  });
  it('lit les anciens onglets', () => {
    expect(analysesHrefFromLegacy('/owner', '?tab=global')).toBe('/owner/analyses/sales');
    expect(analysesHrefFromLegacy('/owner', '?tab=event&event=e9')).toBe('/owner/analyses/sales?e=e9');
    expect(analysesHrefFromLegacy('/owner', '?tab=purchase')).toBe('/owner/analyses/community?cv=purchase');
    expect(analysesHrefFromLegacy('/owner', '?tab=nimporte')).toBe('/owner/analyses/sales');
  });
});
