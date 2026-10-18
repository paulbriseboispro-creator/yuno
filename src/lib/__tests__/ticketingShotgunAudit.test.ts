import { describe, expect, it } from 'vitest';
import {
  emailUnreadable, extractPage, isCohostedRole, isoDate, leaseAlive, mapShotgunTicket, orgChangeBlocked, ticketCursor,
} from '../../../supabase/functions/_shared/ticketing-shotgun';

// Audit du 18/10 (docs/audit/2026-10-18-crm-readiness/REPORT.md).

describe('dates Shotgun sans fuseau (SYNC-05)', () => {
  it('le format documenté se lit en UTC, quel que soit le fuseau du poste', () => {
    // Attendu écrit en dur : ne dépend pas de `new Date()` (le test ne prouvait
    // rien en comparant à la même lecture). `TZ=Europe/Paris npx vitest run` le
    // prouve sur un poste français.
    expect(isoDate('2025-02-21 17:29:52.462881')).toBe('2025-02-21T17:29:52.462Z');
    expect(isoDate('2025-06-07 18:00:00')).toBe('2025-06-07T18:00:00.000Z');
    expect(isoDate('2025-06-07T18:00')).toBe('2025-06-07T18:00:00.000Z');
  });

  it('une date avec fuseau garde son fuseau', () => {
    expect(isoDate('2025-06-07T18:00:00+02:00')).toBe('2025-06-07T16:00:00.000Z');
    expect(isoDate('2025-06-07T18:00:00Z')).toBe('2025-06-07T18:00:00.000Z');
  });

  it('le curseur du billet ne dépend plus du fuseau du serveur', () => {
    expect(ticketCursor({ ticket_id: 7, ticket_updated_at: '2025-02-21 17:29:52.462881' })).toBe('2025-02-21T17:29:52.462Z_7');
  });
});

describe('réponse de forme inconnue (SYNC-02)', () => {
  it('une liste reconnue est « trouvée », même vide', () => {
    expect(extractPage({ params: {}, pagination: {}, data: [] }).found).toBe(true);
    expect(extractPage([]).found).toBe(true);
  });

  it('un 200 sans liste n’est pas une page vide', () => {
    expect(extractPage({ error: 'maintenance' }).found).toBe(false);
    expect(extractPage({}).found).toBe(false);
    expect(extractPage(null).found).toBe(false);
    expect(extractPage('oops').found).toBe(false);
  });
});

describe('changement d’organisation Shotgun sur une connexion (SYNC-01)', () => {
  const vierge = { external_org_id: '111', tickets_cursor: null, events_synced_at: null, initial_import_done_at: null };
  const importee = { ...vierge, tickets_cursor: '2026-10-17T16:19:56.315Z_1', initial_import_done_at: '2026-10-17T14:36:47Z' };

  it('refusé quand la connexion porte déjà un historique', () => {
    expect(orgChangeBlocked(importee, '222')).toBe(true);
    expect(orgChangeBlocked({ ...vierge, events_synced_at: '2026-10-17T14:30:00Z' }, '222')).toBe(true);
  });

  it('nouveau jeton pour la MÊME organisation : accepté', () => {
    expect(orgChangeBlocked(importee, '111')).toBe(false);
  });

  it('connexion vierge ou absente : accepté', () => {
    expect(orgChangeBlocked(vierge, '222')).toBe(false);
    expect(orgChangeBlocked(null, '222')).toBe(false);
  });
});

describe('soirées co-organisées : le rôle rendu par Shotgun (DATA-05)', () => {
  it('« editor », « viewer » (valeurs mesurées en prod) et « cohost » sont co-organisées', () => {
    for (const r of ['editor', 'viewer', 'cohost', ' Editor ']) expect(isCohostedRole(r)).toBe(true);
  });
  it('« organizer », un rôle absent ou inconnu : une soirée propre, jamais écartée', () => {
    for (const r of ['organizer', null, undefined, '', 'admin', 42]) expect(isCohostedRole(r)).toBe(false);
  });
});

describe('adresse mal formée renvoyée par Shotgun (DATA-07)', () => {
  it('rendue mais illisible : signalée, jamais lue comme un effacement', () => {
    expect(emailUnreadable('jean.dupont@gmail')).toBe(true);
    expect(emailUnreadable('jean dupont@gmail.com')).toBe(true);
    const t = mapShotgunTicket({ ticket_id: 1, ticket_status: 'valid', contact_email: 'jean@@gmail.com' });
    expect(t?.buyer_email).toBeNull();
    expect(t?.buyer_email_unreadable).toBe(true);
  });
  it('absente, vide ou valide : pas signalée', () => {
    for (const v of [null, undefined, '', '   ', 'jean@gmail.com']) expect(emailUnreadable(v)).toBe(false);
    const t = mapShotgunTicket({ ticket_id: 1, ticket_status: 'valid', contact_email: 'Jean@Gmail.com' });
    expect(t?.buyer_email).toBe('jean@gmail.com');
    expect(t?.buyer_email_unreadable).toBe(false);
    expect(mapShotgunTicket({ ticket_id: 2, ticket_status: 'valid' })?.buyer_email_unreadable).toBe(false);
  });
});

describe('devise autre que l’euro (DATA-04)', () => {
  const base = { ticket_id: 1, ticket_status: 'valid', deal_price: 2500, deal_user_service_fee: 150, deal_service_fee: 90 };
  it('en euros : le prix est gardé', () => {
    const t = mapShotgunTicket({ ...base, currency: 'eur' });
    expect(t?.price).toBe(25);
    expect(t?.fees).toBe(1.5);
    expect(t?.currency).toBe('EUR');
  });
  it('en dollars : billet gardé, prix inconnu (jamais additionné à des euros)', () => {
    const t = mapShotgunTicket({ ...base, currency: 'usd' });
    expect(t).not.toBeNull();
    expect(t?.price).toBeNull();
    expect(t?.fees).toBeNull();
    expect(t?.org_fee).toBeNull();
    expect(t?.currency).toBe('USD');
  });
  it('devise absente : lue comme l’euro (le compte entier est en euros)', () => {
    expect(mapShotgunTicket(base)?.price).toBe(25);
  });
});

describe('reconnexion pendant une passe (SYNC-03)', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  it('un bail dans le futur est vivant', () => {
    expect(leaseAlive('2026-10-18T12:01:00Z', now)).toBe(true);
  });
  it('échu, absent ou illisible : libre', () => {
    for (const v of ['2026-10-18T11:59:00Z', null, undefined, 'n/a']) expect(leaseAlive(v, now)).toBe(false);
  });
});
