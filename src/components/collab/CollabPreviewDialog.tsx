import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Eye, Palette, Settings2, CalendarClock, MapPin, Lock } from 'lucide-react';
import type { CollabDomain } from '@/utils/collabResponsibilities';
import { CollabDesignPreview } from './CollabDesignPreview';
import { CollabOperationsPreview } from './CollabOperationsPreview';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const RED = '#E8192C';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

/**
 * Dialogue d'APERÇU d'un volet (design ou opérationnel) pour la partie qui ne le
 * tient PAS. « Ouvrir l'outil, mais en lecture seule » : on ne rend jamais un
 * éditeur désactivé (risqué, plein d'inputs à neutraliser), on rend une vue
 * dédiée qui montre exactement ce que le public voit — la même philosophie que
 * CollabOperationsPreview, étendue au design et rendue symétrique club ↔ orga.
 *
 * Le serveur refuse de toute façon toute écriture d'un non-détenteur
 * (protect_event_columns_from_partner, can_manage_event_tables) : cet aperçu est
 * sûr par construction, il ne fait que lire.
 */
export function CollabPreviewDialog({
  eventId,
  domain,
  onClose,
  partnerLabel,
}: {
  eventId: string;
  /** Volet à prévisualiser ; null = fermé. */
  domain: CollabDomain | null;
  onClose: () => void;
  /** Nom de la partie qui tient le volet (« le club » / l'organisateur), pour le pied. */
  partnerLabel?: string;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const isDesign = domain === 'design';
  const Icon = isDesign ? Palette : Settings2;

  const title = isDesign
    ? tt('Aperçu du design', 'Design preview', 'Vista previa del diseño')
    : tt("Aperçu de l'opérationnel", 'Operations preview', 'Vista previa de lo operativo');
  const subtitle = isDesign
    ? tt(
        'Affiche, titre, genres et line-up de la soirée.',
        'The event poster, title, genres and line-up.',
        'El cartel, título, géneros y line-up de la noche.',
      )
    : tt(
        'Billetterie, tables VIP et horaires de la soirée.',
        'Ticketing, VIP tables and schedule of the event.',
        'Entradas, mesas VIP y horarios de la noche.',
      );

  const holder = partnerLabel || tt('le partenaire', 'the partner', 'el socio');

  return (
    <Dialog open={domain !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="border-0 p-0 overflow-hidden max-h-[88vh] overflow-y-auto"
        style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 560 }}
      >
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
            <Icon className="h-4 w-4" style={{ color: RED }} /> {title}
          </DialogTitle>
          <DialogDescription style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-5">
          {/* Bandeau lecture seule — montré une seule fois pour tout le dialogue */}
          <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 11 }}>
            <Eye className="h-3.5 w-3.5" style={{ color: T3 }} />
            {tt('Lecture seule — tu ne tiens pas ce volet.', "Read only — you don't hold this side.", 'Solo lectura — no llevas esta parte.')}
          </div>

          {domain === 'design' && <CollabDesignPreview eventId={eventId} showChrome={false} />}

          {domain === 'operations' && (
            <div className="space-y-5">
              <ScheduleLocationPreview eventId={eventId} />
              <CollabOperationsPreview
                eventId={eventId}
                kind="ticketing"
                showChrome={false}
                heading={tt('Billetterie', 'Ticketing', 'Entradas')}
              />
              <CollabOperationsPreview
                eventId={eventId}
                kind="tables"
                showChrome={false}
                heading={tt('Tables VIP', 'VIP tables', 'Mesas VIP')}
              />
            </div>
          )}

          {/* Pied — pousse vers l'avenant, jamais vers un message manuel */}
          <p className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.18)', color: T2, fontSize: 11.5, lineHeight: 1.5 }}>
            {tt(
              `C'est ce que voit le public. Ce volet est tenu par ${holder} — pour le modifier, propose un avenant.`,
              `This is what the public sees. This side is held by ${holder} — to change it, propose an amendment.`,
              `Esto es lo que ve el público. Esta parte la lleva ${holder} — para cambiarla, propón una adenda.`,
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Horaires + lieu (volet operations) — lecture seule, auto-chargé ─────────── */
type SchedRow = {
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  location_city: string | null;
  location_address: string | null;
  location_is_secret: boolean | null;
};

function ScheduleLocationPreview({ eventId }: { eventId: string }) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [row, setRow] = useState<SchedRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('events')
        .select('start_at, end_at, location_name, location_city, location_address, location_is_secret')
        .eq('id', eventId)
        .maybeSingle();
      if (!active) return;
      setRow((data as SchedRow | null) ?? null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]);

  if (loading || !row) return null;

  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US';
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  const place = row.location_is_secret
    ? tt('Lieu secret', 'Secret location', 'Lugar secreto')
    : [row.location_name, row.location_city].filter(Boolean).join(' · ') || null;

  return (
    <div className="space-y-1.5">
      <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {tt('Horaires & lieu', 'Schedule & venue', 'Horario y lugar')}
      </p>
      <div className="rounded-xl px-3 py-2.5 space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2" style={{ color: T1, fontSize: 12.5 }}>
          <CalendarClock className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
          <span className="capitalize">{fmt(row.start_at)} → {fmt(row.end_at)}</span>
        </div>
        {place && (
          <div className="flex items-center gap-2" style={{ color: T1, fontSize: 12.5 }}>
            {row.location_is_secret ? <Lock className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} /> : <MapPin className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />}
            <span>{place}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default CollabPreviewDialog;
