/**
 * Kit commun des écrans d'analyse (Console Club et Console Organisateur).
 *
 * La grammaire qui rend Shotgun lisible, appliquée à Yuno : chaque total porte
 * ce qui a bougé AUJOURD'HUI, chaque chiffre dit d'où il vient (ⓘ), chaque
 * écran dit quand il a été lu, et une donnée partielle dit sur combien de
 * personnes elle est connue. Un écran d'analyse nouveau passe par ces briques
 * plutôt que de redessiner les siennes — c'est ce qui fera qu'on lit tous les
 * écrans de la même façon.
 *
 * Tokens du design system pro (`docs/DESIGN_SYSTEM.md`) : encre `--ink`,
 * jamais un blanc en dur, pour suivre le thème clair.
 */
import { ArrowUp, Clock, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { KIT, useNumberFormat } from './kitFormat';

/**
 * « ▲ 6 aujourd'hui » sous un total. Rien aujourd'hui = une ligne grise, pas
 * un zéro vert : « est-ce que ça bouge ? » doit se lire d'un coup d'œil.
 */
export function TodayDelta({ value, display, size = 11.5 }: { value: number; display?: string; size?: number }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  if (value <= 0) {
    return <span className="whitespace-nowrap" style={{ color: KIT.T3, fontSize: size }}>{t('ak.nothingToday')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap tabular-nums" style={{ color: KIT.POS, fontSize: size, fontWeight: 600 }}>
      <ArrowUp className="h-3 w-3 flex-none" aria-hidden />
      {t('ak.today').replace('{value}', display ?? n(value))}
    </span>
  );
}

/** « Mis à jour à 16:05 » : dit quand l'écran a lu la base. */
export function UpdatedAt({ at }: { at: Date | null }) {
  const { t } = useLanguage();
  const { time } = useNumberFormat();
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 11 }}>
      <Clock className="h-3 w-3" aria-hidden />
      {t('ak.updatedAt').replace('{time}', time(at))}
    </span>
  );
}

/**
 * ⓘ à côté d'un libellé : la définition exacte du chiffre, au survol, au
 * focus ou au toucher. Une définition, pas un mode d'emploi — une phrase.
 */
export function MetricHint({ text, label }: { text: string; label?: string }) {
  const { t } = useLanguage();
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `${t('ak.definition')} : ${label}` : t('ak.definition')}
          className="pointer-events-auto inline-flex h-4 w-4 items-center justify-center rounded-full cursor-help focus-visible:outline focus-visible:outline-2"
          style={{ color: KIT.T3 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[260px] border-0 text-[12px] leading-snug"
        style={{ background: 'var(--sf-111113)', color: KIT.T1, boxShadow: '0 10px 30px -12px rgb(0 0 0/.6)', border: `1px solid ${KIT.BORDER}` }}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * « Connu pour 11 560 contacts sur 13 930 » : toute donnée partielle (âge,
 * sexe, ville, visites consenties) dit sur combien de personnes elle repose.
 */
export function CoverageNote({ known, total, unit }: { known: number; total: number; unit?: string }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  if (total <= 0) return null;
  const text = known >= total
    ? t('ak.coverageAll').replace('{total}', n(total)).replace('{unit}', unit ?? t('ak.people'))
    : t('ak.coverage').replace('{known}', n(known)).replace('{total}', n(total)).replace('{unit}', unit ?? t('ak.people'));
  return (
    <p className="inline-flex items-center gap-1.5" style={{ color: KIT.T3, fontSize: 11 }}>
      <Info className="h-3 w-3 flex-none" aria-hidden />
      {text}
    </p>
  );
}

/** Jauge fine de remplissage, rouge une fois pleine. */
export function FillBar({ pct, soldOut = false, height = 4 }: { pct: number | null; soldOut?: boolean; height?: number }) {
  const value = soldOut ? 100 : pct ?? 0;
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: KIT.TRACK }} aria-hidden>
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${value}%`, background: soldOut || value >= 100 ? KIT.RED : 'rgb(var(--ink)/0.72)' }}
      />
    </div>
  );
}

/**
 * Vue en cours de chargement, sous la navigation de l'Analytics : la page
 * reste en place (familles, vues) et seule la zone de la vue attend.
 */
export function AnalyticsLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-2xl animate-pulse" style={{ background: KIT.TRACK }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[180px] rounded-2xl animate-pulse" style={{ background: KIT.TRACK }} />
      ))}
    </div>
  );
}
