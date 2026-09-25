import { describe, expect, it } from 'vitest';
import {
  type AppNotif, type FeedConfig,
  ADMIN_FEED_CONFIG, NOTIF_CATALOGUE, getAffiliateFeedConfig, getFeedConfig, notifLink,
} from '@/lib/notifications';

// Une notification est un objectif, sa page est la fonction qui le remplit :
// aucun type, dans aucun dashboard, ne doit rester « juste du texte ».

const EVENT = '11111111-1111-4111-8111-111111111111';
const REF = '22222222-2222-4222-8222-222222222222';

const notif = (type: string, over: Partial<AppNotif> = {}): AppNotif => ({
  id: 'n1',
  title: 't',
  message: 'm',
  notification_type: type,
  priority: 'normal',
  created_at: '2026-09-25T10:00:00Z',
  read_at: null,
  event_id: null,
  reference_type: null,
  reference_id: null,
  metadata: {},
  ...over,
});

const owner = getFeedConfig({ scope: 'venue', venueId: 'womber', organizerUserId: null, basePath: '/owner' })!;
const manager = getFeedConfig({ scope: 'venue', venueId: 'womber', organizerUserId: null, basePath: '/manager' })!;
const organizer = getFeedConfig({ scope: 'organizer', venueId: null, organizerUserId: REF, basePath: '/organizer-app' })!;
const agency = getAffiliateFeedConfig('admin:a1', '/agency-app/inbox');
const member = getAffiliateFeedConfig('member:m1');

// Première page de chaque dashboard (src/App.tsx). Un lien qui n'y tombe pas
// mène à une 404 : c'est aussi un cul-de-sac.
const ROUTES: Record<string, string[]> = {
  '/owner': ['dashboard', 'analytics', 'live', 'events', 'ticketing', 'guest-list', 'tables', 'djs', 'book-dj',
    'collaborations', 'collab', 'customers', 'campaigns', 'promoters', 'orders', 'refunds', 'staff',
    'vip-service', 'integrations', 'support-access'],
  '/manager': ['dashboard', 'analytics', 'live', 'events', 'ticketing', 'guest-list', 'tables', 'djs',
    'customers', 'promoters', 'orders', 'refunds', 'staff', 'vip-service', 'support-access'],
  '/organizer-app': ['dashboard', 'analytics', 'events', 'ticketing', 'guest-list', 'tables', 'vip-service', 'djs',
    'book-dj', 'partners', 'collaborations', 'team', 'customers', 'campaigns', 'promoters', 'orders', 'refunds',
    'integrations', 'support-access'],
};

const FEEDS: Array<[string, FeedConfig]> = [
  ['owner', owner], ['manager', manager], ['organizer', organizer],
  ['agency', agency], ['member', member], ['admin', ADMIN_FEED_CONFIG],
];

describe('notifLink — aucune notification sans destination', () => {
  const types = Object.keys(NOTIF_CATALOGUE);

  for (const [name, cfg] of FEEDS) {
    it(`${name} : chaque type du catalogue mène à une page`, () => {
      for (const type of types) {
        for (const n of [notif(type), notif(type, { event_id: EVENT, reference_id: REF })]) {
          const link = notifLink(n, cfg);
          expect(link, `${name} · ${type}`).toMatch(/^(\/|mailto:)/);
          // La page de l'inbox elle-même n'est pas une destination (sauf les
          // échéances du super admin, dont le registre vit sur cette page).
          if (!type.startsWith('admin_credential_')) {
            expect(link, `${name} · ${type}`).not.toBe(cfg.pagePath);
          }
          const root = ROUTES[cfg.basePath];
          if (root && link.startsWith(cfg.basePath + '/')) {
            const first = link.slice(cfg.basePath.length + 1).split(/[/?]/)[0];
            expect(root, `${name} · ${type} → ${link}`).toContain(first);
          }
        }
      }
    });
  }

  it('un type inconnu retombe sur sa soirée, sinon sur l’accueil', () => {
    expect(notifLink(notif('whatever'), owner)).toBe('/owner/dashboard');
    expect(notifLink(notif('whatever', { event_id: EVENT }), organizer)).toBe(`/organizer-app/events/${EVENT}`);
    expect(notifLink(notif('whatever'), ADMIN_FEED_CONFIG)).toBe('/admin');
  });
});

describe('notifLink — chaque objectif ouvre sa fonction', () => {
  it('le bilan du lendemain ouvre le Rapport de la soirée', () => {
    const n = notif('night_recap', { event_id: EVENT, reference_type: 'event', reference_id: EVENT });
    expect(notifLink(n, owner)).toBe(`/owner/analytics?tab=sales&view=event&event=${EVENT}`);
    expect(notifLink(n, manager)).toBe(`/manager/analytics?tab=sales&view=event&event=${EVENT}`);
    expect(notifLink(n, organizer)).toBe(`/organizer-app/analytics?tab=sales&view=event&event=${EVENT}`);
  });

  it('le rappel line-up ouvre le formulaire de la soirée', () => {
    const n = notif('lineup_reminder', { event_id: EVENT });
    expect(notifLink(n, owner)).toBe(`/owner/events?edit=${EVENT}`);
    expect(notifLink(n, organizer)).toBe(`/organizer-app/events?edit=${EVENT}`);
  });

  it('« Ce soir dans ~6 h » ouvre la consigne du soir', () => {
    expect(notifLink(notif('event_prep_6h', { event_id: EVENT }), owner)).toBe('/owner/staff?tab=briefing');
  });

  it('« Soirée dans 30 min » ouvre le live', () => {
    const n = notif('event_starting', { event_id: EVENT });
    expect(notifLink(n, owner)).toBe('/owner/live');
    expect(notifLink(n, organizer)).toBe(`/organizer-app/events/${EVENT}/live`);
  });

  it('une co-soirée ouvre sa page partagée', () => {
    const n = notif('collab_tables_online', { event_id: EVENT });
    expect(notifLink(n, owner)).toBe(`/owner/collab/event/${EVENT}`);
    expect(notifLink(n, organizer)).toBe(`/organizer-app/events/${EVENT}`);
  });

  it('une vente ouvre la commande exacte', () => {
    expect(notifLink(notif('ticket_sale', { reference_id: REF }), owner)).toBe(`/owner/orders?tab=tickets&focus=${REF}`);
    expect(notifLink(notif('table_booked', { reference_id: REF }), organizer)).toBe(`/organizer-app/orders?tab=vip&focus=${REF}`);
  });

  it('la relance de cachet ouvre la fiche du DJ', () => {
    const n = notif('dj_fee_reminder', { reference_type: 'dj_set', reference_id: REF, metadata: { dj_id: 'dj-1' } });
    expect(notifLink(n, owner)).toBe('/owner/djs/dj-1');
  });

  it('une campagne partie ouvre son rapport', () => {
    expect(notifLink(notif('campaign_sent', { reference_id: REF }), owner)).toBe(`/owner/campaigns/${REF}/report`);
  });

  it('un lead pro ouvre un email pré-rempli', () => {
    const n = notif('admin_pro_lead', { metadata: { email: 'a@b.fr', club_name: 'Le Club' } });
    expect(notifLink(n, ADMIN_FEED_CONFIG)).toBe(`mailto:a@b.fr?subject=${encodeURIComponent('Yuno × Le Club')}`);
  });

  it('un message d’équipe sans lien mène à l’espace du membre', () => {
    expect(notifLink(notif('aff_team_message'), member)).toBe('/affiliate/promoteur');
    expect(notifLink(notif('aff_team_message', { metadata: { action_url: '/affiliate/analytics' } }), member))
      .toBe('/affiliate/analytics');
  });
});
