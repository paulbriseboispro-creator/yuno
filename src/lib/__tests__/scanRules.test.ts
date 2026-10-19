import { describe, expect, it } from 'vitest';
import { computeLateness, drinkCutoffOf, entryHeadcount } from '@/lib/scan/rules';

/** Heure murale de la soirée, comme la rend `nowInParis()` / `toZonedTime`. */
const at = (h: number, m: number) => new Date(2026, 9, 29, h, m, 0, 0);

describe('computeLateness — heure limite d\'entrée d\'un tarif', () => {
  it('« Before 1 AM » : à l\'heure avant 01:00, hors créneau après', () => {
    expect(computeLateness('01:00', at(23, 59)).isPast).toBe(false);
    expect(computeLateness('01:00', at(0, 30)).isPast).toBe(false);
    expect(computeLateness('01:00', at(1, 0)).isPast).toBe(false);
    expect(computeLateness('01:00', at(1, 1)).isPast).toBe(true);
    expect(computeLateness('01:00', at(5, 59)).isPast).toBe(true);
  });

  it('une limite après minuit ne rend pas « hors créneau » la soirée qui commence', () => {
    expect(computeLateness('01:00', at(6, 0)).isPast).toBe(false);
    expect(computeLateness('02:00', at(22, 0)).isPast).toBe(false);
  });

  it('une limite le soir même se compare à l\'heure de la soirée', () => {
    expect(computeLateness('23:30', at(23, 0)).isPast).toBe(false);
    expect(computeLateness('23:30', at(23, 45)).isPast).toBe(true);
  });

  it('dit le retard en minutes, puis en heures', () => {
    expect(computeLateness('01:00', at(1, 32)).lateLabel).toBe('32 min');
    expect(computeLateness('01:00', at(2, 5)).lateLabel).toBe('1h05');
    expect(computeLateness('23:30', at(0, 15)).lateLabel).toBe('45 min');
  });
});

describe('drinkCutoffOf — heure limite de la boisson offerte', () => {
  it('ne lit que le mode « heure fixe »', () => {
    expect(drinkCutoffOf({ drink_deadline_type: 'fixed_time', drink_cutoff_time: '02:00:00' })).toBe('02:00');
    expect(drinkCutoffOf({ drink_deadline_type: 'hours_after_entry', drink_cutoff_time: '02:00:00' })).toBeUndefined();
    expect(drinkCutoffOf({ drink_deadline_type: 'fixed_time', drink_cutoff_time: null })).toBeUndefined();
    expect(drinkCutoffOf({})).toBeUndefined();
  });
});

describe('entryHeadcount — personnes qu\'un QR fait entrer', () => {
  it('un QR nominatif fait entrer UNE personne, quelle que soit la commande', () => {
    expect(entryHeadcount('ticket_attendee', 4)).toBe(1);
  });

  it('le QR du billet entier fait entrer toute la commande', () => {
    expect(entryHeadcount('ticket', 4)).toBe(4);
    expect(entryHeadcount('ticket', 1)).toBe(1);
  });

  it('une quantité absente ou invalide vaut une personne', () => {
    expect(entryHeadcount('ticket', null)).toBe(1);
    expect(entryHeadcount('ticket', 0)).toBe(1);
    expect(entryHeadcount('ticket', undefined)).toBe(1);
  });
});
