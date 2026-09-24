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
      />
      <HypeBaselineForm open={open} initial={baseline} saving={saving} onClose={() => setOpen(false)} onSubmit={handleSave} />
    </>
  );
}
