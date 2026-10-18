/**
 * Jeu d'évaluation du bâtisseur de scénarios (agents, lot A2). Une demande de
 * pro, la réponse enregistrée d'une IA (le graphe déposé par
 * create_scenario_draft) et ce qu'on attend d'elle. `evaluateBuild` rend la
 * liste des manquements ; vide = la réponse tient. Aucune IA n'est appelée :
 * les tests rejouent des réponses enregistrées (fixtures).
 */
import { graphErrors, type ScenarioGraph } from './scenarioGraph';
import { forbiddenWording, inventedNumbers, scenarioTexts } from './agentText';

export interface BuildExpect {
  /** Déclencheur(s) acceptés. */
  trigger?: string | string[];
  /** Chaque entrée : au moins une de ces clés de condition doit apparaître (filtre d'entrée ou étapes). */
  leaves?: string[][];
  /** Familles que la demande appelle (hyp / sc_family) : seulement si confirmées, sinon une condition plus large. */
  goal?: string;
  maxMessages?: number;
  /** Pas de SMS (identité d'expéditeur absente, ou demande « e-mail seulement »). */
  noSms?: boolean;
}

export interface BuildContext {
  /** Familles confirmées sur le compte (get_scenario_kit.confirmed_families). */
  confirmed: string[];
  /** Les modèles d'e-mail du compte (ids). */
  templates: string[];
  /** Les résultats d'outils de l'exécution, en texte : tout nombre d'un message doit s'y trouver. */
  toolResults: string;
}

type Tree = { op?: string; items?: Tree[]; k?: string; v?: unknown };

function leavesOf(t: unknown, out: { k: string; v: unknown }[] = []): { k: string; v: unknown }[] {
  if (!t || typeof t !== 'object') return out;
  const n = t as Tree;
  if (typeof n.k === 'string') out.push({ k: n.k, v: n.v });
  for (const it of n.items ?? []) leavesOf(it, out);
  return out;
}

/** Toutes les feuilles d'un graphe : filtre d'entrée, embranchements, attentes « jusqu'à ». */
export function graphLeaves(g: ScenarioGraph): { k: string; v: unknown }[] {
  const out = leavesOf(g.entry?.filter);
  for (const node of Object.values(g.nodes ?? {})) {
    const c = (node as { cond?: unknown }).cond;
    if (c) leavesOf(c, out);
  }
  return out;
}

export function evaluateBuild(name: string, graph: ScenarioGraph, expect: BuildExpect, ctx: BuildContext): string[] {
  const fails: string[] = [];
  if (graphErrors(graph).errors.length) fails.push('graph_errors');
  const triggers = expect.trigger ? (Array.isArray(expect.trigger) ? expect.trigger : [expect.trigger]) : [];
  if (triggers.length && !triggers.includes(String(graph.trigger?.type))) fails.push('trigger');
  if (expect.goal && graph.goal?.type !== expect.goal) fails.push('goal');
  const leaves = graphLeaves(graph);
  for (const any of expect.leaves ?? []) {
    if (!leaves.some((l) => any.includes(l.k))) fails.push(`missing_leaf:${any.join('|')}`);
  }
  for (const l of leaves) {
    if (l.k !== 'hyp' && l.k !== 'sc_family') continue;
    const fams = Array.isArray(l.v) ? l.v.map(String) : [String(l.v)];
    for (const f of fams) if (!ctx.confirmed.includes(f)) fails.push(`unconfirmed_family:${f}`);
  }
  const nodes = Object.values(graph.nodes ?? {}) as { type?: string; template_id?: string }[];
  for (const n of nodes) if (n.type === 'email' && n.template_id && !ctx.templates.includes(n.template_id)) fails.push('unknown_template');
  if (expect.noSms && nodes.some((n) => n.type === 'sms')) fails.push('channel_sms');
  const stats = graphErrors(graph).stats as { maxMessages?: number };
  if (expect.maxMessages !== undefined && (stats.maxMessages ?? 0) > expect.maxMessages) fails.push('too_many_messages');
  // Les chiffres d'un MESSAGE (SMS, objet) viennent des outils ou des réglages du
  // scénario lui-même (jours, heures) ; un nom ou une étiquette en porte de structure.
  const structure = JSON.stringify(graph, (k, v) => (['body', 'subject', 'label', 'tag'].includes(k) ? undefined : v));
  for (const t of scenarioTexts(name, graph)) {
    for (const w of forbiddenWording(t.text)) fails.push(`wording:${w}`);
    if (!/\.(body|subject)$/.test(t.where)) continue;
    for (const x of inventedNumbers(t.text, `${ctx.toolResults} ${structure}`)) fails.push(`invented_number:${x}`);
  }
  return [...new Set(fails)];
}
