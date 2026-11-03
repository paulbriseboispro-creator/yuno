import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NIGHT_PLAN_RULES, capFor, groupProtected, scheduleFor, templateFor } from '../nightPlan';

describe('nightPlan', () => {
  it('mirrors crm_night_plan_rules() of the migration', () => {
    const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/20261122100000_crm_night_plans.sql'), 'utf8');
    for (const [k, v] of Object.entries(NIGHT_PLAN_RULES)) {
      expect(sql).toMatch(new RegExp(`'${k}', ${v}[,)]`));
    }
  });

  it('caps at 2 under 7 days, 3 otherwise', () => {
    expect(capFor(1)).toBe(2);
    expect(capFor(6)).toBe(2);
    expect(capFor(7)).toBe(3);
  });

  it('starts at least 2 h after launch and staggers one moment by 15 min', () => {
    const now = new Date('2026-11-03T14:00:00Z');
    const s = scheduleFor([
      { key: 'once_local', moment: 'now', send_at: '2026-11-03T14:00:00Z', order: 2 },
      { key: 'early', moment: 'now', send_at: '2026-11-03T14:00:00Z', order: 1 },
      { key: 'last_minute', moment: 'day', send_at: '2026-11-04T13:00:00Z', order: 3 },
    ], '2026-11-04T22:00:00Z', now);
    expect(s.map((x) => [x.key, x.at.toISOString(), x.late])).toEqual([
      ['early', '2026-11-03T16:00:00.000Z', false],
      ['once_local', '2026-11-03T16:15:00.000Z', false],
      ['last_minute', '2026-11-04T13:00:00.000Z', false],
    ]);
  });

  it('flags a send that would land in the last 2 h', () => {
    const now = new Date('2026-11-04T19:00:00Z');
    const s = scheduleFor([{ key: 'early', moment: 'now', send_at: '2026-11-04T19:00:00Z', order: 1 }], '2026-11-04T22:00:00Z', now);
    expect(s[0].late).toBe(true);
  });

  it('picks a template per audience and groups reasons', () => {
    expect(templateFor('last_minute')).toBe('lastcall');
    expect(templateFor('once_local')).toBe('retour');
    expect(templateFor('unknown')).toBe('annonce');
    expect(groupProtected({ plan_spacing: 3, plan_holder: 1, plan_holder_after_queue: 2, pressure_24h: 4 })).toEqual({ spacing: 3, holder: 3, pressure: 4 });
  });
});
