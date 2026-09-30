import { useEffect, useState } from 'react';
import { Bell, Send, Loader2, Clock, Users, Zap, Sparkles, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import PushCreditsCard from '@/components/push/PushCreditsCard';
import { usePushCredits } from '@/hooks/usePushCenter';
import { toast } from 'sonner';

// ─── Yuno Design Tokens (pro dashboard) — alignés sur OwnerPush ───────────────
const RED = '#E8192C';
const POS = 'var(--acc-34d399)';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const C_FAINT = 'rgb(var(--ink)/0.06)';
const BORDER = 'rgb(var(--ink)/0.085)';
const F_BORDER = 'rgb(var(--ink)/0.055)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const TILE_BG = 'rgb(var(--ink)/0.025)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', color: T3, fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

type Campaign = {
  id: string;
  title: string;
  body: string;
  sent_count: number;
  template_key?: string | null;
  source?: string | null;
  created_at: string;
};

/**
 * Notifications RP. L'annonce des soirées des clubs sous contrat part toute
 * seule : le moteur de notifications Yuno la range dans l'annonce de la soirée
 * (raison « abonné de l'agence », une notification par personne). Ici : les
 * campagnes MANUELLES vers les abonnés de l'agence, 1 crédit chacune
 * (send-push-campaign, scope followers).
 */
export default function AgencyPush() {
  const { agency, loading: agencyLoading } = useAgency();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  const agencyId = agency?.id ?? null;

  const [rpSlug, setRpSlug] = useState<string | null>(null);
  const { credits, loading: creditsLoading, reload: reloadCredits } = usePushCredits({ agencyId });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  // Règles Yuno des push manuels : heures calmes 22 h → 10 h, et les abonnés
  // déjà notifiés aujourd'hui (tous expéditeurs) sont protégés.
  const [quietHours, setQuietHours] = useState(false);
  const [heldBack, setHeldBack] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clicks, setClicks] = useState<Record<string, number>>({});
  const [historyLoading, setHistoryLoading] = useState(true);

  // Slug public de l'RP (bras affilié) → URL par défaut de la notif.
  useEffect(() => {
    if (!agencyId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('affiliates').select('linktree_slug').eq('agency_id', agencyId).maybeSingle()
      .then(({ data }: { data: { linktree_slug: string | null } | null }) => {
        const s = data?.linktree_slug || null;
        setRpSlug(s);
        setUrl(s ? `/rp/${s}` : '/');
      });
  }, [agencyId]);

  const fetchHistory = async () => {
    if (!agencyId) return;
    const { data } = await supabase
      .from('push_campaigns' as never)
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(20);
    const rows = ((data as unknown) as Campaign[]) || [];
    setCampaigns(rows);
    setHistoryLoading(false);
    if (rows.length > 0) {
      const { data: ev } = await supabase
        .from('push_campaign_events' as never)
        .select('campaign_id')
        .eq('event_type', 'clicked')
        .in('campaign_id', rows.map(r => r.id));
      const counts: Record<string, number> = {};
      (((ev as unknown) as Array<{ campaign_id: string }>) || []).forEach(e => {
        counts[e.campaign_id] = (counts[e.campaign_id] || 0) + 1;
      });
      setClicks(counts);
    }
  };
  useEffect(() => { fetchHistory(); }, [agencyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Portée estimée (dry_run débouncé).
  useEffect(() => {
    if (!agencyId) return;
    setReachLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke('send-push-campaign', {
          body: { title: '·', body: '·', dry_run: true, agency_id: agencyId, scope: 'followers' },
        });
        setReach(typeof data?.targeted === 'number' ? data.targeted : null);
        setQuietHours(!!data?.quiet_hours);
        setHeldBack(typeof data?.held_back === 'number' ? data.held_back : 0);
      } catch {
        setReach(null);
      } finally {
        setReachLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [agencyId]);

  const handleSend = async () => {
    if (!agencyId || !title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-push-campaign', {
        body: {
          title: title.trim(), body: body.trim(), url: url.trim() || '/',
          agency_id: agencyId, scope: 'followers', template_key: 'agency_custom',
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const errAny = error as { context?: { json?: () => Promise<{ error?: string }> } };
          if (errAny.context?.json) {
            const bodyJson = await errAny.context.json();
            if (bodyJson?.error === 'campaign_rate_limited') {
              toast.error(t('Une campagne par 24 h : réessaie demain.', 'One campaign per 24h: try again tomorrow.', 'Una campaña cada 24 h: inténtalo mañana.'));
              return;
            }
            if (bodyJson?.error === 'no_credits') {
              toast.error(t('Plus de crédits ce mois-ci. Demande-en à Yuno.', 'No credits left this month. Ask Yuno for more.', 'No te quedan créditos este mes. Pide más a Yuno.'));
              reloadCredits();
              return;
            }
            if (bodyJson?.error === 'quiet_hours') {
              toast.error(t('Heures calmes : rien ne part entre 22 h et 10 h.', 'Quiet hours: nothing goes out between 10 pm and 10 am.', 'Horas de descanso: no se envía nada entre las 22 h y las 10 h.'));
              return;
            }
            if (bodyJson?.error === 'no_eligible_recipients') {
              toast.error(t('Tous tes abonnés ont déjà reçu une notification aujourd\'hui.', 'All your subscribers already got a notification today.', 'Todos tus suscriptores ya recibieron una notificación hoy.'));
              return;
            }
            if (bodyJson?.error) msg = bodyJson.error;
          }
        } catch { /* garder msg */ }
        throw new Error(msg);
      }
      toast.success(t(`Envoyé à ${data?.sent || 0} abonné·es`, `Sent to ${data?.sent || 0} subscribers`, `Enviado a ${data?.sent || 0} suscriptores`));
      setConfirmOpen(false);
      setTitle(''); setBody('');
      fetchHistory();
      reloadCredits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Échec de l\'envoi', 'Send failed', 'Error al enviar'));
    } finally {
      setSending(false);
    }
  };

  if (agencyLoading || !agencyId) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} /></div>;
  }

  const labelForCampaign = (c: Campaign): string | null => {
    if (c.template_key?.startsWith('agency_new_event')) return t('Nouvelle soirée', 'New event', 'Nuevo evento');
    if (c.template_key === 'agency_custom' || !c.template_key) return null;
    return c.template_key;
  };

  return (
    <div className="min-h-screen pb-16" style={{ background: 'transparent' }}>
      <div className="relative z-10 mx-auto max-w-[1100px] px-1 sm:px-2 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
            <Bell className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('Notifications', 'Notifications', 'Notificaciones')}
            </h1>
            <p style={{ color: T3, fontSize: 12.5, marginTop: 3 }}>
              {t('Préviens tes abonnés de tes nouvelles soirées.', 'Alert your subscribers about your new events.', 'Avisa a tus suscriptores de tus nuevos eventos.')}
            </p>
          </div>
        </div>

        {/* ─── Annonces automatiques : tenues par Yuno ─────────────────────── */}
        <div className="flex items-start gap-2.5" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
          <Zap className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} />
          <div>
            <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
              {t('Automatique : Yuno annonce les soirées de tes clubs', 'Automatic: Yuno announces your clubs’ events', 'Automático: Yuno anuncia los eventos de tus clubs')}
            </p>
            <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>
              {t(
                'Quand un club ou un organisateur sous contrat avec ton agence publie une soirée, tes abonnés sont prévenus par Yuno — une seule notification par personne, même s’ils suivent aussi le club, et jamais la nuit.',
                'When a club or organizer under contract with your agency publishes an event, Yuno notifies your subscribers — one notification per person, even if they also follow the club, and never at night.',
                'Cuando un club u organizador con contrato con tu agencia publica un evento, Yuno avisa a tus suscriptores: una sola notificación por persona, aunque también sigan al club, y nunca de noche.',
              )}
            </p>
          </div>
        </div>

        <PushCreditsCard credits={credits} loading={creditsLoading} scope={{ agencyId }} onChanged={reloadCredits} />

        {/* ─── Notification MANUELLE ────────────────────────────────────── */}
        <div className="grid lg:grid-cols-[1fr,320px] gap-6 items-start">
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }} className="space-y-4">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 mt-0.5 flex-none" style={{ color: T2 }} />
              <div>
                <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {t('Notification manuelle', 'Manual notification', 'Notificación manual')}
                </h3>
                <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>
                  {t('Un message ponctuel à tous tes abonnés.', 'A one-off message to all your subscribers.', 'Un mensaje puntual a todos tus suscriptores.')}
                </p>
              </div>
            </div>

            <div>
              <label style={labelStyle}>{t('Titre', 'Title', 'Título')}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} style={inputStyle}
                placeholder={t('Nouvelle soirée ce week-end', 'New event this weekend', 'Nuevo evento este fin de semana')} />
            </div>
            <div>
              <label style={labelStyle}>{t('Message', 'Message', 'Mensaje')}</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={200} rows={3}
                style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                placeholder={t('Réserve ta table avant que ça parte.', 'Book your table before it\'s gone.', 'Reserva tu mesa antes de que se agote.')} />
            </div>
            <div>
              <label style={labelStyle}>{t('Lien à l\'ouverture', 'Link on open', 'Enlace al abrir')}</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} />
              <p style={{ color: T3, fontSize: 11, marginTop: 5 }}>
                {rpSlug
                  ? t(`Par défaut : ta page RP (/rp/${rpSlug}). Colle plutôt le lien d'une soirée si besoin.`, `Default: your RP page (/rp/${rpSlug}). Paste an event link instead if needed.`, `Por defecto: tu página RP (/rp/${rpSlug}). Pega el enlace de un evento si lo necesitas.`)
                  : t('Colle le lien d\'une soirée ou laisse la page d\'accueil.', 'Paste an event link or leave the home page.', 'Pega el enlace de un evento o deja la página de inicio.')}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="flex items-center gap-2 tabular-nums" style={{ color: T2, fontSize: 12.5 }}>
                {reachLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: T3 }} />
                  : <Users className="h-3.5 w-3.5" style={{ color: (reach ?? 0) > 0 ? POS : T3 }} />}
                {t(`${reach ?? '…'} abonné·es joignables`, `${reach ?? '…'} reachable subscribers`, `${reach ?? '…'} suscriptores localizables`)}
              </span>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={sending || !title.trim() || !body.trim() || (reach ?? 0) === 0 || (credits?.remaining ?? 1) <= 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: RED, color: '#fff', padding: '11px 18px', boxShadow: `0 0 18px -6px ${RED}88`,
                  opacity: (sending || !title.trim() || !body.trim() || (reach ?? 0) === 0 || (credits?.remaining ?? 1) <= 0) ? 0.5 : 1,
                }}
              >
                <Send className="h-4 w-4" />
                {t('Envoyer', 'Send', 'Enviar')}
              </button>
            </div>
            {!reachLoading && quietHours && (
              <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>
                {t('Heures calmes : aucune notification ne part entre 22 h et 10 h. Reviens à partir de 10 h.', 'Quiet hours: no notification goes out between 10 pm and 10 am. Come back after 10 am.', 'Horas de descanso: no sale ninguna notificación entre las 22 h y las 10 h. Vuelve a partir de las 10 h.')}
              </p>
            )}
            {!reachLoading && !quietHours && heldBack > 0 && (
              <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                {t(`${heldBack} abonné·es protégé·es par les règles Yuno (déjà notifié·es aujourd'hui, ou notifications marketing coupées).`, `${heldBack} subscribers protected by Yuno's rules (already notified today, or marketing notifications off).`, `${heldBack} suscriptores protegidos por las reglas de Yuno (ya notificados hoy, o notificaciones de marketing desactivadas).`)}
              </p>
            )}
            {!reachLoading && !quietHours && (reach ?? 0) === 0 && heldBack === 0 && (
              <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                {t('Aucun abonné joignable pour l\'instant. Partage ta page /rp pour que le public s\'abonne.', 'No reachable subscribers yet. Share your /rp page so people subscribe.', 'Aún no hay suscriptores localizables. Comparte tu página /rp para que la gente se suscriba.')}
              </p>
            )}
          </div>

          {/* Aperçu notification iOS */}
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
            <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
              {t('Aperçu', 'Preview', 'Vista previa')}
            </h3>
            <div className="rounded-2xl p-3.5" style={{ background: 'rgb(var(--glass-30-30-32)/0.92)', border: '1px solid rgb(var(--ink)/0.10)', backdropFilter: 'blur(20px)' }}>
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[9px] flex-none" style={{ background: 'var(--sf-050505)', border: '1px solid rgb(var(--ink)/0.12)' }}>
                  <span style={{ color: RED, fontWeight: 800, fontSize: 13 }}>Y</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate" style={{ color: 'rgb(var(--ink))', fontSize: 13, fontWeight: 600 }}>
                      {title || t('Titre de ta notif', 'Your notification title', 'Título de tu notificación')}
                    </p>
                    <span style={{ color: 'rgb(var(--ink)/var(--ink-a40,0.4))', fontSize: 11 }}>{t('main.', 'now', 'ahora')}</span>
                  </div>
                  <p style={{ color: 'rgb(var(--ink)/var(--ink-a75,0.75))', fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>
                    {body || t('Ton message apparaîtra ici.', 'Your message will appear here.', 'Tu mensaje aparecerá aquí.')}
                  </p>
                </div>
              </div>
            </div>
            <p style={{ color: T3, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
              {t('1 crédit par campagne, une campagne par 24 h au plus. Tes abonnés déjà notifiés aujourd’hui sont protégés.', '1 credit per campaign, at most one campaign per 24h. Subscribers already notified today are protected.', '1 crédito por campaña, como máximo una campaña cada 24 h. Los suscriptores ya notificados hoy están protegidos.')}
            </p>
          </div>
        </div>

        {/* Historique */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>
            {t('Historique', 'History', 'Historial')}
          </h3>
          {historyLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Calendar className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgb(var(--ink)/0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>{t('Aucune notification envoyée.', 'No notifications sent.', 'Sin notificaciones enviadas.')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {campaigns.map((c) => {
                const label = labelForCampaign(c);
                return (
                  <div key={c.id} className="flex items-start justify-between gap-3 p-3 rounded-xl" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-[560] truncate" style={{ color: T1, fontSize: 13 }}>{c.title}</p>
                      <p className="truncate" style={{ color: T3, fontSize: 12, marginTop: 2 }}>{c.body}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {c.source === 'auto' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 10, fontWeight: 600 }}>
                            <Zap className="h-2.5 w-2.5" />{t('Auto', 'Auto', 'Auto')}
                          </span>
                        )}
                        {label && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full"
                            style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 10, fontWeight: 600 }}>
                            {label}
                          </span>
                        )}
                        <span className="flex items-center gap-1 tabular-nums" style={{ color: T3, fontSize: 10 }}>
                          <Clock className="h-3 w-3" />
                          {new Date(c.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full tabular-nums"
                        style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontWeight: 600 }}>
                        {t(`${c.sent_count} envois`, `${c.sent_count} sent`, `${c.sent_count} enviados`)}
                      </span>
                      <span className="tabular-nums" style={{ color: T3, fontSize: 10 }}>
                        {t(`${clicks[c.id] || 0} clics`, `${clicks[c.id] || 0} clicks`, `${clicks[c.id] || 0} clics`)}
                        {c.sent_count > 0 && <> · CTR {Math.round(((clicks[c.id] || 0) / c.sent_count) * 100)}%</>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Envoyer la notification ?', 'Send the notification?', '¿Enviar la notificación?')}</DialogTitle>
            <DialogDescription>
              {t(`Elle partira à ${reach ?? 0} abonné·es joignables.`, `It will go to ${reach ?? 0} reachable subscribers.`, `Se enviará a ${reach ?? 0} suscriptores localizables.`)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              {t('Envoyer', 'Send', 'Enviar')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
