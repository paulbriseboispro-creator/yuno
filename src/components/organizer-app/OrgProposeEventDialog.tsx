import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizerPartnerships } from '@/hooks/useOrganizerPartnerships';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr } from 'date-fns/locale';
import { Send, Building2, Users, Sparkles, Clock, Image as ImageIcon, Loader2 } from 'lucide-react';
import {
  OrgButton, DarkSelect, FieldLabel,
  T1, T2, T3, RED, BORDER, INNER_BG,
} from '@/components/org-ui';

type CollabMode = 'co_event' | 'venue_rental' | 'org_hosted';

interface ProposableEvent {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pre-select a partner club (when launched from a partnership card). */
  preselectedVenueId?: string | null;
  onCreated?: () => void;
}

const dialogStyle = { background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 } as const;

/**
 * Org-side mirror of ClubProposeEventDialog: lets an organizer propose one of its
 * own upcoming nights to an active partner CLUB. Linking sets
 * `partner_venue_id = club` + `event_mode`, then opens a PENDING collaboration
 * contract (create_event_collab_contract pre-signs the proposing org). The club
 * must accept (sign) before the co-event can sell — sales stay blocked by the
 * CONTRACT GUARD until then. Publish state is left untouched.
 */
export function OrgProposeEventDialog({ open, onOpenChange, preselectedVenueId, onCreated }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
  const navigate = useNavigate();
  const { partnerships } = useOrganizerPartnerships();
  const activePartners = partnerships.filter((p) => p.status === 'active');

  const [venueId, setVenueId] = useState<string>(preselectedVenueId || '');
  const [mode, setMode] = useState<CollabMode>('co_event');
  const [eventId, setEventId] = useState<string>('');
  const [options, setOptions] = useState<ProposableEvent[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);

  // Keep the pre-selected partner in sync when (re)opening from a card.
  useEffect(() => {
    if (open) setVenueId(preselectedVenueId || '');
  }, [open, preselectedVenueId]);

  // Load the organizer's upcoming nights not yet linked to a partner club —
  // published OR draft. Co-events already carry a partner so they're excluded.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoadingOptions(true);
    setEventId('');
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('id, title, description, poster_url, start_at, end_at, is_active')
        .eq('organizer_user_id', user.id)
        .is('partner_venue_id', null)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true });
      if (cancelled) return;
      setOptions((data || []) as ProposableEvent[]);
      setLoadingOptions(false);
    })();
    return () => { cancelled = true; };
  }, [open, user]);

  const selectedEvent = options.find((d) => d.id === eventId) || null;
  const hasOptions = options.length > 0;

  const reset = () => {
    setVenueId(preselectedVenueId || '');
    setMode('co_event');
    setEventId('');
  };

  const goCreateDraft = () => {
    onOpenChange(false);
    navigate('/organizer-app/events');
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!venueId) { toast.error(t('Choisis un club partenaire.', 'Choose a partner club.', 'Elige un club asociado.')); return; }
    if (!eventId) { toast.error(t('Choisis une soirée.', 'Choose an event.', 'Elige un evento.')); return; }

    setSaving(true);
    try {
      // 1. Link the chosen night to the partner club. Publish state stays as-is.
      const { error } = await supabase
        .from('events')
        .update({ partner_venue_id: venueId, event_mode: mode })
        .eq('id', eventId)
        .eq('organizer_user_id', user.id);
      if (error) throw error;

      // 2. Open a PENDING collaboration contract. create_event_collab_contract
      // pre-signs whichever side calls it — here the proposing organizer — and
      // leaves the contract in 'pending_signatures'. The club must accept (sign)
      // before the co-event can sell. Called bound on `supabase` (never detach
      // .rpc — see rpc-unbound gotcha). Split defaults to the partnership terms.
      const { error: contractErr } = await supabase.rpc(
        'create_event_collab_contract' as never,
        { p_event_id: eventId, p_cancellation_policy: 'pro_rata_refund' } as never,
      );
      if (contractErr) {
        // Roll back the link so we never leave a half-formed co-event with no
        // contract (which would render as a misleading "active" partnership).
        await supabase.from('events')
          .update({ partner_venue_id: null, event_mode: null })
          .eq('id', eventId).eq('organizer_user_id', user.id);
        throw contractErr;
      }

      // 3. Tell the club a proposal awaits review (email + web push). Best-effort.
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: eventId, action: 'proposed', proposer_side: 'organizer' },
        });
      } catch (e) { console.warn('Propose notify failed:', e); }

      toast.success(
        t('Proposition envoyée', 'Proposal sent', 'Propuesta enviada'),
        { description: t('Le club doit accepter pour ouvrir les ventes.', 'The club must accept to open sales.', 'El club debe aceptar para abrir las ventas.') },
      );
      onCreated?.();
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      console.error('Propose event error:', err);
      toast.error((err as { message?: string }).message || t('Impossible de proposer la soirée.', 'Could not propose the event.', 'No se pudo proponer el evento.'));
    } finally {
      setSaving(false);
    }
  };

  const MODES: { value: CollabMode; icon: typeof Sparkles; title: string; desc: string }[] = [
    {
      value: 'co_event', icon: Sparkles,
      title: t('Co-soirée', 'Co-event', 'Coevento'),
      desc: t('Vous co-organisez : revenus partagés selon le contrat.', 'You co-host: revenue shared per the contract.', 'Coorganizáis: ingresos compartidos según el contrato.'),
    },
    {
      value: 'venue_rental', icon: Building2,
      title: t('Location de salle', 'Venue rental', 'Alquiler de sala'),
      desc: t('Tu loues le lieu du club pour ta soirée.', 'You rent the club venue for your event.', 'Alquilas el local del club para tu evento.'),
    },
    {
      value: 'org_hosted', icon: Users,
      title: t('Soirée hébergée', 'Org-hosted', 'Evento alojado'),
      desc: t('Tu portes la soirée, le club héberge.', 'You run the night, the club hosts.', 'Tú llevas la noche, el club aloja.'),
    },
  ];

  const StatusBadge = ({ live }: { live: boolean }) => (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={live
        ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: '#34D399' }
        : { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }}>
      {live ? t('En ligne', 'Live', 'En vivo') : t('Brouillon', 'Draft', 'Borrador')}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 p-0" style={{ ...dialogStyle, maxWidth: 512 }}>
        <div className="max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
              <Send className="h-5 w-5" style={{ color: RED }} />
              {t('Proposer une soirée à un club', 'Propose an event to a club', 'Proponer un evento a un club')}
            </DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>
              {t(
                'Propose une de tes soirées à un club partenaire. Le club devra accepter et signer le contrat avant l’ouverture des ventes.',
                'Propose one of your events to a partner club. The club must accept and sign the contract before sales open.',
                'Propón uno de tus eventos a un club asociado. El club deberá aceptar y firmar el contrato antes de abrir las ventas.',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Partner club selection */}
            <div>
              <FieldLabel>{t('Club partenaire', 'Partner club', 'Club asociado')}</FieldLabel>
              {activePartners.length === 0 ? (
                <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 12 }}>
                  {t(
                    'Aucun club partenaire actif. Demande un partenariat depuis « Clubs partenaires ».',
                    'No active partner club. Request a partnership from “Partner clubs”.',
                    'No hay club asociado activo. Solicita un partenariado desde “Clubes asociados”.',
                  )}
                </div>
              ) : (
                <DarkSelect value={venueId} onChange={setVenueId} placeholder={t('Choisir un club…', 'Choose a club…', 'Elegir un club…')}>
                  {activePartners.map((p) => (
                    <option key={p.venue_id} value={p.venue_id} style={{ background: '#0a0a0c' }}>
                      {p.venue?.name ?? t('Club', 'Club', 'Club')}
                    </option>
                  ))}
                </DarkSelect>
              )}
            </div>

            {/* Event selection */}
            <div>
              <FieldLabel>{t('Soirée à proposer', 'Event to propose', 'Evento a proponer')}</FieldLabel>
              {loadingOptions ? (
                <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 12 }}>
                  {t('Chargement…', 'Loading…', 'Cargando…')}
                </div>
              ) : !hasOptions ? (
                <div className="space-y-2.5 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <p style={{ color: T3, fontSize: 12 }}>{t('Aucune soirée disponible à proposer.', 'No event available to propose.', 'No hay eventos disponibles para proponer.')}</p>
                  <OrgButton size="sm" variant="secondary" onClick={goCreateDraft}>
                    <Sparkles className="h-4 w-4" /> {t('Créer une soirée', 'Create an event', 'Crear un evento')}
                  </OrgButton>
                </div>
              ) : (
                <>
                  <DarkSelect value={eventId} onChange={setEventId} placeholder={t('Choisir une soirée…', 'Choose an event…', 'Elegir un evento…')}>
                    {options.map((d) => (
                      <option key={d.id} value={d.id} style={{ background: '#0a0a0c' }}>
                        {(d.title || t('Sans titre', 'Untitled', 'Sin título'))} · {formatInTimeZone(new Date(d.start_at), PARIS_TIMEZONE, 'dd MMM', { locale: fr })}
                      </option>
                    ))}
                  </DarkSelect>
                  <button type="button" onClick={goCreateDraft} className="mt-2 underline-offset-2 hover:underline" style={{ color: T3, fontSize: 11.5 }}>
                    {t('ou créer une nouvelle soirée', 'or create a new event', 'o crear un nuevo evento')}
                  </button>
                </>
              )}
            </div>

            {/* Preview — what the club will see */}
            {selectedEvent && (
              <div className="flex gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                {selectedEvent.poster_url ? (
                  <img src={selectedEvent.poster_url} alt="" className="h-20 w-16 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
                ) : (
                  <div className="flex h-20 w-16 flex-none items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <ImageIcon className="h-5 w-5" style={{ color: T3 }} />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <StatusBadge live={selectedEvent.is_active} />
                  <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{selectedEvent.title || t('Sans titre', 'Untitled', 'Sin título')}</p>
                  <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
                    <Clock className="h-3 w-3 flex-none" />
                    {formatInTimeZone(new Date(selectedEvent.start_at), PARIS_TIMEZONE, 'dd MMM · HH:mm', { locale: fr })}
                  </p>
                  {selectedEvent.description && (
                    <p className="line-clamp-2" style={{ color: T2, fontSize: 11.5 }}>{selectedEvent.description}</p>
                  )}
                </div>
              </div>
            )}

            {/* Collaboration mode */}
            <div>
              <FieldLabel>{t('Type de collaboration', 'Collaboration type', 'Tipo de colaboración')}</FieldLabel>
              <div className="space-y-2">
                {MODES.map(({ value, icon: Icon, title, desc }) => {
                  const active = mode === value;
                  return (
                    <button key={value} type="button" onClick={() => setMode(value)}
                      className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition-all duration-150"
                      style={{
                        background: active ? 'rgba(232,25,44,0.06)' : INNER_BG,
                        border: `1px solid ${active ? 'rgba(232,25,44,0.35)' : BORDER}`,
                      }}>
                      <Icon className="mt-0.5 h-4 w-4 flex-none" style={{ color: active ? RED : T3 }} />
                      <div className="min-w-0">
                        <div style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{title}</div>
                        <div style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl p-3" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.2)', color: T3, fontSize: 11.5 }}>
              {t(
                'Le club recevra la proposition dans son espace Collaborations et devra signer le contrat.',
                'The club will receive the proposal in its Collaborations space and will need to sign the contract.',
                'El club recibirá la propuesta en su espacio de Colaboraciones y deberá firmar el contrato.',
              )}
            </div>
          </div>

          <DialogFooter className="mt-5 gap-2">
            <OrgButton variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('Annuler', 'Cancel', 'Cancelar')}
            </OrgButton>
            <OrgButton variant="primary" onClick={handleSubmit} disabled={saving || !venueId || !eventId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? t('Envoi…', 'Sending…', 'Enviando…') : t('Envoyer la proposition', 'Send proposal', 'Enviar propuesta')}
            </OrgButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
