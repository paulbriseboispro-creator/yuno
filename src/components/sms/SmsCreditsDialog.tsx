// Achat de crédits SMS depuis n'importe quelle page (éditeur, rapport, page
// crédits) — club ou organisateur. Même patron que EmailCreditsDialog :
// checkout Stripe hébergé, retour sur la page d'origine avec
// ?smsCredits=success&session_id=…, vérification idempotente côté serveur.

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Loader2, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { SMS_MARKETING_LIVE, type SmsScope } from '@/lib/smsMarketing';

export interface SmsPack { id: string; name: string; description: string | null; credits_amount: number; price_eur: number; position: number }

interface Props {
  open: boolean;
  onClose: () => void;
  scope: SmsScope;
  /** Crédits manquants pour la campagne en cours : met en avant le pack qui suffit. */
  missing?: number | null;
  /** Après un crédit en mode démo (pas de redirection Stripe). */
  onCredited?: () => void;
}

/**
 * À poser sur toute page susceptible de recevoir le retour Stripe : vérifie la
 * session, crédite (une seule fois — l'idempotence est en base), toaste,
 * nettoie l'URL. Gère aussi l'ancien paramètre `purchase=` de la page crédits.
 */
export function useSmsCreditsReturn(onCredited?: () => void) {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const status = searchParams.get('smsCredits') ?? searchParams.get('purchase');
    if (!status) return;
    const sessionId = searchParams.get('session_id');
    const clean = () => {
      searchParams.delete('smsCredits');
      searchParams.delete('purchase');
      searchParams.delete('session_id');
      setSearchParams(searchParams, { replace: true });
    };
    if (status === 'cancelled') { toast.info(t('sms.toastCancelled')); clean(); return; }
    if (status !== 'success' || !sessionId) { clean(); return; }
    void (async () => {
      const { data, error } = await supabase.functions.invoke('sms-purchase-verify', { body: { session_id: sessionId } });
      const r = (data ?? {}) as { status?: string; credited?: boolean; credits_added?: number; error?: string };
      if (error || r.error) toast.error(t('sms.toastVerifyImpossible'));
      else if (r.status !== 'paid') toast.warning(t('sms.toastPending'));
      else {
        toast.success(r.credited ? `+${r.credits_added} ${t('sms.creditsAddedSuffix')}` : t('sms.toastAlreadyAdded'));
        onCredited?.();
      }
      clean();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
}

export function useSmsPacks(enabled = true) {
  const [packs, setPacks] = useState<SmsPack[]>([]);
  useEffect(() => {
    if (!enabled) return;
    supabase.from('sms_packs').select('id, name, description, credits_amount, price_eur, position')
      .eq('is_active', true).order('position', { ascending: true })
      .then(({ data }) => setPacks(((data ?? []) as SmsPack[])));
  }, [enabled]);
  return packs;
}

export default function SmsCreditsDialog({ open, onClose, scope, missing, onCredited }: Props) {
  const { t } = useLanguage();
  const location = useLocation();
  const packs = useSmsPacks(open);
  const [buying, setBuying] = useState<string | null>(null);

  const recommended = missing && missing > 0
    ? packs.find((p) => p.credits_amount >= missing) ?? packs[packs.length - 1]
    : packs.find((p) => p.name === 'Standard') ?? packs[1];

  const buy = useCallback(async (pack: SmsPack) => {
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    if (!SMS_MARKETING_LIVE) { toast.info(t('smsc.lockedToast')); return; }
    setBuying(pack.id);
    try {
      const { data, error } = await supabase.functions.invoke('sms-purchase-checkout', {
        body: {
          pack_id: pack.id,
          scope: scope.kind,
          venue_id: scope.kind === 'venue' ? scope.venueId : null,
          return_path: location.pathname,
        },
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { url?: string; demo?: boolean; credits_added?: number; error?: string; code?: string };
      if (r.code === 'PAYMENTS_DISABLED') { toast.error(t('payments.disabledBanner')); setBuying(null); return; }
      if (r.error) throw new Error(r.error);
      if (r.demo) {
        toast.success(`+${r.credits_added} ${t('sms.creditsAddedSuffix')}`);
        onCredited?.();
        onClose();
        return;
      }
      if (r.url) { window.location.href = r.url; return; }
      throw new Error(t('sms.noPaymentUrl'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('sms.toastPayError'));
      setBuying(null);
    }
  }, [scope, location.pathname, onClose, onCredited, t]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !buying) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('smsc.credits.title')}</DialogTitle>
          <DialogDescription>
            {missing && missing > 0
              ? t('smsc.credits.missing').replace('{n}', String(missing))
              : t('smsc.credits.sub')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {packs.length === 0 && (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin opacity-40" /></div>
          )}
          {packs.map((pack) => {
            const isReco = recommended?.id === pack.id;
            return (
              <div
                key={pack.id}
                className="flex items-center gap-3 rounded-xl border p-3.5"
                style={{
                  borderColor: isReco ? 'rgba(232,25,44,0.45)' : 'rgba(255,255,255,0.1)',
                  background: isReco ? 'rgba(232,25,44,0.05)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
                     style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: '#E8192C' }}>
                  <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-semibold tabular-nums">
                    {pack.credits_amount.toLocaleString('fr-FR')} SMS
                    {isReco && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        <Sparkles className="h-3 w-3" />{t('sms.popular')}
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] opacity-55">
                    {pack.name} · {(Number(pack.price_eur) / pack.credits_amount).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} € / SMS
                  </div>
                </div>
                <Button size="sm" onClick={() => void buy(pack)} disabled={buying !== null} variant={isReco ? 'default' : 'outline'}>
                  {buying === pack.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {Number(pack.price_eur).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                </Button>
              </div>
            );
          })}
        </div>

        <p className="flex items-start gap-2 rounded-lg p-2.5 text-[11.5px] leading-relaxed"
           style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)', color: 'rgba(255,255,255,0.7)' }}>
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" style={{ color: '#34D399' }} />
          <span>{t('smsc.credits.trust')}</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
