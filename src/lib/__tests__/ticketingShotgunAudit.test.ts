import { describe, expect, it } from 'vitest';
import { extractPage, isoDate, orgChangeBlocked, ticketCursor } from '../../../supabase/functions/_shared/ticketing-shotgun';

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
