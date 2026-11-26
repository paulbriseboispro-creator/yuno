import { describe, expect, it } from 'vitest';
import { getFeedConfig, notifLink, vipServiceLink, type AppNotif } from '../notifications';

const note = (type: string, extra: Partial<AppNotif> = {}): AppNotif =>
  ({ id: 'n1', notification_type: type, event_id: 'ev1', reference_id: 'res1', metadata: { link: 'vip_service' }, ...extra }) as unknown as AppNotif;

describe('liens des notifications de tables (D7)', () => {
  it('construit le lien du Service VIP, avec la soirée quand on la connaît', () => {
    expect(vipServiceLink('/owner', 'ev1')).toBe('/owner/vip-service?event=ev1');
    expect(vipServiceLink('/manager')).toBe('/manager/vip-service');
    expect(vipServiceLink('/organizer-app', 'ev1')).toBe('/organizer-app/vip-service?event=ev1');
  });

  it('table vendue et récap de la veille ouvrent le Service VIP de chaque Console', () => {
    const cases = [
      { scope: 'venue', basePath: '/owner', venueId: 'v1', organizerUserId: null },
      { scope: 'venue', basePath: '/manager', venueId: 'v1', organizerUserId: null },
      { scope: 'organizer', basePath: '/organizer-app', venueId: null, organizerUserId: 'o1' },
    ] as const;
    for (const c of cases) {
      const cfg = getFeedConfig({ ...c });
      for (const type of ['table_booked', 'table_eve_recap']) {
        expect(notifLink(note(type), cfg!)).toBe(`${c.basePath}/vip-service?event=ev1`);
      }
    }
  });

  it('une alerte super admin de vente mène à Argent', () => {
    const cfg = getFeedConfig({ scope: 'admin', venueId: null, organizerUserId: null, basePath: '/admin' })!;
    expect(notifLink(note('admin_table_paid_no_email'), cfg)).toBe('/admin/money/issues#alerts');
    expect(notifLink(note('admin_sale_email_quota'), cfg)).toBe('/admin/money/orders');
  });
});
