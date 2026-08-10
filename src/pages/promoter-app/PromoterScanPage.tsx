import { useState, useEffect } from 'react';
import { ScanLine } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import { PromoterScanTab } from '@/components/promoter/PromoterScanTab';
import { PromoEmpty } from '@/components/promoter/promoter-ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function PromoterScanPage() {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, canScan, assignments } = usePromoterData();

  const scanEvents = assignments;
  const [selectedScanEvent, setSelectedScanEvent] = useState<string>('');

  // Auto-détection de la soirée à scanner : l'event en cours (live) d'abord,
  // sinon le prochain à venir. Le promoteur n'a plus à choisir — le sélecteur
  // ne sert qu'à déroger quand plusieurs soirées se chevauchent.
  useEffect(() => {
    if (selectedScanEvent || scanEvents.length === 0) return;
    const now = new Date();
    const live = scanEvents.find(a => a.eventStartAt && new Date(a.eventStartAt) <= now && new Date(a.eventEndAt) >= now);
    const next = [...scanEvents]
      .filter(a => a.eventEndAt && new Date(a.eventEndAt) >= now)
      .sort((a, b) => new Date(a.eventStartAt).getTime() - new Date(b.eventStartAt).getTime())[0];
    const auto = live || next;
    if (auto) setSelectedScanEvent(auto.eventId);
  }, [scanEvents, selectedScanEvent]);

  if (!promoter) return null;

  return (
    <PromoterPage maxWidth={720}>
      <PromoHeading
        title={t('promoterScan.title')}
        subtitle={tt('Scanne les billets et invités qui viennent de toi', 'Scan the tickets and guests that came from you', 'Escanea las entradas e invitados que vienen de ti')}
      />

      {!canScan ? (
        <PromoEmpty
          icon={ScanLine}
          title={t('promoterScan.noEventToScan')}
          description={tt(
            'Le scan n’est pas activé sur ton profil. Demande au club.',
            'Scanning is not enabled on your profile. Ask the club.',
            'El escaneo no está activado en tu perfil. Pregunta al club.',
          )}
        />
      ) : (
        <>
          {/* La soirée est détectée automatiquement (live, sinon la prochaine).
              Le sélecteur n'apparaît que s'il y a plusieurs candidates. */}
          {scanEvents.length > 1 && (
            <Select value={selectedScanEvent} onValueChange={setSelectedScanEvent}>
              <SelectTrigger className="h-10 text-sm bg-white/[0.03] border-white/10">
                <SelectValue placeholder={t('promoter.filterByEvent')} />
              </SelectTrigger>
              <SelectContent>
                {scanEvents.map(a => (
                  <SelectItem key={a.eventId} value={a.eventId}>
                    <span className="block max-w-[min(72vw,18rem)] truncate">{a.eventTitle}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedScanEvent ? (
            <PromoterScanTab
              promoterId={promoter.id}
              eventId={selectedScanEvent}
              eventTitle={scanEvents.find(a => a.eventId === selectedScanEvent)?.eventTitle || ''}
            />
          ) : (
            <PromoEmpty icon={ScanLine} title={t('promoterScan.noEventToScan')} />
          )}
        </>
      )}
    </PromoterPage>
  );
}
