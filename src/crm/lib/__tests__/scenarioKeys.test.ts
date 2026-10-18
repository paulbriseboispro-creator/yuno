import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRM_DICT } from '@/i18n/locales/crm/modules';
import scenarios from '@/i18n/locales/crm/modules/scenarios';
import { COND_LEAVES, TARGET_AUDIENCES, CHANNEL_CODES } from '../scenarioConditions';
import { NODE_TYPES, SOON_TRIGGERS, TRIGGERS } from '../scenarioGraph';
import { SCENARIO_TEMPLATES, TEMPLATE_SMS } from '../scenarioTemplates';
import { LEAF_FAMILIES } from '@/crm/pages/automations/scenarios/scnText';

const ROOT = join(__dirname, '..', '..');
const FILES = [
  ...readdirSync(join(ROOT, 'pages/automations/scenarios')).map((f) => join(ROOT, 'pages/automations/scenarios', f)),
  join(ROOT, 'pages/automations/AutomationsPage.tsx'),
  join(ROOT, 'pages/automations/AutoCards.tsx'),
];

const has = (k: string) => Object.prototype.hasOwnProperty.call(CRM_DICT, k);
const plural = (k: string) => has(`${k}.one`) && has(`${k}.other`);

describe('textes des Scénarios', () => {
  it('chaque clé écrite en toutes lettres existe', () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/'(yc\.scn\.[A-Za-z0-9_.]+)'/g)) {
        const k = m[1];
        if (!has(k) && !plural(k)) missing.push(`${k} (${f.split('/').pop()})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('chaque clé construite existe', () => {
    const want: string[] = [];
    for (const [k, d] of Object.entries(COND_LEAVES)) {
      want.push(`yc.scn.leaf.${k}`, `yc.scn.leaf.${k}.d`);
      if ((d.spec.t === 'enum' || d.spec.t === 'set') && k !== 'hyp' && k !== 'sc_family') for (const v of d.spec.of) want.push(`yc.scn.v.${k}.${v}`);
      if (d.spec.t === 'int') want.push(`yc.scn.unit.${k}`);
      if (d.spec.t === 'strings' || d.spec.t === 'patterns') want.push(`yc.scn.ph.${k}`);
    }
    for (const a of TARGET_AUDIENCES) want.push(`yc.scn.v.ntgt.${a}`);
    for (const c of CHANNEL_CODES) want.push(`yc.scn.v.arr.${c}`);
    for (const f of LEAF_FAMILIES) want.push(`yc.scn.fam.${f.family}`);
    for (const n of NODE_TYPES) want.push(`yc.scn.node.${n}`, `yc.scn.node.${n}.d`);
    for (const t of [...TRIGGERS, ...SOON_TRIGGERS]) want.push(`yc.scn.trg.${t}`, `yc.scn.trg.${t}.d`);
    for (const t of ['event_published', 'chance_high', 'segment_joined', 'manual_segment', 'signup_confirmed']) want.push(`yc.scn.trg.${t}.sum`);
    for (const t of ['before_event', 'after_event', 'absence', 'click_no_buy']) want.push(`yc.scn.trg.${t}.sum.one`, `yc.scn.trg.${t}.sum.other`);
    for (const k of [...SCENARIO_TEMPLATES, 'blank']) want.push(`yc.scn.tpl.${k}.name`, `yc.scn.tpl.${k}.d`);
    for (const k of SCENARIO_TEMPLATES) for (const n of TEMPLATE_SMS[k]) want.push(`yc.scn.tpl.${k}.${n}`);
    for (const s of ['draft', 'active', 'paused', 'archived', 'frozen', 'plan_paused']) want.push(`yc.scn.state.${s}`);
    for (const s of ['frozen', 'plan_paused']) want.push(`yc.scn.ed.${s}`);
    for (const g of ['bought_event', 'bought_any', 'entered', 'none']) want.push(`yc.scn.goal.${g}`);
    for (const a of ['start', 'end', 'sale_open']) want.push(`yc.scn.anchor.${a}`, `yc.scn.anchor.${a}.l`);
    for (const e of ['scenario', 'for_person', 'fixed', 'none']) want.push(`yc.scn.evmode.${e}`, `yc.scn.evmode.${e}.short`, `yc.scn.evmode.${e}.h`);
    for (const w of ['entered', 'absent_buyers', 'all']) want.push(`yc.scn.v.who.${w}`);
    for (const k of ['annonce', 'lastcall', 'retour', 'manque', 'merci', 'bienvenue', 'relance', 'vide']) want.push(`yc.scn.email.kind.${k}`);
    for (const b of ['events', 'signups', 'absence', 'clicks']) want.push(`yc.scn.pub.basis.${b}`);
    for (const r of ['queued', 'late', 'no_consent', 'no_event', 'no_template', 'already_sent', 'spacing', 'pressure_24h', 'pressure_7d', 'fatigue', 'averse',
      'suppressed', 'pressure_sms', 'yunits', 'plan_paused', 'frozen', 'sms_identity', 'retry', 'other']) want.push(`yc.scn.why.${r}`);
    for (const x of ['end', 'goal', 'archived', 'erased', 'optout', 'suppressed', 'unsubscribed', 'stop', 'event_cancelled']) want.push(`yc.scn.exit.${x}`);
    for (const c of ['bad_version', 'bad_trigger', 'soon', 'bad_entry', 'bad_reentry', 'bad_goal', 'no_nodes', 'too_many_nodes', 'bad_start', 'bad_node_id',
      'bad_node_type', 'missing_next', 'bad_ref', 'cycle', 'orphan', 'too_many_paths', 'too_many_messages', 'too_close', 'after_start', 'bad_split',
      'url_in_text', 'link_without_event', 'bad_node_ref', 'unknown_segment', 'unknown_page', 'page_without_event', 'unknown_template', 'unknown_event',
      'event_past', 'sms_identity', 'chance_unavailable']) want.push(`yc.scn.err.${c}`);
    for (const c of ['root_not_group', 'not_object', 'bad_op', 'bad_not', 'empty_group', 'too_deep', 'too_many_leaves', 'unknown_key', 'bad_value', 'not_in_entry', 'soon']) {
      want.push(`yc.scn.err.cond_${c}`);
    }
    for (const f of ['days', 'hours', 'who', 'first', 'segment_id', 'page_id', 'series', 'genre', 'value', 'template_id', 'subject', 'event', 'event_id',
      'body', 'op', 'tag', 'label', 'anchor', 'when', 'max_hours', 'mode']) want.push(`yc.scn.f.${f}`);
    for (const p of ['days', 'hours', 'pub.errors', 'yunits', 'sms.parts', 'list.archived', 'gal.emails', 'gal.sms', 'ed.confirmRemove', 'unknownNode']) {
      want.push(`yc.scn.${p}.one`, `yc.scn.${p}.other`);
    }
    for (const r of ['held', 'expired']) want.push(`yc.scn.rep.${r}`);
    for (const v of ['few', 'pending', 'none', 'gain', 'loss']) want.push(`yc.scn.verdict.${v}`);
    expect(want.filter((k) => !has(k))).toEqual([]);
  });

  it('trois langues, mêmes variables', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !['lien', 'prénom', 'nom_club', 'soirée'].includes(v)).sort().join(',');
    const bad: string[] = [];
    for (const [k, [en, fr, es]] of Object.entries(scenarios)) {
      if (!en || !fr || !es) bad.push(`${k}: vide`);
      if (vars(en) !== vars(fr) || vars(en) !== vars(es)) bad.push(`${k}: variables`);
    }
    expect(bad).toEqual([]);
  });

  it('les SMS des modèles restent en GSM-7 (un caractère hors alphabet double le prix)', () => {
    const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà{}\n]*$/;
    const bad: string[] = [];
    for (const k of SCENARIO_TEMPLATES) {
      for (const n of TEMPLATE_SMS[k]) {
        const [en, fr, es] = scenarios[`yc.scn.tpl.${k}.${n}`];
        for (const s of [en, fr, es]) if (!GSM.test(s.replace(/\{\{[^}]+\}\}/g, ''))) bad.push(`${k}.${n}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
