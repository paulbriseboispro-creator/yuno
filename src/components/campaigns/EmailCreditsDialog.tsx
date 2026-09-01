// Achat d'emails supplémentaires — au prix coûtant.
//
// Le quota mensuel offert (15 000) couvre l'usage normal ; ce dialogue n'existe
// que pour le mois où un compte veut aller au-delà. Les packs sont facturés au
// coût réel de l'infrastructure (overage Resend + frais Stripe), sans marge —
// et on le DIT dans l'interface : c'est ce qui rend le plafond acceptable.
//
// Le paiement suit le patron des crédits SMS : checkout Stripe hébergé, retour
// sur la page d'origine avec ?emailCredits=success, vérification idempotente
// côté serveur (un refresh ne crédite jamais deux fois).

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Loader2, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ImportScope } from './ImportContactsDialog';

interface Pack { id: string; name: string; emails_amount: number; price_eur: number }

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ImportScope;
  /** Après un crédit en mode démo (pas de redirection Stripe). */
  onCredited?: () => void;
}

/**
 * À poser sur toute page susceptible de recevoir le retour Stripe
 * (?emailCredits=success&session_id=…) : vérifie la session, crédite (une
 * seule fois — l'idempotence est en base), toaste, nettoie l'URL.
 */
export function useEmailCreditsReturn(onCredited?: () => void) {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const status = searchParams.get('emailCredits');
    if (!status) return;
    const sessionId = searchParams.get('session_id');

    const clean = () => {
      searchParams.delete('emailCredits');
      searchParams.delete('session_id');
      setSearchParams(searchParams, { replace: true });
    };

    if (status === 'cancelled') {
      toast.info(t('em.credits.cancelled'));
      clean();
      return;
    }
    if (status !== 'success' || !sessionId) { clean(); return; }

    void (async () => {
      const { data, error } = await supabase.functions.invoke('email-credits', {
        body: { action: 'verify', session_id: sessionId },
      });
      const r = (data ?? {}) as { status?: string; credits_added?: number; error?: string };
      if (error || r.error || r.status !== 'paid') {
        toast.error(t('em.credits.error'));
      } else {
        toast.success(t('em.credits.success').replace('{n}', Number(r.credits_added || 0).toLocaleString('fr-FR')));
        onCredited?.();
      }
      clean();
    })();
    // searchParams est volontairement seul déclencheur : l'effet ne doit
    // tourner qu'à l'arrivée des paramètres de retour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
}

export default function EmailCreditsDialog({ open, onClose, scope, onCredited }: Props) {
  const { t } = useLanguage();
  const location = useLocation();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('email_packs' as never)
      .select('id, name, emails_amount, price_eur')
      .order('position', { ascending: true })
      .then(({ data }) => setPacks(((data as unknown) as Pack[]) || []));
  }, [open]);

  const buy = useCallback(async (pack: Pack) => {
    setBuying(pack.id);
    try {
      const { data, error } = await supabase.functions.invoke('email-credits', {
        body: {
          action: 'checkout',
          pack_id: pack.id,
          scope: scope.kind === 'venue' ? 'venue' : 'organizer',
          venue_id: scope.kind === 'venue' ? scope.venueId : null,
          return_path: location.pathname,
        },
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { url?: string; demo?: boolean; credits_added?: number; error?: string };
      if (r.error) throw new Error(r.error);
      if (r.demo) {
        toast.success(t('em.credits.success').replace('{n}', Number(r.credits_added || 0).toLocaleString('fr-FR')));
        onCredited?.();
        onClose();
        return;
      }
      if (r.url) { window.location.href = r.url; return; }
      throw new Error('missing checkout url');
    } catch (e) {
      toast.error(e instanceof Error && e.message && !e.message.includes('missing') ? e.message : t('em.credits.error'));
      setBuying(null);
    }
  }, [scope, location.pathname, onClose, onCredited, t]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !buying) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('em.credits.title')}</DialogTitle>
          <DialogDescription>{t('em.credits.sub')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {packs.length === 0 && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin opacity-40" />
            </div>
          )}
          {packs.map((pack) => (
            <div
              key={pack.id}
              className="flex items-center gap-3 rounded-xl border p-3.5"
              style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}
            >
              <div
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
                style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: '#E8192C' }}
              >
                <Mail className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold tabular-nums">{pack.name}</div>
                <div className="text-[11.5px] opacity-55">
                  {(Number(pack.price_eur) / (pack.emails_amount / 1000)).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} € / 1 000
                </div>
              </div>
              <Button size="sm" onClick={() => void buy(pack)} disabled={buying !== null}>
                {buying === pack.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {Number(pack.price_eur).toLocaleString('fr-FR')} €
              </Button>
            </div>
          ))}
        </div>

        <p className="flex items-start gap-2 rounded-lg p-2.5 text-[11.5px] leading-relaxed"
           style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)', color: 'rgba(255,255,255,0.7)' }}>
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" style={{ color: '#34D399' }} />
          <span>{t('em.credits.noExpiry')}</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
