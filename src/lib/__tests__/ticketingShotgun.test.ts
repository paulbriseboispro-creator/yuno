import { describe, it, expect } from 'vitest';
import {
  at,
  pick,
  email,
  money,
  isoDate,
  extractPage,
  safeNextUrl,
  schemaKeys,
  normalizeTicketStatus,
  mapShotgunTicket,
  mapShotgunEvent,
  ticketCursor,
  ticketsUrl,
  eventsUrl,
  isValidOrganizerId,
  countryCodeFrom,
} from '../../../supabase/functions/_shared/ticketing-shotgun.ts';

// Exemple tiré de la doc officielle « Organizer events API » (relue le 02/10/2026).
const DOC_EVENT = {
  id: 313466,
  name: 'ATOM - 31.12.2022 // Rome',
  startTime: '2022-12-31T21:00:57.000Z',
  endTime: '2023-01-01T21:00:21.000Z',
  slug: 'atom-31-12-2022-rome',
  timezone: 'Europe/Rome',
  artists: [{ id: 113100, name: 'Outcast Torino', slug: 'outcast_torino', avatar: 'https://res.cloudinary.com/x.jpg', url: 'https://shotgun.live/artists/outcast_torino' }],
  genres: [{ name: 'electro' }, { name: 'acid' }],
  leftTicketsCount: 406,
  description: 'Atom will host…',
  coverUrl: 'https://res.cloudinary.com/cover.jpg',
  url: 'https://shotgun.live/events/atom-31-12-2022-rome',
  addressVisibility: 'public',
  geolocation: {
    street: 'Via di Pietralata, 147/A-B, 00158 Roma RM, Italy',
    latitude: 41.926271, longitude: 12.536685, city: 'Roma', cityId: 100514,
    zipCode: '00158', country: 'italy', countryIsoCode: 'IT', countryId: 15,
  },
  publishedAt: '2022-12-01T18:00:35.000Z',
  launchedAt: '2022-12-07T12:00:14.000Z',
  cancelledAt: null,
  organizer: { name: 'Mysterious music', slug: 'mysterious-music' },
  role: 'organizer',
  deals: [
    { name: 'Pass Regular Entry', product_id: 284482, quantity: 50, visiblity: 'public', sales_channel: 'online', price: 10, organizer_fees: 0.99, user_fees: 0.3, subcategory: { id: 1, name: 'Reserved Tables with Drinks Included' } },
  ],
  typeOfPlace: 'club',
};

describe('accès par chemin', () => {
  it('lit les objets, les tableaux et ignore les vides', () => {
    expect(at({ a: { b: [{ c: 3 }] } }, 'a.b.0.c')).toBe(3);
    expect(at({ a: 1 }, 'a.b')).toBeNull();
    expect(pick({ a: '', b: '  ', c: 'x' }, ['a', 'b', 'c'])).toBe('x');
    expect(pick({}, ['a'])).toBeNull();
  });

  it('normalise email, montant et date', () => {
    expect(email('  Jean.DUPONT@Gmail.com ')).toBe('jean.dupont@gmail.com');
    expect(email('pas-un-email')).toBeNull();
    expect(money(1250, 100)).toBe(12.5);
    expect(money('9,99', 1)).toBe(9.99);
    expect(money(null, 1)).toBeNull();
    expect(isoDate(1700000000)).toBe(new Date(1700000000 * 1000).toISOString());
    expect(isoDate('pas une date')).toBeNull();
  });
});

describe('pagination', () => {
  it('trouve la liste où qu’elle soit', () => {
    expect(extractPage([{ id: 1 }]).items).toHaveLength(1);
    expect(extractPage({ data: [{ id: 1 }, 2, null] }).items).toHaveLength(1);
    expect(extractPage({ tickets: [{ id: 1 }], pagination: { next: 'https://api.shotgun.live/tickets?after=x' } }).next)
      .toBe('https://api.shotgun.live/tickets?after=x');
    expect(extractPage({ foo: 1 }).items).toEqual([]);
  });

  it('ne suit un lien suivant que sur l’hôte attendu, en https', () => {
    expect(safeNextUrl('https://api.shotgun.live/tickets?after=1', 'api.shotgun.live')).not.toBeNull();
    expect(safeNextUrl('https://evil.example/tickets', 'api.shotgun.live')).toBeNull();
    expect(safeNextUrl('http://api.shotgun.live/tickets', 'api.shotgun.live')).toBeNull();
    expect(safeNextUrl('pas une url', 'api.shotgun.live')).toBeNull();
  });

  it('relève les clés, jamais les valeurs', () => {
    const keys = schemaKeys({ id: 1, contact: { email: 'secret@x.fr', first_name: 'A' } });
    expect(keys).toEqual(['id', 'contact', 'contact.email', 'contact.first_name']);
    expect(keys.join(' ')).not.toContain('secret');
  });
});

describe('statut d’un billet', () => {
  it('lit les mots usuels', () => {
    expect(normalizeTicketStatus({}).status).toBe('valid');
    expect(normalizeTicketStatus({ status: 'valid' }).status).toBe('valid');
    expect(normalizeTicketStatus({ ticket_status: 'refunded' }).status).toBe('refunded');
    expect(normalizeTicketStatus({ status: 'canceled' }).status).toBe('cancelled');
    expect(normalizeTicketStatus({ status: 'resold' }).status).toBe('transferred');
    expect(normalizeTicketStatus({ status: 'weird' }).status).toBe('other');
  });

  it('un drapeau de remboursement gagne sur le statut', () => {
    expect(normalizeTicketStatus({ status: 'valid', refunded: true }).status).toBe('refunded');
    expect(normalizeTicketStatus({ status: 'valid', is_cancelled: 'true' }).status).toBe('cancelled');
  });
});

// Billet au schéma officiel « /tickets API » (relu le 05/10/2026,
// docs/designs/SHOTGUN_API_REFERENCE.md) : montants en centimes, contact_*.
const DOC_TICKET = {
  ticket_id: 123456,
  ticket_scan_code: '42564997260325',
  ticket_scanned_at: '2025-02-21 17:29:52.462881',
  ticket_updated_at: '2025-02-21 17:29:52.462881',
  ticket_canceled_at: null,
  ticket_status: 'valid',
  ticket_seating: null,
  user_id: 46824,
  deal_id: 12345678,
  deal_sub_category: 'Friday',
  deal_title: 'Early Bird',
  deal_channel: 'online',
  deal_visibilities: ['public'],
  deal_price: 3999,
  deal_service_fee: 99,
  deal_user_service_fee: 150,
  deal_producer_cost: 0,
  deal_vat_rate: 0.055,
  order_id: 654321,
  currency: 'eur',
  payment_method: 'card',
  utm_source: 'yuno_k3f9a2',
  utm_medium: 'app',
  ordered_at: '2025-02-20 17:29:52.462881',
  event_id: 410006,
  event_start_time: '2025-06-07 18:00:00',
  event_end_time: '2025-06-09 16:00:00',
  contact_id: 123456789,
  contact_email: 'A@Shotgun.live',
  contact_phone: '+33612345678',
  contact_first_name: 'Antoine',
  contact_last_name: 'Rousseau',
  contact_gender: 'male',
  contact_company_name: 'Shotgun',
  contact_birthday: '1985-01-01',
  contact_newsletter_optin: true,
  contact_country: 'France',
  contact_postal_code: '31000',
  contact_locality: 'Toulouse',
};

describe('billet Shotgun au schéma officiel', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('lit chaque champ documenté, montants en centimes', () => {
    const t = mapShotgunTicket(DOC_TICKET, 1, now)!;
    expect(t.external_id).toBe('123456');
    expect(t.external_order_id).toBe('654321');
    expect(t.external_event_id).toBe('410006');
    expect(t.deal_id).toBe('12345678');
    expect(t.deal_name).toBe('Early Bird');
    expect(t.status).toBe('valid');
    expect(t.price).toBe(39.99);
    expect(t.fees).toBe(1.5);
    expect(t.currency).toBe('EUR');
    expect(t.buyer_email).toBe('a@shotgun.live');
    expect(t.buyer_first_name).toBe('Antoine');
    expect(t.buyer_last_name).toBe('Rousseau');
    expect(t.buyer_phone).toBe('+33612345678');
    expect(t.buyer_ref).toBe('123456789');
    expect(t.gender).toBe('male');
    expect(t.age).toBe(41);
    expect(t.newsletter_optin).toBe(true);
    expect(t.city).toBe('Toulouse');
    expect(t.zip_code).toBe('31000');
    expect(t.country_code).toBe('FR');
    expect(t.purchased_at).toBe(new Date('2025-02-20 17:29:52.462881').toISOString());
    expect(t.scanned_at).not.toBeNull();
    expect(t.utm).toEqual({ utm_source: 'yuno_k3f9a2', utm_medium: 'app' });
  });

  it('ne garde jamais la valeur du QR dans le billet brut', () => {
    const t = mapShotgunTicket(DOC_TICKET, 1, now)!;
    expect(t.raw).not.toHaveProperty('ticket_scan_code');
    expect(JSON.stringify(t.raw)).not.toContain('42564997260325');
    expect(t.raw).toHaveProperty('ticket_id');
  });

  it('le diviseur de la connexion ne touche pas un montant documenté', () => {
    expect(mapShotgunTicket(DOC_TICKET, 100, now)!.price).toBe(39.99);
  });

  it('lit les statuts et la date d’annulation documentés', () => {
    const refunded = mapShotgunTicket({ ...DOC_TICKET, ticket_status: 'refunded', ticket_canceled_at: '2025-03-01 10:00:00' }, 1, now)!;
    expect(refunded.status).toBe('refunded');
    expect(refunded.refunded_at).not.toBeNull();
    expect(mapShotgunTicket({ ...DOC_TICKET, ticket_status: 'canceled' }, 1, now)!.status).toBe('cancelled');
    expect(mapShotgunTicket({ ...DOC_TICKET, ticket_status: 'resold' }, 1, now)!.status).toBe('transferred');
    expect(mapShotgunTicket({ ...DOC_TICKET, ticket_status: 'rejected' }, 1, now)!.status).toBe('cancelled');
    expect(mapShotgunTicket({ ...DOC_TICKET, ticket_status: 'payment_plan_pending' }, 1, now)!.status).toBe('other');
    expect(mapShotgunTicket({ ...DOC_TICKET, ticket_status: 'pending_approval' }, 1, now)!.status).toBe('other');
  });

  it('convertit le nom de pays en code ISO, en trois langues', () => {
    expect(countryCodeFrom('France')).toBe('FR');
    expect(countryCodeFrom('Espagne')).toBe('ES');
    expect(countryCodeFrom('España')).toBe('ES');
    expect(countryCodeFrom('United Kingdom')).toBe('GB');
    expect(countryCodeFrom('be')).toBe('BE');
    expect(countryCodeFrom('Atlantide')).toBeNull();
    expect(countryCodeFrom(null)).toBeNull();
  });
});

describe('billet Shotgun', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('lit un billet à plat (snake_case)', () => {
    const t = mapShotgunTicket({
      ticket_id: 'T1', order_id: 'O1', event_id: 410006, deal_id: 284482, deal_title: 'Early',
      ticket_status: 'valid', ticket_price: 12, user_fees: 1.2, currency: 'eur',
      buyer_email: 'A@B.FR', buyer_first_name: 'Ana', buyer_last_name: 'B', buyer_phone: '+33612345678',
      newsletter_optin: true, age: 24, gender: 'F', city: 'Paris', zip_code: '75011',
      ordered_at: '2026-09-30T20:00:00Z', ticket_scanned_at: '2026-10-01T23:10:00Z',
      updated_at: '2026-10-01T23:10:00Z', utm_source: 'instagram', utm_campaign: 'drop',
    }, 1, now)!;
    expect(t.external_id).toBe('T1');
    expect(t.external_order_id).toBe('O1');
    expect(t.external_event_id).toBe('410006');
    expect(t.deal_id).toBe('284482');
    expect(t.deal_name).toBe('Early');
    expect(t.status).toBe('valid');
    expect(t.price).toBe(12);
    expect(t.fees).toBe(1.2);
    expect(t.currency).toBe('EUR');
    expect(t.buyer_email).toBe('a@b.fr');
    expect(t.newsletter_optin).toBe(true);
    expect(t.age).toBe(24);
    expect(t.gender).toBe('female');
    expect(t.scanned_at).toBe('2026-10-01T23:10:00.000Z');
    expect(t.utm).toEqual({ utm_source: 'instagram', utm_campaign: 'drop' });
    expect(t.quantity).toBe(1);
  });

  it('lit un billet imbriqué (camelCase) et distingue acheteur et détenteur', () => {
    const t = mapShotgunTicket({
      id: 99, status: 'refunded', refundedAt: '2026-09-29T10:00:00Z',
      contact: { email: 'buyer@x.fr', firstName: 'Léo', newsletterOptin: 'false', birthdate: '2000-12-01' },
      holder: { email: 'friend@x.fr', first_name: 'Max' },
      deal: { id: 7, name: 'VIP', price: 5000 },
      createdAt: 1727712000,
    }, 100, now)!;
    expect(t.external_id).toBe('99');
    expect(t.status).toBe('refunded');
    expect(t.refunded_at).toBe('2026-09-29T10:00:00.000Z');
    expect(t.buyer_email).toBe('buyer@x.fr');
    expect(t.buyer_first_name).toBe('Léo');
    expect(t.holder_email).toBe('friend@x.fr');
    expect(t.holder_first_name).toBe('Max');
    expect(t.newsletter_optin).toBe(false);
    expect(t.age).toBe(25);
    expect(t.deal_name).toBe('VIP');
    expect(t.price).toBe(50);
    expect(t.purchased_at).toBe(new Date(1727712000 * 1000).toISOString());
  });

  it('refuse un billet sans identifiant et laisse inconnu ce qui l’est', () => {
    expect(mapShotgunTicket({ status: 'valid' })).toBeNull();
    const t = mapShotgunTicket({ id: 'x' })!;
    expect(t.newsletter_optin).toBeNull();
    expect(t.buyer_email).toBeNull();
    expect(t.price).toBeNull();
    expect(t.refunded_at).toBeNull();
  });

  it('construit le curseur « date_id » du dernier billet', () => {
    expect(ticketCursor({ id: 42, updated_at: '2026-10-01T10:00:00Z' })).toBe('2026-10-01T10:00:00.000Z_42');
    expect(ticketCursor({ id: 42 })).toBeNull();
  });
});

describe('soirée Shotgun (exemple de la doc)', () => {
  it('lit tous les champs documentés', () => {
    const e = mapShotgunEvent(DOC_EVENT)!;
    expect(e.external_id).toBe('313466');
    expect(e.name).toBe('ATOM - 31.12.2022 // Rome');
    expect(e.start_at).toBe('2022-12-31T21:00:57.000Z');
    expect(e.timezone).toBe('Europe/Rome');
    expect(e.city).toBe('Roma');
    expect(e.country_code).toBe('IT');
    expect(e.genres).toEqual(['electro', 'acid']);
    expect(e.artists[0].name).toBe('Outcast Torino');
    expect(e.left_tickets).toBe(406);
    expect(e.launched_at).toBe('2022-12-07T12:00:14.000Z');
    expect(e.cancelled_at).toBeNull();
    expect(e.organizer_name).toBe('Mysterious music');
    expect(e.external_role).toBe('organizer');
    expect(e.deals[0]).toMatchObject({ id: '284482', name: 'Pass Regular Entry', price: 10, quantity: 50, visibility: 'public', category: 'Reserved Tables with Drinks Included' });
  });

  it('refuse une URL non https', () => {
    expect(mapShotgunEvent({ ...DOC_EVENT, url: 'javascript:alert(1)' })!.url).toBeNull();
  });
});

describe('URL', () => {
  it('construit /tickets avec le curseur et les co-organisations', () => {
    const u = new URL(ticketsUrl('173027', { after: '2026-10-01T10:00:00.000Z_42' }));
    expect(u.host).toBe('api.shotgun.live');
    expect(u.searchParams.get('organizer_id')).toBe('173027');
    expect(u.searchParams.get('include_cohosted_events')).toBe('1');
    expect(u.searchParams.get('after')).toBe('2026-10-01T10:00:00.000Z_42');
    expect(new URL(ticketsUrl('1', { includeCohosted: false })).searchParams.has('include_cohosted_events')).toBe(false);
  });

  it('construit /events à venir et passées', () => {
    const up = new URL(eventsUrl('173027', { param: 'key', value: 'k' }, {}));
    expect(up.pathname).toBe('/api/shotgun/organizers/173027/events');
    expect(up.searchParams.get('key')).toBe('k');
    expect(up.searchParams.has('past_events')).toBe(false);
    expect(up.searchParams.has('page')).toBe(false);
    // Soirées à venir paginées : page + limite, sans past_events.
    const upPaged = new URL(eventsUrl('173027', { param: 'key', value: 'k' }, { page: 1 }));
    expect(upPaged.searchParams.has('past_events')).toBe(false);
    expect(upPaged.searchParams.get('page')).toBe('1');
    expect(upPaged.searchParams.get('limit')).toBe('100');
    const past = new URL(eventsUrl('173027', { param: 'token', value: 't' }, { past: true, page: 2, updatedAfter: '2026-10-01T00:00:00Z' }));
    expect(past.searchParams.get('past_events')).toBe('true');
    expect(past.searchParams.get('page')).toBe('2');
    expect(past.searchParams.get('limit')).toBe('100');
    expect(past.searchParams.get('token')).toBe('t');
    expect(past.searchParams.get('updated_after')).toBe('2026-10-01T00:00:00Z');
  });

  it('valide l’ID organisateur', () => {
    expect(isValidOrganizerId('173027')).toBe(true);
    expect(isValidOrganizerId('17 3027')).toBe(false);
    expect(isValidOrganizerId('../x')).toBe(false);
    expect(isValidOrganizerId(173027)).toBe(false);
  });
});
