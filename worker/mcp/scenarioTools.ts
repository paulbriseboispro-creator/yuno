// Les outils « scénarios » du serveur MCP (Yuno CRM) : la liste et le rapport
// (des agrégats, jamais une personne), le kit (ce qu'un graphe peut contenir,
// avec les modèles d'e-mail, segments, pages et soirées du compte) et les
// BROUILLONS (contrôle local par le validateur de l'éditeur, puis mcp_write).
// Une IA ne publie, ne reprend, n'archive ni ne supprime jamais un scénario.

import { compactResult } from './compact';
import { rpc } from './db';
import type { McpEnv } from './config';
import {
  EVENT_TRIGGERS, NODE_TYPES, SCN_MAX_MESSAGES, SCN_MAX_NODES, SCN_MIN_GAP_HOURS, SOON_TRIGGERS, TRIGGERS, graphErrors,
  type GraphError, type ScenarioGraph,
} from '../../src/crm/lib/scenarioGraph';
import { CHANCE_LABELS, CHANNEL_CODES, COND_LEAVES, COND_MAX_DEPTH, COND_MAX_LEAVES, TARGET_AUDIENCES } from '../../src/crm/lib/scenarioConditions';
import { SCENARIO_TEMPLATES, TEMPLATE_EMAILS, TEMPLATE_SMS, buildScenarioTemplate } from '../../src/crm/lib/scenarioTemplates';

interface CallEnvelope {
  ok: boolean;
  error?: string;
  call_id?: number;
  space?: { key: string; name: string; kind: string; product: string };
  spaces?: unknown;
  result?: Record<string, unknown> | null;
}

export interface ScenarioToolOutcome { text: string; isError: boolean; code?: string; callId?: number }

export const SCENARIO_CONSOLE = 'https://crm.yunoapp.eu/crm/automations';
const scenarioUrl = (id: string) => `${SCENARIO_CONSOLE}/scenarios/${id}`;

/** Messages d'erreur des outils de scénarios, écrits pour que l'IA sache quoi faire. */
export function scenarioErrorText(code: string, extra: Record<string, unknown> = {}): string {
  switch (code) {
    case 'scenarios_not_allowed':
      return 'This connection was approved before scenario drafts existed, or without them: Yuno cannot write scenarios for it. The person can reconnect Yuno in their AI app (the consent screen includes scenario drafts). Meanwhile, describe the scenario step by step in the conversation.';
    case 'write_forbidden':
      return 'This person cannot edit scenarios in this space of the Yuno CRM Console (owner, admin, manager or editor). Ask which space to use.';
    case 'crm_not_active':
      return 'Scenarios are a Yuno CRM feature, and Yuno CRM is not active on this space. Another space of the connection may have it (get_account_overview lists them).';
    case 'scenario_not_found':
      return 'No scenario of this space matches. list_scenarios gives their ids and names.';
    case 'no_upcoming':
      return 'This space has no upcoming night synced from its ticketing: there is nothing to plan yet.';
    case 'not_upcoming':
      return 'This night is over: a plan is only for an upcoming night. get_event_report tells how it went.';
    case 'event_not_found':
      return 'No upcoming night of this space matches. list_events gives the nights with their ids and dates.';
    case 'scenario_archived':
      return 'This scenario is archived: it cannot change any more. Create a new draft instead.';
    case 'invalid_graph':
      return 'The graph is not a scenario: it must be an object with "v": 1, a trigger, an entry, a goal, a start and nodes (see graph_format in get_scenario_kit).';
    case 'graph_too_large':
      return 'The graph is larger than 64 KB. Use fewer steps or shorter texts.';
    case 'graph_required':
      return 'create_scenario_draft needs a graph (see graph_format and examples in get_scenario_kit).';
    case 'invalid_name':
      return 'The name is 80 characters at most.';
    case 'nothing_to_change':
      return 'Nothing to change was given: pass name and / or graph.';
    case 'rate_limited':
      return 'Too many scenario changes for this connection today (20 drafts created, 200 updates). Reuse update_scenario_draft on an existing draft.';
    case 'space_not_allowed':
      return `This space is not part of the connection. Spaces: ${JSON.stringify(extra.spaces ?? [])}.`;
    case 'invalid_args':
      return `Invalid arguments${extra.message ? `: ${String(extra.message)}` : ''}.`;
    default:
      return 'The scenario could not be saved on the Yuno side. Try again in a moment.';
  }
}

// ── Ce qu'un graphe peut contenir (miroir du validateur de l'éditeur) ────────

const TRIGGER_HELP: Record<string, string> = {
  event_published: 'Each night published on the ticketing after the scenario goes live (the whole base, once per night, within 48 h). Gives the scenario its night.',
  before_event: 'params: days (1-60), series (optional, exact series name), genre (optional). The whole base, N calendar days before each night. Gives the night.',
  after_event: 'params: hours (1-720) after the end, who: "entered" (scanned), "absent_buyers" (bought, not scanned, only when the door scanned at least half), "all" (ticket holders). Gives the night.',
  ticket_bought: 'params: first (true = first ticket of the person only), series (optional). Within 10 minutes of the ticketing sync. Gives the night.',
  segment_joined: 'params: segment_id. New members of a saved segment, read once a day (people already in it at launch do not enter). No night.',
  manual_segment: 'params: segment_id. The whole segment enters once, at launch. No night.',
  absence: 'params: days (14-730). People whose last night was exactly N days ago, with no upcoming ticket. No night.',
  click_no_buy: 'params: hours (1-72). Clicked a night\'s ticketing link in one of this account\'s emails, no ticket N hours later. Gives the night.',
  signup_confirmed: 'params: page_id (a signup page). A confirmed signup on that page. Gives the page\'s night when it has one.',
  chance_high: '"Chances of coming" high for an upcoming night, no ticket; read once a day. Gives the night. Needs the account\'s score (chances_available in the kit).',
};

const NODE_HELP: Record<string, string> = {
  wait: 'mode "duration": hours (1-2160), next. mode "until_event": anchor ("start", "end", "sale_open") and either hours (-720..720) or days (-60..60) + at ("HH:MM"), next; before the start only. mode "until_cond": cond (a group), max_hours (1-744), next (condition met) and timeout (time is up). Needs a night for until_event.',
  branch: 'cond (a group): yes and no (two node ids).',
  split: 'paths: 2 to 4 objects {pct (1-99), next}, pcts summing to 100. Random, stable per person.',
  email: 'template_id (one of email_templates in the kit), event ("scenario" = the scenario\'s night, "for_person" = the upcoming night that fits each person best, "fixed" + event_id), subject (optional, 140 chars, no web address), next.',
  sms: 'body (1-480 chars; variables {{prénom}}, {{nom_club}}, {{soirée}}, {{lien}} = the night\'s short Yuno link; no other web address), event ("scenario", "for_person", "fixed" + event_id, or "none" without {{lien}}), next. Needs the SMS sender identity (sms_sender_ready).',
  tag: 'op ("add" or "remove"), tag (1-40 chars), next.',
  notify: 'label (1-80 chars): a daily notification in the Console with how many people went through. next.',
  instagram_dm: 'Not available yet.',
  end: 'The person leaves. No fields.',
};

const LEAF_HELP: Record<string, string> = {
  age_min: 'age at least', age_max: 'age at most', gender: 'gender', area: 'city', country: 'country codes', country_not: 'lives outside a country',
  dist_min: 'lives at least N km from the venue', dist_max: 'lives at most N km away', pass: 'passing through (yes) or local (no)',
  src: 'came in through', tags: 'has one of these tags', segment: 'is in a saved segment',
  seg: 'lifecycle stage (hab regular, occ occasional, nou new, end dormant, none never came)', ev: 'holds a ticket for one of these nights',
  last: 'last night range', last_gt_days: 'no night for more than N days', last_lt_days: 'came less than N days ago',
  nb: 'number of nights range', nb_min: 'at least N nights', nb_max: 'at most N nights', sp: 'total spend range', sp_min: 'spent at least (EUR)',
  basket_min: 'spend per paid night at least (EUR)', paid_min: 'at least N paid nights', up: 'has an upcoming ticket',
  sc_bought: 'bought a ticket for the scenario\'s night since entering (steps only)', sc_entered: 'was scanned at the scenario\'s night (steps only)',
  hyp: 'carries a "what brings them" hypothesis', sc_family: 'family CONFIRMED on the account AND carried by the person (else nobody)',
  artist: 'saw one of these artists ("name:<artist>")', genre: 'genres of nights attended', fmt: 'formats of nights attended', series: 'series attended',
  buy: 'buying moment', grp: 'comes in a group, alone or brought', ntgt: '"Who to target" audience of a night',
  sc_chance: 'chances of coming for the scenario\'s night', msg: 'email behaviour', click_lt_days: 'clicked an email less than N days ago',
  sc_opened: 'opened this email step (steps only)', sc_clicked: 'clicked this email step (steps only)', sc_sms_delivered: 'received this SMS step (steps only)',
  sc_sms_clicked: 'not available (the SMS short link is shared per night)', gl: 'guest list profile', glev: 'on the guest list of one of these nights',
  rc: 'reachable by', ch: 'reachable channels', arr: 'bought through (source family)',
};

function valueFormat(k: string): string {
  const spec = COND_LEAVES[k].spec;
  switch (spec.t) {
    case 'enum': return `one of ${JSON.stringify(spec.of)}`;
    case 'set': return `non-empty array of ${JSON.stringify(spec.of)}`;
    case 'int': return `integer 0-${spec.max}`;
    case 'money': return 'number of euros, 2 decimals at most';
    case 'bool': return 'true or false';
    case 'strings': return 'non-empty array of strings';
    case 'pattern': return 'two-letter country code';
    case 'patterns': return k === 'artist' ? 'non-empty array of "name:<artist>" (or "id:" / "slug:")' : 'non-empty array of two-letter country codes';
    case 'uuid': return 'segment id (segments in the kit)';
    case 'events': return 'non-empty array of night ids, "T" (tonight) or "$event" (the scenario\'s night)';
    case 'ntgt': return `{"e": night id or "$event", "a": one of ${JSON.stringify(TARGET_AUDIENCES)}}`;
    case 'node': return 'id of an email node (sc_opened, sc_clicked) or SMS node (sc_sms_delivered) of this graph';
    default: return 'not available yet';
  }
}

/** Le catalogue statique du kit : construit depuis le validateur, jamais recopié à la main. */
export function scenarioCatalog(): Record<string, unknown> {
  const examples = SCENARIO_TEMPLATES.map((key) => ({
    template: key,
    email_nodes_need: TEMPLATE_EMAILS[key],
    sms_nodes: TEMPLATE_SMS[key],
    graph: buildScenarioTemplate(key,
      Object.fromEntries(Object.keys(TEMPLATE_EMAILS[key]).map((id) => [id, '<email template id>'])),
      Object.fromEntries(TEMPLATE_SMS[key].map((id) => [id, '<SMS text with {{lien}}>']))),
  }));
  return {
    graph_format: {
      shape: '{"v": 1, "trigger": {"type": …, …params}, "entry": {"filter": null | group, "reentry": {"mode": "once" | "per_event" | "every_days", "days": 7-365}, "holdout": true}, "goal": null | {"type": "bought_event" | "bought_any" | "entered"}, "start": "<node id>", "nodes": {"<id>": {"type": …}}}',
      node_ids: 'lowercase letters, digits, "_" or "-", 32 chars at most',
      group: `{"op": "and" | "or", "not": false, "items": [leaf or group]} — ${COND_MAX_DEPTH} levels at most (root included), ${COND_MAX_LEAVES} leaves at most`,
      leaf: '{"k": "<key>", "v": <value>}',
      night_rule: `Triggers that give the scenario its night: ${EVENT_TRIGGERS.join(', ')}. Without a night: no "per_event" re-entry, no goal other than bought_any, no "scenario" event in messages, no until_event wait, no sc_bought / sc_entered / sc_chance / "$event".`,
    },
    triggers: Object.fromEntries(TRIGGERS.map((t) => [t, TRIGGER_HELP[t]])),
    triggers_not_available: SOON_TRIGGERS,
    nodes: Object.fromEntries(NODE_TYPES.map((n) => [n, NODE_HELP[n]])),
    condition_leaves: Object.fromEntries(Object.entries(COND_LEAVES).map(([k, d]) => [k, {
      family: d.family, means: LEAF_HELP[k] ?? k, value: valueFormat(k),
      ...(d.scenario && !d.entry ? { where: 'steps only (branch, wait until), never in the entry filter' } : {}),
    }])),
    value_lists: { channels: CHANNEL_CODES, chances: CHANCE_LABELS, audiences: TARGET_AUDIENCES },
    limits: {
      nodes: SCN_MAX_NODES, messages_per_path: SCN_MAX_MESSAGES, min_gap_between_messages_hours: SCN_MIN_GAP_HOURS,
      note: 'A message less than 20 h after the previous one on the same path is refused when the waits prove it.',
    },
    sending_rules: 'Nobody enters if another automation of the account wrote to them in the last 48 h. Then each message follows the Yuno send policy (1 per 24 h, 3 per 7 days, people who no longer open are protected); a held message leaves later or expires past its deadline. E-mails wait out the night (11 pm-9 am), SMS never leave between 9:30 pm and 8 am. A share of entrants (holdout_pct) receives nothing, to measure the real effect.',
    examples,
  };
}

const GRAPH_ERROR_HELP: Record<string, string> = {
  bad_trigger: 'unknown or missing trigger', soon: 'not available yet', bad_param: 'a parameter is missing or out of range',
  bad_entry: 'entry incomplete', bad_reentry: 're-entry mode or days invalid', bad_goal: 'goal invalid', no_event: 'needs a night, but the trigger gives none',
  no_nodes: 'no steps', too_many_nodes: 'too many steps', bad_start: 'start points to no step', bad_node_id: 'invalid step id',
  bad_node_type: 'unknown step type', missing_next: 'next step missing', bad_ref: 'points to a step that does not exist', cycle: 'loop',
  orphan: 'no path reaches this step', too_many_paths: 'too many paths', too_many_messages: 'more than 6 messages on a path',
  too_close: 'less than 20 h after the previous message: add a wait', after_start: 'a wait relative to the start must be before it',
  bad_split: 'split paths invalid', url_in_text: 'web address in a text (only {{lien}})', link_without_event: '{{lien}} needs a night',
  bad_node_ref: 'condition points to a step of the wrong type', unknown_segment: 'segment not found', unknown_page: 'signup page not found',
  page_without_event: 'the signup page has no night', unknown_template: 'email template not found in this space', unknown_event: 'not a night of this space',
  event_past: 'this night has passed', sms_identity: 'SMS sender identity missing (SMS settings)',
  family_not_confirmed: 'this family is not confirmed on the account: nobody takes this path for now',
  chance_unavailable: '"Chances of coming" not available on this account: nobody matches',
};

function issues(list: unknown): { step: string | null; field: string | null; code: string; means: string }[] {
  return (Array.isArray(list) ? list as GraphError[] : []).map((e) => ({
    step: e.node, field: e.field, code: e.code,
    means: GRAPH_ERROR_HELP[e.code] ?? (e.code.startsWith('cond_') ? `condition: ${e.code.slice(5).replace(/_/g, ' ')}` : e.code),
  }));
}

function holdoutVerdict(m: Record<string, unknown> | null | undefined): string {
  if (!m) return 'not measured';
  const c = (m.contacted ?? {}) as { n?: number }; const h = (m.control ?? {}) as { n?: number };
  if ((c.n ?? 0) < 10 || (h.n ?? 0) < 10) return 'too few people to compare';
  if (!m.done) return 'measuring: people are still on their way';
  const z = typeof m.z === 'number' ? m.z : null;
  if (z === null || Math.abs(z) < 2) return 'no clear difference with the people not contacted';
  return z > 0 ? `about ${Math.round(Number(m.extra ?? 0))} more buyers thanks to this scenario` : 'fewer purchases among people contacted: worth reviewing';
}

/** Mise en forme d'une lecture (liste, rapport, kit). */
export function formatScenarioRead(tool: string, space: CallEnvelope['space'], inner: Record<string, unknown>): string {
  if (tool === 'get_scenario_kit') {
    return compactResult({
      space, ...inner, ...scenarioCatalog(),
      drafts_only: 'create_scenario_draft saves a DRAFT in the Yuno CRM Console; update_scenario_draft changes the draft (a live scenario keeps its live version). Only the person publishes, after "Before publishing".',
    }, 90_000);
  }
  if (tool === 'get_night_plan') {
    return compactResult({
      space, ...inner,
      notes: 'steps: now, week (the week before, 18:00), eve (the day before, 18:00). In each step, audiences come in the suggested order and a person counts once, '
        + 'in the first audience that contains them (first_n, first_email, first_sms); n is the whole audience. channel is the suggested one (SMS on the eve only when '
        + 'the SMS sender identity is ready and the step has numbers); cost_email / cost_sms are Yunits (SMS at the France rate, one segment). '
        + 'status / availability: what the account data says about the family behind an audience (supported = confirmed here), never a certainty about a person. '
        + 'score.expected and score.projection are estimates (validated model only). pace: tickets sold now vs the previous edition (same series first) at the same time before its night. '
        + 'planned: manual emails and SMS already linked to this night. Nothing is sent from this plan.',
    }, 90_000);
  }
  if (tool === 'list_scenarios') {
    const rows = Array.isArray(inner.scenarios) ? inner.scenarios as Record<string, unknown>[] : [];
    return compactResult({
      space,
      scenarios: rows.map((r) => ({ ...r, holdout_verdict: holdoutVerdict(r.holdout_measure as Record<string, unknown>), console_url: scenarioUrl(String(r.id)) })),
      console_url: `${SCENARIO_CONSOLE}?tab=scenarios`,
      notes: 'state: draft (never published), active (live), paused, frozen (sending frozen on the account), plan_paused (subscription paused), archived. entered / on_their_way / reached_goal count runs; not_contacted is the random share kept aside to measure the real effect.',
    });
  }
  // get_scenario_report
  const sc = (inner.scenario ?? {}) as Record<string, unknown>;
  const rep = (inner.report ?? null) as Record<string, unknown> | null;
  return compactResult({
    space,
    scenario: { ...sc, errors: issues(sc.errors), warnings: issues(sc.warnings) },
    report: rep ? { ...rep, holdout_verdict: holdoutVerdict(rep.holdout as Record<string, unknown>) } : null,
    console_url: inner.url,
    notes: rep
      ? 'nodes: per step id — entered, passed, sent (would_send on a demo account), holdout, opened / clicked (emails), held and expired with their reasons. attributed: purchases after a click on the scenario\'s emails in the 7 days before (last click wins); revenue is absent when the role does not show money.'
      : 'Never published: no results yet. errors must be fixed before the person can publish.',
  }, 90_000);
}

// ── Écriture ─────────────────────────────────────────────────────────────────

interface ScenarioArgs { space?: string; scenario?: string; name?: string; graph?: unknown; template?: string }

export async function runScenarioWrite(
  env: McpEnv, accessHash: string, tool: 'create_scenario_draft' | 'update_scenario_draft', raw: Record<string, unknown>,
): Promise<ScenarioToolOutcome> {
  const a = raw as ScenarioArgs;
  const isCreate = tool === 'create_scenario_draft';
  // Contrôle local de la forme (le même validateur que l'éditeur) : un brouillon
  // incomplet s'enregistre, mais l'IA voit tout de suite ce qui manque.
  let local: GraphError[] = [];
  if (a.graph !== undefined) {
    if (!a.graph || typeof a.graph !== 'object' || (a.graph as ScenarioGraph).v !== 1) {
      return { text: scenarioErrorText('invalid_graph'), isError: true, code: 'invalid_graph' };
    }
    local = graphErrors(a.graph).errors;
  }
  const payload: Record<string, unknown> = {};
  if (a.space) payload.space = a.space;
  if (a.name !== undefined) payload.name = a.name;
  if (a.graph !== undefined) payload.graph = a.graph;
  if (isCreate && a.template && (SCENARIO_TEMPLATES as readonly string[]).includes(a.template)) payload.template = a.template;
  if (!isCreate) payload.scenario = a.scenario;

  const w = await rpc<CallEnvelope>(env, 'mcp_write', { p_access_hash: accessHash, p_tool: tool, p_args: payload }, 28_000);
  if (w.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
  const res = w.result ?? {};
  if (!w.ok || res.ok === false) {
    const code = String(res.error ?? w.error ?? 'internal');
    return { text: scenarioErrorText(code, { spaces: w.spaces }), isError: true, code, callId: w.call_id };
  }
  const id = String(res.scenario_id ?? '');
  const errs = issues(res.errors);
  const out = {
    saved: true,
    published: false,
    scenario: { id, name: res.name, status: res.status, version: res.version, has_unpublished_changes: res.has_unpublished_changes },
    ready_to_publish: errs.length === 0,
    errors: errs,
    warnings: issues(res.warnings),
    ...(local.length && !errs.length ? { local_checks: issues(local) } : {}),
    stats: res.stats,
    console_url: id ? scenarioUrl(id) : SCENARIO_CONSOLE,
    space: w.space,
    next: errs.length
      ? 'The draft is saved with these errors: fix them with update_scenario_draft (pass the whole graph), then tell the person it is ready to review.'
      : `The scenario is a DRAFT in the Yuno CRM Console (console_url). Nothing runs until the person opens "Before publishing" (who would enter today, weekly estimate, Yunits ceiling), tests each message and publishes it there.${Number(res.version ?? 0) > 0 ? ' It is already live: the live version keeps running until the person publishes these changes.' : ''}`,
  };
  return { text: JSON.stringify(out), isError: false, callId: w.call_id };
}
