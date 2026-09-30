/**
 * Le Hype Score d'une soirée à venir, rangé dans son Rapport de soirée
 * (Analytics › Ventes › Par soirée) depuis que la page Hype Score a rejoint
 * Analytics (plan Shotgun, lot E). La calibration (« baseline ») reste
 * accessible d'ici : c'est elle qui rend la prévision juste.
 */
import { useState } from 'react';
import { HypeScoreSection } from '@/components/hype/HypeScoreSection';
import { HypeBaselineForm } from '@/components/hype/HypeBaselineForm';
import { useHypeBaseline, isBaselineConfigured } from '@/hooks/useHypeBaseline';
import { useHypeScore } from '@/hooks/useHypeScore';
import { useLanguage } from '@/contexts/LanguageContext';

export function HypeEventForecast({ venueId, eventId }: { venueId: string; eventId: string }) {
  const { baseline, saving, save } = useHypeBaseline(venueId);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);

  const handleSave = async (values: Parameters<typeof save>[0]) => {
    const ok = await save(values);
    if (ok) setVersion((v) => v + 1);
    return ok;
  };

  return (
    <>
      <HypeScoreSection
        venueId={venueId}
        eventId={eventId}
        baselineSet={isBaselineConfigured(baseline)}
        onEditBaseline={() => setOpen(true)}
        baselineVersion={version}
        compact
      />
      <HypeBaselineForm open={open} initial={baseline} saving={saving} onClose={() => setOpen(false)} onSubmit={handleSave} />
    </>
  );
}

/**
 * La prévision en UNE ligne, posée sous les jauges du Rapport de soirée
 * (plan de simplification, lot 4) : « ≈ 119 entrées (18 % de la salle), en
 * retard sur le rythme habituel ». Le score sur 10, ses cinq sous-scores et
 * l'explication du calcul restent dans le détail replié.
 */
export function HypeProjectionLine({ venueId, eventId }: { venueId: string; eventId: string }) {
  const { t, language } = useLanguage();
  const { hypeData } = useHypeScore(venueId, eventId);
  const f = hypeData?.forecast;
  if (!f || f.projectedAttendance <= 0) return null;
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(f.projectedAttendance));
  const pct = f.pctCapacity != null
    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.min(1, f.pctCapacity / 100))
    : null;
  const text = (pct ? t('er.proj.withCap').replace('{pct}', pct) : t('er.proj.noCap'))
    .replace('{n}', n)
    .replace('{pace}', t(`er.proj.pace.${f.paceStatus}`));
  return (
    <p className="border-l-2 pl-3 text-[12.5px]" style={{ borderColor: 'var(--acc-f59e0b)', color: 'rgb(var(--ink)/var(--ink-a58,0.58))' }}>
      {text}{f.confidence === 'low' ? ` ${t('er.proj.lowConfidence')}` : ''}
    </p>
  );
}
