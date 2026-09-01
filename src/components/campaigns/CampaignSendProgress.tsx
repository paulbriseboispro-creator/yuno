// Fenêtre du pro sur un envoi de masse en cours.
//
// Un envoi de 5 000 emails ne se termine pas en trois secondes : il s'étale sur
// des tranches, il peut buter sur le plafond du jour, il peut se couper tout
// seul si les plaintes montent. Sans cet écran, le pro voit « Envoi en cours »
// pendant une heure et appelle. Avec, il voit exactement où ça en est et
// POURQUOI ça s'est arrêté.
//
// La règle d'affichage : ne jamais mentir par omission. Une campagne en pause
// disjoncteur doit le dire en clair, avec le chiffre qui l'a déclenchée.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Loader2, AlertTriangle, ShieldAlert, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

export interface SendProgress {
  status: string;
  paused_reason: string | null;
  error_message: string | null;
  total: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  suppressed: number;
  daily_cap: number;
  daily_used: number;
  monthly_used: number;
  monthly_free: number;
  monthly_credits: number;
  /** Calculé SERVEUR (reliquat gratuit + crédits) — jamais recalculé ici. */
  monthly_remaining: number;
}

async function fetchSendProgress(campaignId: string): Promise<SendProgress | null> {
  const { data, error } = await supabase.rpc('get_campaign_send_progress', { p_campaign_id: campaignId });
  if (error || !data) return null;
  // La RPC est typée `Json` côté Supabase (elle renvoie un jsonb construit à la
  // main) : la forme réelle est celle de SendProgress, définie juste au-dessus.
  return data as unknown as SendProgress;
}

interface Props {
  campaignId: string;
  /** Appelé quand la campagne quitte l'état « en vol ». */
  onSettled?: (status: string) => void;
  compact?: boolean;
  /** Ouvre l'achat d'emails supplémentaires (fourni par la page hôte). */
  onBuyCredits?: () => void;
}

const ACTIVE = ['sending', 'paused'];

export default function CampaignSendProgress({ campaignId, onSettled, compact, onBuyCredits }: Props) {
  const { t } = useLanguage();
  const [p, setP] = useState<SendProgress | null>(null);
  const [acting, setActing] = useState(false);
  const settledRef = useRef(false);

  const load = useCallback(async () => {
    const next = await fetchSendProgress(campaignId);
    if (!next) return;
    setP(next);
    if (!ACTIVE.includes(next.status) && !settledRef.current) {
      settledRef.current = true;
      onSettled?.(next.status);
    }
  }, [campaignId, onSettled]);

  useEffect(() => {
    load();
    // On ne sonde QUE tant que ça bouge. Une campagne en pause ne bouge pas
    // toute seule — inutile d'interroger la base toutes les 5 s pour rien.
    const id = setInterval(() => {
      setP((cur) => {
        if (cur && cur.status !== 'sending') return cur;
        load();
        return cur;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const act = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    setActing(true);
    try {
      const { error } = await supabase.rpc('set_email_campaign_send_state', {
        p_campaign_id: campaignId, p_action: action,
      });
      if (error) throw new Error(error.message);
      // La reprise redémarre côté serveur au prochain balayage du cron (≤ 1 min).
      if (action === 'resume') toast.success(t('em.send.resumed'));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [campaignId, load, t]);

  if (!p) return null;
  if (!ACTIVE.includes(p.status) && compact) return null;

  const done = p.sent + p.failed;
  const pct = p.total > 0 ? Math.min(100, Math.round((done / p.total) * 100)) : 0;
  const monthReached = p.status === 'sending' && (p.monthly_remaining ?? 1) <= 0 && done < p.total;
  const capReached = !monthReached && p.status === 'sending' && p.daily_cap > 0 && p.daily_used >= p.daily_cap;
  const breaker = p.paused_reason === 'complaint_rate' || p.paused_reason === 'bounce_rate';

  const rate = (n: number) => (p.sent > 0 ? ((n / p.sent) * 100).toFixed(2) : '0.00');

  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: 'rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.025)' }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
          {p.status === 'sending' && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#FCD34D' }} />}
          {p.status === 'paused' && <Pause className="h-3.5 w-3.5" style={{ color: '#FCD34D' }} />}
          {p.sent.toLocaleString()} / {p.total.toLocaleString()} {t('em.send.sentOf')}
        </span>
        <span className="text-[12px] tabular-nums opacity-55">{pct}%</span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full transition-all duration-500"
             style={{ width: `${pct}%`, background: breaker ? '#FF5C63' : p.status === 'paused' ? '#FCD34D' : '#34D399' }} />
      </div>

      {/* Pourquoi c'est arrêté — en clair, avec le chiffre. */}
      {breaker && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg p-2.5 text-[12px]"
             style={{ background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.22)' }}>
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#FF5C63' }} />
          <div>
            <p className="font-semibold" style={{ color: '#FF5C63' }}>{t('em.send.breakerTitle')}</p>
            <p className="mt-0.5 opacity-75">
              {p.paused_reason === 'complaint_rate'
                ? t('em.send.breakerComplaints').replace('{r}', rate(p.complained))
                : t('em.send.breakerBounces').replace('{r}', rate(p.bounced))}
            </p>
            <p className="mt-1 opacity-60">{t('em.send.breakerAdvice')}</p>
          </div>
        </div>
      )}

      {p.paused_reason === 'send_error' && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg p-2.5 text-[12px]"
             style={{ background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.22)' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#FF5C63' }} />
          <div>
            <p className="font-semibold" style={{ color: '#FF5C63' }}>{t('em.send.errorTitle')}</p>
            <p className="mt-0.5 opacity-70">{p.error_message}</p>
          </div>
        </div>
      )}

      {/* Quota du MOIS épuisé : prioritaire sur le message journalier — dire
          « ça reprend demain » quand ça reprend le 1er serait un mensonge. */}
      {monthReached && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg p-2.5 text-[12px]"
             style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <Clock className="h-4 w-4 flex-shrink-0" style={{ color: '#FCD34D' }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold" style={{ color: '#FCD34D' }}>{t('em.send.monthlyCapTitle')}</p>
            <p className="mt-0.5 opacity-70">
              {t('em.send.monthlyCapBody').replace('{date}', new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString())}
            </p>
          </div>
          {onBuyCredits && (
            <Button size="sm" variant="outline" onClick={onBuyCredits} className="flex-none">
              {t('em.send.monthlyCapBuy')}
            </Button>
          )}
        </div>
      )}

      {capReached && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg p-2.5 text-[12px]"
             style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#FCD34D' }} />
          <div>
            <p className="font-semibold" style={{ color: '#FCD34D' }}>{t('em.send.capTitle')}</p>
            <p className="mt-0.5 opacity-70">
              {t('em.send.capBody').replace('{cap}', p.daily_cap.toLocaleString()).replace('{left}', (p.total - done).toLocaleString())}
            </p>
          </div>
        </div>
      )}

      {!compact && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] opacity-60">
          <span>{p.delivered.toLocaleString()} {t('em.send.delivered')}</span>
          {p.bounced > 0 && <span>{p.bounced.toLocaleString()} {t('em.send.bounced')} ({rate(p.bounced)}%)</span>}
          {p.complained > 0 && <span>{p.complained.toLocaleString()} {t('em.send.complained')} ({rate(p.complained)}%)</span>}
          {p.failed > 0 && <span>{p.failed.toLocaleString()} {t('em.send.failed')}</span>}
          {p.suppressed > 0 && <span>{p.suppressed.toLocaleString()} {t('em.send.suppressed')}</span>}
        </div>
      )}

      {ACTIVE.includes(p.status) && (
        <div className="mt-3 flex gap-2">
          {p.status === 'sending' ? (
            <Button size="sm" variant="outline" onClick={() => act('pause')} disabled={acting}>
              <Pause className="mr-1.5 h-3.5 w-3.5" /> {t('em.send.pause')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => act('resume')} disabled={acting}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> {t('em.send.resume')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => act('cancel')} disabled={acting}
                  style={{ color: '#FF5C63' }}>
            {t('em.send.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
