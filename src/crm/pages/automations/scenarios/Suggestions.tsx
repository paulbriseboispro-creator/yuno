/**
 * « Pistes d'amélioration » d'un scénario publié (agents, lot A4). Calculées
 * sur la version EN LIGNE (celle que les chiffres mesurent) par
 * `scenarioSuggestions`, sans IA ; rien tant que le témoin n'a pas de verdict.
 * « Appliquer au brouillon » change le brouillon (enregistré comme toute
 * modification) : le pro publie ensuite lui-même. Un objet d'e-mail se réécrit
 * avec son IA.
 */
import { PillButton } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import type { useCrmT } from '@/crm/i18n';
import { AskMyAiButton } from '@/crm/components/AskMyAi';
import type { ScenarioGraph } from '@/crm/lib/scenarioGraph';
import { applySuggestion, scenarioSuggestions, type ScenarioSuggestion, type SuggestReport } from '@/crm/lib/scenarioSuggest';

type T = ReturnType<typeof useCrmT>;

/** Le brouillon porte-t-il encore le réglage que la piste veut changer ? */
function applicable(draft: ScenarioGraph, s: ScenarioSuggestion): boolean {
  if (s.kind === 'later' || s.kind === 'earlier') {
    return (draft.nodes?.[s.wait] as unknown as Record<string, unknown> | undefined)?.[s.field] === s.from;
  }
  if (s.kind === 'narrow') return !JSON.stringify(draft.entry?.filter ?? null).includes('"click_lt_days"');
  return true;
}

function suggestionText(s: ScenarioSuggestion, step: string, T: T): string {
  const { t, n } = T;
  if (s.kind === 'narrow') return t('yc.ag.sug.narrow', { cb: n(s.contacted.buyers), cn: n(s.contacted.n), hb: n(s.control.buyers), hn: n(s.control.n) });
  if (s.kind === 'subject') return t('yc.ag.sug.subject', { step, p: n(s.pct), o: n(s.opened), s: n(s.sent) });
  return t(`yc.ag.sug.${s.kind}.${s.field}`, { step, p: n(s.pct), c: n(s.count), e: n(s.entered), from: n(Math.abs(s.from)), to: n(Math.abs(s.to)) });
}

export function Suggestions({ T, live, draft, report, name, nodeLabel, canEdit, onApply }: {
  T: T; live: ScenarioGraph; draft: ScenarioGraph; report: SuggestReport; name: string;
  nodeLabel: (id: string) => string; canEdit: boolean; onApply: (g: ScenarioGraph) => void;
}) {
  const { t } = T;
  const toast = useCrmToast();
  const { verdict, suggestions } = scenarioSuggestions(live, report);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 16, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ag.sug.title')}</span>
      {verdict === 'few' || verdict === 'pending'
        ? <span style={{ fontSize: 14, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('yc.ag.sug.wait')}</span>
        : suggestions.length === 0
          ? <span style={{ fontSize: 14, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('yc.ag.sug.none')}</span>
          : suggestions.map((s, i) => {
            const step = 'node' in s ? nodeLabel(s.node) : '';
            const text = suggestionText(s, step, T);
            const ok = applicable(draft, s);
            return (
              <div key={`${s.kind}:${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderTop: i ? '1px solid var(--sand-100)' : 0 }}>
                <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink)', textWrap: 'pretty' }}>{text}</span>
                {canEdit && (s.kind === 'subject'
                  ? <div><AskMyAiButton size="sm" need="scenarios" text={t('yc.ag.ai.q.subject', { name, step })} /></div>
                  : ok
                    ? <div><PillButton size="sm" tone="dark" onClick={() => { onApply(applySuggestion(draft, s)); toast(t('yc.ag.sug.applied')); }}>{t('yc.ag.sug.apply')}</PillButton></div>
                    : <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.ag.sug.changed')}</span>)}
              </div>
            );
          })}
    </section>
  );
}
