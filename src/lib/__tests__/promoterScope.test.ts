import { describe, expect, it } from 'vitest';
import {
  promoterCodePattern,
  promoterIdHint,
  promoterScopeOr,
} from '../../../supabase/functions/_shared/promoter-scope.ts';

// SEC-09 (audit du 18/10) : le promoteur d'une vente se lit dans le périmètre
// de la soirée, par id comme par code, et jamais par un joker.

describe('promoterScopeOr', () => {
  it('club seul : le club', () => {
    expect(promoterScopeOr({ venue_id: 'club-a', organizer_user_id: null })).toEqual(['venue_id.eq.club-a']);
  });

  it('co-soirée : les quatre parties, dans cet ordre', () => {
    expect(promoterScopeOr({
      venue_id: 'club-a',
      partner_venue_id: 'club-b',
      organizer_user_id: '11111111-1111-4111-8111-111111111111',
      partner_organizer_id: '22222222-2222-4222-8222-222222222222',
    })).toEqual([
      'venue_id.eq.club-a',
      'venue_id.eq.club-b',
      'organizer_user_id.eq.11111111-1111-4111-8111-111111111111',
      'organizer_user_id.eq.22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('soirée d\'organisateur sans club : l\'organisateur', () => {
    expect(promoterScopeOr({ venue_id: null, organizer_user_id: '11111111-1111-4111-8111-111111111111' }))
      .toEqual(['organizer_user_id.eq.11111111-1111-4111-8111-111111111111']);
  });

  it('aucune partie : aucun promoteur possible', () => {
    expect(promoterScopeOr({})).toEqual([]);
  });

  it('une même partie deux fois ne compte qu\'une fois', () => {
    expect(promoterScopeOr({ venue_id: 'club-a', partner_venue_id: 'club-a' })).toEqual(['venue_id.eq.club-a']);
  });
});

describe('promoterIdHint', () => {
  it('garde un id', () => {
    expect(promoterIdHint(' 1B000000-0000-4000-8000-000000000001 ')).toBe('1b000000-0000-4000-8000-000000000001');
  });

  it.each([null, undefined, '', 'x', 42, '1b000000-0000-4000-8000-00000000000', "1b000000-0000-4000-8000-000000000001' OR 1=1"])(
    'refuse %p',
    (raw) => {
      expect(promoterIdHint(raw)).toBeNull();
    },
  );
});

describe('promoterCodePattern', () => {
  it('garde un code ordinaire', () => {
    expect(promoterCodePattern(' PAULB ')).toBe('PAULB');
  });

  it('échappe le joker « un caractère » et l\'échappement', () => {
    expect(promoterCodePattern('PAUL_B')).toBe('PAUL\\_B');
    expect(promoterCodePattern('A\\B')).toBe('A\\\\B');
  });

  it.each(['%', '*', 'PAUL%', 'P*', '', '   ', null, undefined, 7, 'X'.repeat(65)])(
    'refuse %p (joker, vide ou illisible)',
    (raw) => {
      expect(promoterCodePattern(raw)).toBeNull();
    },
  );
});
