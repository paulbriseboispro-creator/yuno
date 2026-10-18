/**
 * La règle d'une audience « Qui cibler » en une phrase : l'onglet du tiroir
 * d'une soirée et le plan de soirée la disent avec les mêmes mots.
 */
import { joinHostNames } from '@/lib/coorg';
import type { useCrmT } from '@/crm/i18n';
import type { NightTargetAudience } from '@/crm/data/analysis';

type T = ReturnType<typeof useCrmT>;

const genreName = (g: string) => {
  const s = g.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function targetRuleText(a: NightTargetAudience, T: T): string {
  const p = a.params ?? {};
  if (a.key === 'concept') return T.t('yc.tgt.aud.concept.rule', { s: p.series ?? '', e: T.n(p.editions ?? 0) });
  if (a.key === 'lineup') {
    const names = (p.artists ?? []).slice(0, 3).map((x) => x.name);
    return names.length
      ? T.t('yc.tgt.aud.lineup.rule', { a: joinHostNames(names, T.locale) })
      : T.t('yc.tgt.aud.lineup.ruleNone');
  }
  if (a.key === 'genre') return T.t('yc.tgt.aud.genre.rule', { g: (p.genres ?? []).map(genreName).join(', ') });
  return T.t(`yc.tgt.aud.${a.key}.rule`);
}

