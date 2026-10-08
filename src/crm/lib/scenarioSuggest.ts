/**
 * « Pistes d'amélioration » d'un scénario (agents, lot A4 ; décision 8 de Paul).
 * Des règles déterministes, sans IA, sur les chiffres par étape et le verdict
 * du témoin (crm_scenario_report). Rien tant que le témoin n'a pas de verdict.
 * Chaque piste porte sa raison chiffrée ; celles qui changent un réglage
 * portent leur correctif, que le PRO applique au brouillon (jamais appliqué
 * seul, jamais publié). Partagé par l'éditeur et le Worker MCP.
 */
import type { ScenarioGraph } from './scenarioGraph';

/**
 * Verdict du témoin : miroir EXACT de `holdoutVerdict` (src/crm/lib/holdout.ts,
 * testé contre lui) sans dépendre de l'alias `@/`, que le Worker MCP ne lit pas.
 */
export type SuggestVerdict = 'demo' | 'few' | 'pending' | 'none' | 'gain' | 'loss';
export function suggestVerdict(h: SuggestReport['holdout']): SuggestVerdict {
  // Compte démo : rien n'est parti, aucune comparaison (le serveur ne rend ni écart ni z).
  if (h.demo) return 'demo';
  if (h.contacted.n < 10 || h.control.n < 10) return 'few';
  if (!h.done) return 'pending';
  if (h.z === null || Math.abs(h.z) < 2) return 'none';
  return h.z > 0 ? 'gain' : 'loss';
}

export interface SuggestNodeStats {
  entered: number; sent: number; opened: number; reasons: Record<string, number>;
}
export interface SuggestReport {
  nodes: Record<string, SuggestNodeStats>;
  holdout: { done: boolean; contacted: { n: number; buyers: number }; control: { n: number; buyers: number }; z: number | null; demo?: boolean };
}

export type ScenarioSuggestion =
  | { kind: 'later' | 'earlier'; node: string; wait: string; field: 'hours' | 'days'; from: number; to: number; count: number; entered: number; pct: number }
  | { kind: 'subject'; node: string; opened: number; sent: number; pct: number }
  | { kind: 'narrow'; contacted: { n: number; buyers: number }; control: { n: number; buyers: number } };

/** Entrants minimum d'une étape pour en juger, et seuils. */
export const SUGGEST_MIN_ENTERED = 30;
export const SUGGEST_SHARE = 0.2;
export const SUGGEST_MIN_SENT = 100;
export const SUGGEST_OPEN_RATE = 0.15;
const PRESSURE = ['pressure_24h', 'pressure_7d', 'spacing', 'pressure_sms'];

type WaitNode = { type: 'wait'; mode: string; hours?: number; days?: number; next?: string };

function waitBefore(g: ScenarioGraph, nodeId: string): [string, WaitNode] | null {
  for (const [id, n] of Object.entries(g.nodes ?? {})) {
    const w = n as unknown as WaitNode;
    if (w.type === 'wait' && w.next === nodeId) return [id, w];
  }
  return null;
}

function count(reasons: Record<string, number>, codes: string[], prefixes = ['held', 'expired']): number {
  let n = 0;
  for (const [k, v] of Object.entries(reasons ?? {})) {
    const [pre, code] = k.split(':');
    if (prefixes.includes(pre) && codes.includes(code)) n += Number(v) || 0;
  }
  return n;
}

function shift(w: WaitNode, later: boolean): { field: 'hours' | 'days'; from: number; to: number } | null {
  if (w.mode === 'duration' && typeof w.hours === 'number') {
    const to = later ? Math.min(720, w.hours + 24) : w.hours - 24;
    return to >= 1 && to !== w.hours ? { field: 'hours', from: w.hours, to } : null;
  }
  if (w.mode === 'until_event' && typeof w.days === 'number') {
    // Plus tard = plus près de la soirée (J-3 → J-2), jamais après la veille.
    const to = later ? w.days + 1 : w.days - 1;
    return to <= -1 && to >= -30 ? { field: 'days', from: w.days, to } : null;
  }
  return null;
}

export function scenarioSuggestions(graph: ScenarioGraph, report: SuggestReport): { verdict: SuggestVerdict; suggestions: ScenarioSuggestion[] } {
  const verdict = suggestVerdict(report.holdout);
  const out: ScenarioSuggestion[] = [];
  if (verdict === 'demo' || verdict === 'few' || verdict === 'pending') return { verdict, suggestions: out };
  for (const [id, n] of Object.entries(graph.nodes ?? {})) {
    const type = (n as { type?: string }).type;
    if (type !== 'email' && type !== 'sms') continue;
    const st = report.nodes?.[id];
    if (!st || st.entered < SUGGEST_MIN_ENTERED) continue;
    const pressed = count(st.reasons, PRESSURE);
    const late = count(st.reasons, ['late'], ['expired']);
    const wb = waitBefore(graph, id);
    if (wb && pressed / st.entered >= SUGGEST_SHARE) {
      const s = shift(wb[1], true);
      if (s) out.push({ kind: 'later', node: id, wait: wb[0], ...s, count: pressed, entered: st.entered, pct: Math.round((100 * pressed) / st.entered) });
    } else if (wb && late / st.entered >= SUGGEST_SHARE) {
      const s = shift(wb[1], false);
      if (s) out.push({ kind: 'earlier', node: id, wait: wb[0], ...s, count: late, entered: st.entered, pct: Math.round((100 * late) / st.entered) });
    }
    if (type === 'email' && st.sent >= SUGGEST_MIN_SENT && st.opened / st.sent < SUGGEST_OPEN_RATE) {
      out.push({ kind: 'subject', node: id, opened: st.opened, sent: st.sent, pct: Math.round((100 * st.opened) / st.sent) });
    }
  }
  const leaves = JSON.stringify(graph.entry?.filter ?? null);
  if (verdict === 'loss' && !leaves.includes('"click_lt_days"')) {
    out.push({ kind: 'narrow', contacted: report.holdout.contacted, control: report.holdout.control });
  }
  return { verdict, suggestions: out };
}

/** Le correctif d'une piste, appliqué à un brouillon (copie) ; « subject » ne change rien (un texte s'écrit). */
export function applySuggestion(graph: ScenarioGraph, s: ScenarioSuggestion): ScenarioGraph {
  const g = JSON.parse(JSON.stringify(graph)) as ScenarioGraph;
  if (s.kind === 'later' || s.kind === 'earlier') {
    const w = g.nodes[s.wait] as unknown as Record<string, unknown> | undefined;
    if (w) w[s.field] = s.to;
  } else if (s.kind === 'narrow') {
    const leaf = { k: 'click_lt_days', v: 90 };
    const f = g.entry.filter as { op?: string; not?: boolean; items?: unknown[] } | null;
    g.entry.filter = (f && f.op === 'and' && !f.not
      ? { ...f, items: [...(f.items ?? []), leaf] }
      : { op: 'and', items: f ? [f, leaf] : [leaf] }) as ScenarioGraph['entry']['filter'];
  }
  return g;
}
