import { describe, expect, it } from 'vitest';
import { crmConsoleTarget } from '../crmConsoleRedirect';

describe('crmConsoleTarget', () => {
  it("l'accueil de la Suite mène à l'accueil de la Console CRM", () => {
    expect(crmConsoleTarget('/owner', '/owner')).toBe('/crm');
    expect(crmConsoleTarget('/owner/dashboard/', '/owner')).toBe('/crm');
    expect(crmConsoleTarget('/organizer-app', '/organizer-app')).toBe('/crm');
  });
  it('les pages CRM de la Suite ont leur équivalent', () => {
    expect(crmConsoleTarget('/organizer-app/crm/nights', '/organizer-app')).toBe('/crm/nights');
    expect(crmConsoleTarget('/owner/crm/nights/abc', '/owner')).toBe('/crm/nights/abc');
    expect(crmConsoleTarget('/organizer-app/crm/audience', '/organizer-app')).toBe('/crm/clients');
    expect(crmConsoleTarget('/owner/crm/billing', '/owner')).toBe('/crm/account/billing');
    expect(crmConsoleTarget('/owner/campaigns', '/owner')).toBe('/crm/emails/campaigns');
    const id = '84c451a6-01aa-48ab-b97d-939930a5b403';
    expect(crmConsoleTarget(`/organizer-app/campaigns/${id}/report`, '/organizer-app')).toBe(`/crm/emails/results/${id}`);
    expect(crmConsoleTarget(`/owner/campaigns/${id}/edit`, '/owner')).toBe(`/crm/emails/studio/${id}`);
    expect(crmConsoleTarget('/owner/campaigns/automations', '/owner')).toBeNull();
    expect(crmConsoleTarget('/owner/campaigns/new', '/owner')).toBe('/crm/emails/templates');
    expect(crmConsoleTarget('/owner/integrations', '/owner')).toBe('/crm/connectors');
  });
  it('une page pas encore reconstruite reste à la Suite', () => {
    expect(crmConsoleTarget('/owner/ads', '/owner')).toBeNull();
    expect(crmConsoleTarget('/organizer-app/ai-assistants', '/organizer-app')).toBeNull();
    expect(crmConsoleTarget('/organizer-app/support-access', '/organizer-app')).toBeNull();
    expect(crmConsoleTarget('/crm', '/owner')).toBeNull();
  });
});
