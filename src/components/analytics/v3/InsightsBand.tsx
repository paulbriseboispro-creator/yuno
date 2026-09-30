/**
 * Bandeau d'insights (spec §7) : 1 à 3 constats calculés par règles côté
 * serveur (jamais sous 20 observations), chacun avec son niveau et un lien
 * « Voir » vers l'onglet qui le prouve.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import type { An3Insight } from '@/lib/analytics/an3Types';
import type { An3Tab } from '@/lib/analytics/an3Nav';
import { A3 } from './an3Tokens';
import { insightText } from './an3Labels';

export function InsightsBand({ insights, onOpen }: { insights: An3Insight[]; onOpen: (tab: An3Tab) => void }) {
  const { t, language } = useLanguage();
  if (!insights.length) return null;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2" aria-label={t('an3.ins.aria')}>
      {insights.map((i) => {
        const color = i.level === 'critical' ? A3.bad : i.level === 'warn' ? A3.warn : A3.accent;
        return (
          <li key={i.key} className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: A3.cardBg, border: `1px solid ${A3.border}`, boxShadow: A3.shadow }}>
            <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
            <p className="m-0 flex-1 text-[13px] leading-relaxed" style={{ color: A3.t1 }}>
              {insightText(t, language, i)}
              {t(`an3.ins.${i.key}.action`) !== `an3.ins.${i.key}.action` && <span style={{ color: A3.t2 }}> → {t(`an3.ins.${i.key}.action`)}</span>}
            </p>
            <button type="button" onClick={() => onOpen(i.tab as An3Tab)} className="shrink-0 text-[12.5px] font-medium min-h-[36px] px-2" style={{ color: A3.accent }}>{t('an3.ins.see')}</button>
          </li>
        );
      })}
    </ul>
  );
}
