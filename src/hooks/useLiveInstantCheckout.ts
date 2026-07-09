// Mode Live — « payer direct » : checkout d'UN seul article sans passer par le
// panier. Réutilise create-checkout (validation serveur, kill-switch, split
// Stripe, mode démo) exactement comme la page Cart.
//
// Age gate : le checkout alcool exige une déclaration de majorité. Ici on la
// récupère du profil (age_verified_at / birth_date, déjà posé au 1er achat).
// Si l'utilisateur n'a jamais déclaré son âge, on NE le déclare pas à sa place :
// on retombe sur le panier (où vit l'AgeGate) — chemin rare, sûr.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { launchCheckout } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

interface InstantItem {
  id: string;
  collection?: string;
  kind?: 'drink' | 'bottle';
  mixerIds?: string[];
  /** Repli panier si l'âge n'est pas encore déclaré. */
  fallbackAddToCart: () => void;
}

interface LiveContext {
  eventId: string;
  venueId: string;
}

export function useLiveInstantCheckout(ctx: LiveContext | null) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [payingId, setPayingId] = useState<string | null>(null);

  const payNow = async (item: InstantItem) => {
    if (!ctx || !user || payingId) return;
    setPayingId(item.id);
    try {
      // Majorité déjà déclarée ? (posée au 1er achat / dans les réglages profil.)
      const { data: profile } = await supabase
        .from('profiles')
        .select('age_verified_at, birth_date')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile?.age_verified_at && !profile?.birth_date) {
        // Jamais déclaré : on ne triche pas → panier + AgeGate.
        item.fallbackAddToCart();
        toast({ title: t('live.pay.ageFirst') });
        navigate('/cart');
        return;
      }

      const { getTrackedLinkForCheckout } = await import('@/hooks/usePurchaseSourceTracking');
      const trackedLinkId = getTrackedLinkForCheckout(ctx.eventId);

      const payloadItem =
        item.kind === 'bottle'
          ? { id: item.id, quantity: 1, kind: 'bottle', mixerIds: item.mixerIds ?? [] }
          : { id: item.id, quantity: 1, collection: item.collection };

      const body: Record<string, unknown> = {
        items: [payloadItem],
        eventId: ctx.eventId,
        venueId: ctx.venueId,
        cancelUrl: '/live',
        trackedLinkId,
        ageDeclaration: { confirmed: true, birthDate: profile.birth_date ?? undefined },
      };

      const { data, error } = await invokeEdgeFunction('create-checkout', { body });
      if (error) throw error;

      if (data?.code === 'PAYMENTS_DISABLED') {
        toast({ title: t('payments.disabledBanner'), variant: 'destructive' });
        return;
      }
      if (!data?.success) throw new Error(data?.error || 'checkout failed');

      // Mode démo (@womber.fr) : order déjà payé → page QR de la commande.
      if (data.testMode && data.redirectUrl) {
        haptics.medium();
        navigate(data.redirectUrl);
        return;
      }
      if (data.url) {
        haptics.medium();
        launchCheckout(data.url);
        return;
      }
      throw new Error('no checkout url');
    } catch (e) {
      haptics.error();
      toast({
        title: t('live.pay.error'),
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPayingId(null);
    }
  };

  return { payNow, payingId };
}
