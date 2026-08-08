import { useEffect, useMemo, useState } from 'react';
import { Bell, Send, Loader2, Clock, Users, Zap, Sparkles, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

// ─── Yuno Design Tokens (pro dashboard) — alignés sur OwnerPush ───────────────
const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG = 'rgba(255,255,255,0.025)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

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
 * Notifications RP : push AUTO opt-in (« nouvelle soirée ») + push MANUEL vers
 * les abonnés de l'agence. Même socle que /owner/push mais scopé agency_id, cible
 * unique = abonnés (agency_followers), envoi via send-push-campaign.
 */
export default function AgencyPush() {
  const { agency, loading: agencyLoading } = useAgency();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  const agencyId = agency?.id ?? null;

  const [rpSlug, setRpSlug] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
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

  // État du toggle auto (opt-in, éteint par défaut).
  useEffect(() => {
    if (!agencyId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('agency_push_automations')
      .select('enabled').eq('agency_id', agencyId).eq('automation_key', 'new_event').maybeSingle()
      .then(({ data }: { data: { enabled: boolean } | null }) => setAutoEnabled(!!data?.enabled));
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

  const toggleAuto = async () => {
    if (!agencyId || togglingAuto) return;
    setTogglingAuto(true);
    const next = !autoEnabled;
    setAutoEnabled(next);
    try {
      const { error } = await supabase
        .from('agency_push_automations' as never)
        .upsert(
          { agency_id: agencyId, automation_key: 'new_event', enabled: next, updated_at: new Date().toISOString() } as never,
          { onConflict: 'agency_id,automation_key' },
        );
      if (error) throw error;
      toast.success(next
        ? t('Push automatique activé', 'Auto push enabled', 'Push automático activado')
        : t('Push automatique désactivé', 'Auto push disabled', 'Push automático desactivado'));
    } catch {
      setAutoEnabled(!next);
      toast.error(t('Erreur, réessaie', 'Error, try again', 'Error, inténtalo de nuevo'));
    } finally {
      setTogglingAuto(false);
    }
  };

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
              toast.error(t('Limite de 4 envois / 24 h atteinte', 'Limit of 4 sends / 24h reached', 'Límite de 4 envíos / 24 h alcanzado'));
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Échec de l\'envoi', 'Send failed', 'Error al enviar'));
    } finally {
      setSending(false);
    }
  };

  const autoPreview = useMemo(() => ({
    title: t('📅 ' + (agency?.name || 'Ton agence') + ' présente', '📅 ' + (agency?.name || 'Your agency') + ' presents', '📅 ' + (agency?.name || 'Tu agencia') + ' presenta'),
    body: t('Nouvelle soirée — réserve ta place dès maintenant.', 'New event — book your spot now.', 'Nuevo evento — reserva tu lugar ahora.'),
  }), [agency?.name, language]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* ─── Notification AUTOMATIQUE ─────────────────────────────────── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
          <div className="flex items-start gap-2.5 mb-1">
            <Zap className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} />
            <div>
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {t('Notification automatique', 'Automatic notification', 'Notificación automática')}
              </h3>
              <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>
                {t('Active-la une fois, Yuno préviendra tes abonnés au bon moment.', 'Enable it once, Yuno alerts your subscribers at the right time.', 'Actívala una vez, Yuno avisa a tus suscriptores en el momento adecuado.')}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl transition-all duration-150 mt-4"
            style={{ background: autoEnabled ? 'rgba(232,25,44,0.07)' : TILE_BG, border: `1px solid ${autoEnabled ? 'rgba(232,25,44,0.28)' : F_BORDER}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span style={{ fontSize: 20, lineHeight: 1 }}>📅</span>
                <div className="min-w-0">
                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('Nouvelle soirée', 'New event', 'Nuevo evento')}</p>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>
                    {t('Quand une soirée d\'un club sous contrat devient visible.', 'When an event from a club under contract goes live.', 'Cuando un evento de un club con contrato se hace visible.')}
                  </p>
                </div>
              </div>
              <Switch checked={autoEnabled} onCheckedChange={toggleAuto} disabled={togglingAuto} />
            </div>
            <div className="rounded-lg p-2.5 mt-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
              <p className="truncate" style={{ color: T2, fontSize: 11.5, fontWeight: 600 }}>{autoPreview.title}</p>
              <p style={{ color: T3, fontSize: 11, lineHeight: 1.4, marginTop: 2 }}>{autoPreview.body}</p>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5">
              <Users className="h-3 w-3" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 10.5 }}>{t('Tes abonnés', 'Your subscribers', 'Tus suscriptores')}</span>
            </div>
          </div>
        </div>

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
                disabled={sending || !title.trim() || !body.trim() || (reach ?? 0) === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                style={{
                  background: RED, color: '#fff', padding: '11px 18px', boxShadow: `0 0 18px -6px ${RED}88`,
                  opacity: (sending || !title.trim() || !body.trim() || (reach ?? 0) === 0) ? 0.5 : 1,
                }}
              >
                <Send className="h-4 w-4" />
                {t('Envoyer', 'Send', 'Enviar')}
              </button>
            </div>
            {!reachLoading && (reach ?? 0) === 0 && (
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
            <div className="rounded-2xl p-3.5" style={{ background: 'rgba(30,30,32,0.92)', border: '1px solid rgba(255,255,255,0.10)', backdropFilter: 'blur(20px)' }}>
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[9px] flex-none" style={{ background: '#050505', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <span style={{ color: RED, fontWeight: 800, fontSize: 13 }}>Y</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate" style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                      {title || t('Titre de ta notif', 'Your notification title', 'Título de tu notificación')}
                    </p>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{t('main.', 'now', 'ahora')}</span>
                  </div>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>
                    {body || t('Ton message apparaîtra ici.', 'Your message will appear here.', 'Tu mensaje aparecerá aquí.')}
                  </p>
                </div>
              </div>
            </div>
            <p style={{ color: T3, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
              {t('Maximum 4 envois manuels par 24 h.', 'Up to 4 manual sends per 24h.', 'Hasta 4 envíos manuales por 24 h.')}
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
              <Calendar className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
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
