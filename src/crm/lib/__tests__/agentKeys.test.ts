import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRM_DICT } from '@/i18n/locales/crm/modules';
import agents from '@/i18n/locales/crm/modules/agents';
import { TARGET_AUDIENCES } from '../scenarioConditions';

const ROOT = join(__dirname, '..', '..');
const FILES = ['components/AskMyAi.tsx', 'pages/nights/plan/NightPlanPage.tsx', 'pages/nights/NightTargets.tsx'].map((f) => join(ROOT, f));
const has = (k: string) => Object.prototype.hasOwnProperty.call(CRM_DICT, k);
const plural = (k: string) => has(`${k}.one`) && has(`${k}.other`);

describe('textes des agents (plan de soirée, « Préparer avec mon IA »)', () => {
  it('chaque clé écrite en toutes lettres existe', () => {
    const missing: string[] = [];
    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'(yc\.(?:ag|tgt|sc|ni|why)\.[A-Za-z0-9_.]+)'/g)) {
        if (!has(m[1]) && !plural(m[1])) missing.push(`${m[1]} (${f.split('/').pop()})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('chaque clé construite existe', () => {
    const want: string[] = [];
    for (const s of ['draft', 'scheduled', 'sending', 'paused', 'sent']) want.push(`yc.ag.plan.st.${s}`);
    for (const e of ['not_upcoming', 'no_upcoming']) want.push(`yc.ag.plan.err.${e}`);
    for (const m of ['now', 'week', 'eve']) want.push(`yc.ag.plan.step.${m}`);
    for (const c of ['email', 'sms']) want.push(`yc.ag.plan.planned.${c}`, `yc.ag.plan.channel.${c}`);
    for (const w of ['today', 'one', 'other']) want.push(`yc.ag.plan.when.${w}`);
    for (const k of ['drafts', 'scenarios']) want.push(`yc.ag.ai.right.${k}`);
    for (const p of ['sold', 'step.people', 'aud.first', 'total.people']) want.push(`yc.ag.plan.${p}.one`, `yc.ag.plan.${p}.other`);
    for (const a of TARGET_AUDIENCES) want.push(`yc.tgt.aud.${a}.name`, `yc.tgt.angle.${a}`);
    for (const f of ['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series', 'early', 'launch', 'last_minute',
      'door', 'group', 'table', 'discovery', 'passing', 'invited', 'group_first', 'brought', 'channel']) want.push(`yc.why.fam.${f}`);
    for (const x of ['title', 'body', 'action']) want.push(`yc.notif.night_plan_ready.${x}`);
    expect(want.filter((k) => !has(k))).toEqual([]);
  });

  it('trois langues, mêmes variables', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const bad: string[] = [];
    for (const [k, [en, fr, es]] of Object.entries(agents)) {
      if (!en || !fr || !es) bad.push(`${k}: vide`);
      if (vars(en) !== vars(fr) || vars(en) !== vars(es)) bad.push(`${k}: variables`);
    }
    expect(bad).toEqual([]);
  });
});
