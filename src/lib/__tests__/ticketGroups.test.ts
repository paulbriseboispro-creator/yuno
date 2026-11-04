import { describe, expect, it } from 'vitest';
import {
  groupTicketsForDisplay, hasTicketPacks, normalizeTicketGroupDescription, normalizeTicketGroupName,
  ticketDisplayName, type TicketGroup,
} from '../ticketGroups';

const g = (id: string, position: number, name = id): TicketGroup => ({ id, eventId: 'e', name, description: null, position });
const t = (id: string, groupId: string | null, price: number, buyable = true, position = 0) => ({ id, groupId, price, buyable, position });

describe('ticketDisplayName', () => {
  it('prefixes the pack name', () => {
    expect(ticketDisplayName('First Release', 'Accès Tia Felisa')).toBe('Accès Tia Felisa · First Release');
  });
  it('keeps the ticket name alone without a pack', () => {
    expect(ticketDisplayName('First Release', null)).toBe('First Release');
    expect(ticketDisplayName('First Release', '  ')).toBe('First Release');
  });
  it('falls back to the pack name when the ticket has none', () => {
    expect(ticketDisplayName('', 'Pack')).toBe('Pack');
  });
});

describe('groupTicketsForDisplay', () => {
  const groups = [g('b', 1, 'Tia Felisa + Chin Chin'), g('a', 0, 'Accès Tia Felisa')];

  it('keeps loose tickets first and orders packs by position', () => {
    const tickets = [t('x', null, 10), t('a1', 'a', 15), t('b1', 'b', 25), t('a2', 'a', 13)];
    const { loose, packs } = groupTicketsForDisplay(groups, tickets);
    expect(loose.map(r => r.id)).toEqual(['x']);
    expect(packs.map(p => p.group.id)).toEqual(['a', 'b']);
    expect(packs[0].tickets.map(r => r.id)).toEqual(['a1', 'a2']);
  });

  it('prices "from" on buyable tickets only', () => {
    const tickets = [t('a1', 'a', 12, false), t('a2', 'a', 15), t('a3', 'a', 18, false)];
    expect(groupTicketsForDisplay(groups, tickets).packs[0].fromPrice).toBe(15);
  });

  it('has no "from" price when nothing is buyable', () => {
    const tickets = [t('a1', 'a', 12, false)];
    expect(groupTicketsForDisplay(groups, tickets).packs[0].fromPrice).toBeNull();
  });

  it('hides an empty pack and keeps tickets of an unknown pack loose', () => {
    const tickets = [t('a1', 'a', 15), t('z', 'ghost', 9)];
    const { loose, packs } = groupTicketsForDisplay(groups, tickets);
    expect(packs.map(p => p.group.id)).toEqual(['a']);
    expect(loose.map(r => r.id)).toEqual(['z']);
  });

  it('knows when packs are in use', () => {
    expect(hasTicketPacks(groups, [{ groupId: null }])).toBe(false);
    expect(hasTicketPacks(groups, [{ groupId: 'ghost' }])).toBe(false);
    expect(hasTicketPacks(groups, [{ groupId: 'a' }])).toBe(true);
  });
});

describe('normalize', () => {
  it('cleans a pack name', () => {
    expect(normalizeTicketGroupName('  Tia   Felisa  ')).toBe('Tia Felisa');
    expect(normalizeTicketGroupName('   ')).toBeNull();
    expect(normalizeTicketGroupName('x'.repeat(80))).toHaveLength(60);
  });
  it('cleans a pack description', () => {
    expect(normalizeTicketGroupDescription('  ')).toBeNull();
    expect(normalizeTicketGroupDescription(' Entrée ')).toBe('Entrée');
  });
});
