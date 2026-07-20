import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { PenLine, Repeat, Loader2 } from 'lucide-react';
import { CollabContractTermsDialog } from '@/components/CollabContractTermsDialog';
import { useEventCollabContract } from '@/hooks/useEventCollabContract';
import { loadCollabSeriesContractPdfData } from '@/lib/collabContractData';
import { COLLAB_TERMS_VERSION } from '@/lib/collabContractTerms';
import type { CollabContractPDFData } from '@/lib/generateContractPDF';
import type { EventCollabSeriesContractRow } from '@/hooks/useEventCollabSeriesContract';
import { OrgCard, OrgButton, RED, T1, T3 } from '@/components/org-ui';

// 0 = dimanche — aligné sur EXTRACT(DOW) Postgres et getDay() JS.
const WEEKDAYS = {
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'],
  es: ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'],
};

interface Props {
  eventId: string;
  /** Côté qui consulte : 'venue' sur le dashboard club, 'organizer' côté orga. */
  side: 'venue' | 'organizer';
  /** Titre de la soirée — repli quand le template n'est pas lisible (RLS). */
  eventTitle?: string;
  /** Rechargement de la page parente après signature. */
  onSigned?: () => void;
}

/**
 * Bouton de signature en BAS de la page détail d'une co-soirée.
 *
 * La page ouvre déjà sur SplitContractBanner, mais elle est longue : quand on a
 * fini de lire les détails, on ne doit pas avoir à remonter pour signer. « Examiner »
 * mène ici, on lit, on signe au même endroit.
 *
 * Deux contrats possibles, et l'ordre compte :
 *  1. CONTRAT-CADRE en attente sur la série → c'est LUI qu'on signe. Une signature
 *     engage toutes les dates, et son balayage active au passage l'occurrence
 *     courante. Proposer la signature par-soirée ici ferait signer deux fois la
 *     même chose.
 *  2. Sinon, le contrat de CETTE soirée, s'il attend ma signature.
 *
 * Ne rend rien quand il n'y a rien à signer.
 */
export function CollabSignFooter({ eventId, side, eventTitle, onSigned }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const lang = language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr';

  const { isMyTurn, contract, sign } = useEventCollabContract(eventId, side);

  const [seriesRow, setSeriesRow] = useState<EventCollabSeriesContractRow | null>(null);
  const [seriesLabel, setSeriesLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [pdfData, setPdfData] = useState<CollabContractPDFData | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadSeries = useCallback(async () => {
    if (!user) { setSeriesRow(null); return; }
    const { data: ev } = await supabase
      .from('events').select('recurring_template_id, title').eq('id', eventId).maybeSingle();
    const templateId = (ev as { recurring_template_id?: string | null } | null)?.recurring_template_id;
    if (!templateId) { setSeriesRow(null); return; }

    const { data: rows } = await supabase
      .from('event_collab_series_contracts' as never)
      .select('*')
      .eq('template_id' as never, templateId as never)
      .eq('status' as never, 'pending_signatures' as never);
    const mine = ((rows as unknown as EventCollabSeriesContractRow[]) || []).find((s) =>
      side === 'organizer' ? !s.org_signed_at : !s.venue_signed_at);
    if (!mine) { setSeriesRow(null); return; }

    // Le template peut être illisible côté partenaire selon la RLS : on retombe
    // alors sur le titre de la soirée plutôt que d'afficher un cadre anonyme.
    const { data: tpl } = await supabase
      .from('owner_recurring_templates')
      .select('name, day_of_week, start_time')
      .eq('id', templateId)
      .maybeSingle();
    const tp = tpl as { name?: string; day_of_week?: number; start_time?: string } | null;
    const name = tp?.name
      || (ev as { title?: string } | null)?.title
      || eventTitle
      || t('Soirée récurrente', 'Recurring event', 'Evento recurrente');
    if (tp && typeof tp.day_of_week === 'number') {
      const day = WEEKDAYS[lang][tp.day_of_week] ?? '';
      const prefix = lang === 'en' ? 'Every ' : lang === 'es' ? 'Todos los ' : 'Tous les ';
      const w = lang === 'fr' ? `${day}s` : day;
      setSeriesLabel(`${name} · ${prefix}${w} · ${(tp.start_time || '').slice(0, 5)}`);
    } else {
      setSeriesLabel(name);
    }
    setSeriesRow(mine);
  }, [user, eventId, side, eventTitle, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSeries(); }, [loadSeries]);

  const isSeries = !!seriesRow;
  if (!isSeries && !isMyTurn) return null;
  if (!isSeries && !contract) return null;

  const openDialog = async () => {
    setOpen(true);
    if (!seriesRow) return; // le contrat par-soirée est rendu depuis `contract`
    setPdfData(null);
    try {
      setPdfData(await loadCollabSeriesContractPdfData(seriesRow, seriesLabel, lang));
    } catch (e) {
      toast.error((e as { message?: string }).message || t('Erreur', 'Error', 'Error'));
      setOpen(false);
    }
  };

  const confirmSeries = async () => {
    if (!seriesRow) return;
    setConfirming(true);
    try {
      const { error } = await supabase.rpc('sign_event_collab_series_contract' as never, {
        p_contract_id: seriesRow.id,
        p_ip: null,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
        p_terms_version: COLLAB_TERMS_VERSION,
      } as never);
      if (error) throw error;
      toast.success(t(
        'Contrat-cadre signé — toutes les soirées de la série sont validées',
        'Framework contract signed — every event in the series is approved',
        'Contrato marco firmado — todos los eventos de la serie están aprobados',
      ));
      setOpen(false);
      setSeriesRow(null);
      onSigned?.();
    } catch (e) {
      toast.error((e as { message?: string }).message || t('Erreur', 'Error', 'Error'));
    } finally { setConfirming(false); }
  };

  return (
    <>
      <OrgCard>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {isSeries
              ? <Repeat className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />
              : <PenLine className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />}
            <div>
              <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
                {isSeries
                  ? t('Prêt à signer la série ?', 'Ready to sign the series?', '¿Listo para firmar la serie?')
                  : t('Prêt à signer ?', 'Ready to sign?', '¿Listo para firmar?')}
              </p>
              <p className="mt-1" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>
                {isSeries
                  ? t(
                      'Une seule signature engage toutes les dates de la série, celle-ci comprise. Les ventes s\'ouvrent et les prochaines soirées sont acceptées automatiquement.',
                      'A single signature commits you to every date in the series, including this one. Sales open and future events are auto-accepted.',
                      'Una sola firma te compromete con todas las fechas de la serie, incluida esta. Las ventas se abren y los próximos eventos se aceptan automáticamente.',
                    )
                  : t(
                      'Tu as vu les détails. Signe le contrat pour ouvrir les ventes de cette soirée.',
                      'You have seen the details. Sign the agreement to open sales for this event.',
                      'Ya viste los detalles. Firma el contrato para abrir las ventas de este evento.',
                    )}
              </p>
            </div>
          </div>
          <div className="flex-none">
            <OrgButton size="sm" variant="primary" onClick={openDialog} disabled={confirming || sign.isPending}>
              {(confirming || sign.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              {isSeries
                ? t('Lire et signer le contrat-cadre', 'Read and sign the framework contract', 'Leer y firmar el contrato marco')
                : t('Lire et signer le contrat', 'Read and sign the agreement', 'Leer y firmar el contrato')}
            </OrgButton>
          </div>
        </div>
      </OrgCard>

      {open && (
        isSeries ? (
          <CollabContractTermsDialog
            open={open}
            onOpenChange={(o) => { if (!o) setOpen(false); }}
            pdfData={pdfData ?? undefined}
            language={lang}
            title={{ fr: 'Lis et signe le contrat-cadre', en: 'Read and sign the framework contract', es: 'Lee y firma el contrato marco' }}
            onConfirm={confirmSeries}
            confirming={confirming}
          />
        ) : (
          <CollabContractTermsDialog
            open={open}
            onOpenChange={(o) => { if (!o) setOpen(false); }}
            contract={contract}
            onConfirm={() => sign.mutate(undefined, { onSuccess: () => { setOpen(false); onSigned?.(); } })}
            confirming={sign.isPending}
          />
        )
      )}
    </>
  );
}
