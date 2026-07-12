// Page upsell post-checkout — boissons au prix presale juste après l'achat
// d'un billet, AVANT la confirmation. Achat 100 % optionnel, skippable en un
// tap. Voir docs/SYSTEME_VENTE_BOISSONS.md.
//
// Entrées :
//   /order/upsell?ticket=<ticketId>  — post-paiement (VerifyTicketPayment,
//                                      retour natif, billets gratuits)
//   /order/upsell?event=<eventId>    — deep-link du push AUTO drinks_preorder
//                                      (résout le billet payé de l'utilisateur)
//
// Éligibilité — sinon redirection immédiate vers la confirmation billet :
// connecté ∧ billet trouvé ∧ soirée non alcohol_free ∧ menu_enabled ∧
// post_checkout_upsell_enabled ∧ carte non vide. Les invités (guest checkout)
// ne passent jamais ici : ils gardent l'écran incitation-compte.
//
// Le paiement réutilise create-checkout (validation prix serveur — précédence
// presale → promo → prix —, split Stripe, kill-switch, mode démo) : la commande
// créée est liée à la soirée (orders.event_id) → QR de retrait le soir J.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Minus, Plus, QrCode, Wine, Zap, ArrowRight, GlassWater } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { launchCheckout } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { AgeGate } from '@/components/AgeGate';
import { TermsAcceptance } from '@/components/TermsAcceptance';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, ease: EASE, delay },
});

interface UpsellDrink {
  id: string;
  name: string;
  price: number;
  presalePrice: number | null;
  presaleActive: boolean;
  promoPrice: number | null;
  imgUrl: string | null;
  collection: 'drink' | 'shot' | 'soft';
  alcPct: number | null;
}

/** Prix effectif — miroir de useStore.addToCart et de create-checkout (serveur). */
function effectivePrice(d: UpsellDrink): number {
  if (d.presaleActive && d.presalePrice) return d.presalePrice;
  if (d.promoPrice) return d.promoPrice;
  return d.price;
}

/** Un UUID propre même si Stripe a malformé la query d'annulation (?ticket=X?y=z). */
function cleanUuid(raw: string | null): string | null {
  const m = raw?.match(/^[0-9a-f-]{36}/i);
  return m ? m[0] : null;
}

export default function PostCheckoutUpsell() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();

  const ticketParam = cleanUuid(searchParams.get('ticket'));
  const eventParam = cleanUuid(searchParams.get('event'));

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(ticketParam);
  const [eventInfo, setEventInfo] = useState<{ id: string; title: string; startAt: string; posterUrl: string | null } | null>(null);
  const [venueInfo, setVenueInfo] = useState<{ id: string; name: string; absorbFees: boolean } | null>(null);
  const [drinks, setDrinks] = useState<UpsellDrink[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ageVerified, setAgeVerified] = useState(false);
  const [ageBirthDate, setAgeBirthDate] = useState<string | undefined>(undefined);
  const [acceptCgv, setAcceptCgv] = useState(false);

  // Sortie standard : la confirmation billet (replace pour que « retour »
  // ne ramène jamais sur l'upsell).
  const exitToConfirmation = (tid: string | null) => {
    navigate(tid ? `/order-confirmation?type=ticket&id=${tid}` : '/my-orders?tab=tickets', { replace: true });
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { exitToConfirmation(ticketParam); return; }
    if (!ticketParam && !eventParam) { navigate('/my-orders', { replace: true }); return; }

    let cancelled = false;
    (async () => {
      try {
        // 1) Résoudre le billet (et la soirée qui va avec).
        let tid = ticketParam;
        let evId: string | null = eventParam;
        if (tid) {
          const { data: tk } = await supabase
            .from('tickets')
            .select('id, event_id, user_id')
            .eq('id', tid)
            .maybeSingle();
          if (!tk || tk.user_id !== user.id) { if (!cancelled) exitToConfirmation(tid); return; }
          evId = tk.event_id;
        } else if (evId) {
          const { data: tk } = await supabase
            .from('tickets')
            .select('id')
            .eq('event_id', evId)
            .eq('user_id', user.id)
            .eq('status', 'paid')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!tk) { if (!cancelled) navigate('/my-orders', { replace: true }); return; }
          tid = tk.id;
        }
        if (!evId || !tid) { if (!cancelled) exitToConfirmation(tid); return; }

        // 2) Soirée + club : éligibilité.
        const { data: ev } = await supabase
          .from('events')
          .select('id, title, start_at, venue_id, poster_url, alcohol_free')
          .eq('id', evId)
          .maybeSingle();
        if (!ev || !ev.venue_id || ev.alcohol_free) { if (!cancelled) exitToConfirmation(tid); return; }

        // post_checkout_upsell_enabled n'est pas encore dans types.ts (généré
        // après db push) → cast, même pattern que live_mode_enabled à son ajout.
        const { data: venue } = (await supabase
          .from('venues')
          .select('id, name, menu_enabled, post_checkout_upsell_enabled, absorb_yuno_fees')
          .eq('id', ev.venue_id)
          .maybeSingle()) as unknown as { data: { id: string; name: string; menu_enabled: boolean | null; post_checkout_upsell_enabled: boolean | null; absorb_yuno_fees: boolean | null } | null };
        if (!venue || venue.menu_enabled === false || venue.post_checkout_upsell_enabled === false) {
          if (!cancelled) exitToConfirmation(tid);
          return;
        }

        // 3) La carte — presale d'abord, hors ruptures.
        const { data: rows } = await supabase
          .from('drinks')
          .select('id, name, price, presale_price, presale_active, promo_price, img_url, collection, alc_pct, out_of_stock')
          .eq('venue_id', ev.venue_id)
          .eq('active', true)
          .order('position', { ascending: true })
          .limit(60);
        const list: UpsellDrink[] = (rows || [])
          .filter((d) => !d.out_of_stock)
          .map((d) => ({
            id: d.id,
            name: d.name,
            price: Number(d.price),
            presalePrice: d.presale_price ? Number(d.presale_price) : null,
            presaleActive: d.presale_active === true,
            promoPrice: d.promo_price ? Number(d.promo_price) : null,
            imgUrl: d.img_url,
            collection: (d.collection || 'drink') as UpsellDrink['collection'],
            alcPct: d.alc_pct ? Number(d.alc_pct) : null,
          }));
        if (list.length === 0) { if (!cancelled) exitToConfirmation(tid); return; }

        if (!cancelled) {
          setTicketId(tid);
          setEventInfo({ id: ev.id, title: ev.title, startAt: ev.start_at, posterUrl: ev.poster_url });
          setVenueInfo({ id: venue.id, name: venue.name, absorbFees: venue.absorb_yuno_fees === true });
          setDrinks(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) exitToConfirmation(ticketParam);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, ticketParam, eventParam]);

  const presaleDrinks = useMemo(() => drinks.filter((d) => d.presaleActive && d.presalePrice), [drinks]);
  const regularDrinks = useMemo(() => drinks.filter((d) => !(d.presaleActive && d.presalePrice)), [drinks]);

  const selection = useMemo(() => drinks.filter((d) => (qty[d.id] || 0) > 0), [drinks, qty]);
  const subtotal = useMemo(
    () => selection.reduce((sum, d) => sum + effectivePrice(d) * (qty[d.id] || 0), 0),
    [selection, qty],
  );
  // Miroir du serveur : commission Yuno 3 % payée par le fan, sauf si le club
  // l'absorbe (venues.absorb_yuno_fees) — voir create-checkout.
  const total = venueInfo?.absorbFees ? subtotal : subtotal * 1.03;
  const hasAlcohol = selection.some((d) => d.collection !== 'soft' || (d.alcPct || 0) > 0);

  const step = (id: string, delta: number) => {
    haptics.selection();
    setQty((q) => {
      const next = Math.max(0, Math.min(10, (q[id] || 0) + delta));
      return { ...q, [id]: next };
    });
  };

  const handlePay = async () => {
    if (!eventInfo || !venueInfo || !ticketId || selection.length === 0 || paying) return;
    if (hasAlcohol && !ageVerified) { toast({ title: t('ageGate.required'), variant: 'destructive' }); return; }
    if (!acceptCgv) { toast({ title: t('cgv.required'), variant: 'destructive' }); return; }
    setPaying(true);
    try {
      const body: Record<string, unknown> = {
        items: selection.map((d) => ({ id: d.id, quantity: qty[d.id] || 0, collection: d.collection })),
        eventId: eventInfo.id,
        venueId: venueInfo.id,
        cancelUrl: `/order/upsell?ticket=${ticketId}`,
        purchaseSource: 'post_checkout_upsell',
        ageDeclaration: { confirmed: true, birthDate: ageBirthDate },
      };
      const { data, error } = await invokeEdgeFunction('create-checkout', { body });
      if (error) throw error;
      if (data?.code === 'PAYMENTS_DISABLED') {
        toast({ title: t('payments.disabledBanner'), variant: 'destructive' });
        return;
      }
      if (!data?.success) throw new Error(data?.error || 'checkout failed');
      if (data.testMode && data.redirectUrl) {
        haptics.medium();
        navigate(data.redirectUrl, { replace: true });
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
        title: t('upsellPage.payError'),
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6"
        style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: '#E8192C' }} />
      </div>
    );
  }

  const surface = { background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 } as const;

  const DrinkRow = ({ d }: { d: UpsellDrink }) => {
    const unit = effectivePrice(d);
    const discounted = unit < d.price;
    const n = qty[d.id] || 0;
    return (
      <div className="flex items-center gap-3" style={{ ...surface, padding: '10px 12px' }}>
        {d.imgUrl ? (
          <img src={d.imgUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 6, background: 'rgba(232,25,44,0.08)' }}>
            {d.collection === 'soft' ? <GlassWater style={{ width: 18, height: 18, color: '#9A9A9A' }} /> : <Wine style={{ width: 18, height: 18, color: '#E8192C' }} />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-sans font-medium truncate" style={{ fontSize: '14px', color: '#fff' }}>{d.name}</p>
          <p className="font-mono" style={{ fontSize: '12px', color: discounted ? '#E8192C' : '#9A9A9A', marginTop: 2 }}>
            {unit.toFixed(2)} €
            {discounted && (
              <span className="line-through" style={{ color: '#5A5A5E', marginLeft: 6 }}>{d.price.toFixed(2)} €</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {n > 0 && (
            <>
              <button
                onClick={() => step(d.id, -1)}
                className="flex items-center justify-center"
                style={{ width: 30, height: 30, borderRadius: 8, background: '#1F1F22', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                aria-label="-"
              >
                <Minus style={{ width: 14, height: 14 }} />
              </button>
              <span className="font-mono font-bold text-center" style={{ fontSize: '14px', color: '#fff', minWidth: 18 }}>{n}</span>
            </>
          )}
          <button
            onClick={() => step(d.id, +1)}
            className="flex items-center justify-center"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: n > 0 ? '#E8192C' : '#1F1F22',
              border: n > 0 ? '1px solid #E8192C' : '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
            }}
            aria-label="+"
          >
            <Plus style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className="min-h-[100dvh] overflow-x-hidden"
      style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto px-5" style={{ maxWidth: 460 }}>
        {/* Header : billet confirmé + skip toujours visible */}
        <motion.div {...rise(0)} className="flex items-center justify-between" style={{ paddingTop: 18 }}>
          <p className="font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#E8192C' }}>
            ✓ {t('upsellPage.kicker')}
          </p>
          <button
            onClick={() => exitToConfirmation(ticketId)}
            className="font-mono uppercase link-slide flex items-center gap-1"
            style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#9A9A9A', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {t('upsellPage.skip')}
            <ArrowRight style={{ width: 13, height: 13 }} />
          </button>
        </motion.div>

        {/* Hero */}
        <motion.div {...rise(0.06)} style={{ marginTop: 22 }}>
          <h1 className="font-display font-bold uppercase" style={{ fontSize: 'clamp(30px, 9vw, 44px)', color: '#fff', letterSpacing: '-0.03em', lineHeight: 0.95 }}>
            {t('upsellPage.headline')}
          </h1>
          <p className="font-sans" style={{ fontSize: '14.5px', color: '#9A9A9A', marginTop: 12, lineHeight: 1.55 }}>
            {t('upsellPage.sub')}
          </p>
        </motion.div>

        {/* Contexte soirée */}
        {eventInfo && (
          <motion.div {...rise(0.12)} className="flex items-center gap-3.5" style={{ ...surface, marginTop: 20, padding: 12 }}>
            {eventInfo.posterUrl && (
              <img src={eventInfo.posterUrl} alt="" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <p className="font-display font-bold uppercase truncate" style={{ fontSize: '14px', color: '#fff', lineHeight: 1.1 }}>{eventInfo.title}</p>
              <p className="font-mono uppercase truncate" style={{ fontSize: '10.5px', color: '#9A9A9A', letterSpacing: '0.04em', marginTop: 4 }}>{venueInfo?.name}</p>
            </div>
          </motion.div>
        )}

        {/* Comment ça marche — l'éducation en 3 temps */}
        <motion.div {...rise(0.18)} className="grid grid-cols-3 gap-2" style={{ marginTop: 20 }}>
          {[
            { Icon: Wine, label: t('upsellPage.how1') },
            { Icon: QrCode, label: t('upsellPage.how2') },
            { Icon: Zap, label: t('upsellPage.how3') },
          ].map(({ Icon, label }) => (
            <div key={label} className="flex flex-col items-center text-center gap-2" style={{ ...surface, padding: '12px 8px' }}>
              <Icon style={{ width: 17, height: 17, color: '#E8192C' }} />
              <span className="font-sans" style={{ fontSize: '11.5px', color: '#E5E5E5', lineHeight: 1.3 }}>{label}</span>
            </div>
          ))}
        </motion.div>

        {/* Presale */}
        {presaleDrinks.length > 0 && (
          <motion.section {...rise(0.24)} style={{ marginTop: 28 }}>
            <div className="flex items-center justify-between mb-3">
              <p className="section-label-ruled">{t('upsellPage.presaleSection')}</p>
              <span
                className="font-mono uppercase"
                style={{ fontSize: '9.5px', letterSpacing: '0.1em', color: '#E8192C', background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 3, padding: '3px 7px' }}
              >
                {t('upsellPage.presaleBadge')}
              </span>
            </div>
            <p className="font-sans" style={{ fontSize: '12.5px', color: '#9A9A9A', marginBottom: 12 }}>{t('upsellPage.presaleUntil')}</p>
            <div className="space-y-2">
              {presaleDrinks.map((d) => <DrinkRow key={d.id} d={d} />)}
            </div>
          </motion.section>
        )}

        {/* Reste de la carte */}
        {regularDrinks.length > 0 && (
          <motion.section {...rise(presaleDrinks.length > 0 ? 0.3 : 0.24)} style={{ marginTop: 28 }}>
            <p className="section-label-ruled mb-3">{t('upsellPage.menuSection')}</p>
            <div className="space-y-2">
              {regularDrinks.map((d) => <DrinkRow key={d.id} d={d} />)}
            </div>
          </motion.section>
        )}

        {/* Age gate + CGV — seulement quand une sélection existe */}
        {selection.length > 0 && (
          <div className="space-y-3" style={{ marginTop: 24 }}>
            {hasAlcohol && <AgeGate userId={user?.id} onVerified={(v, bd) => { setAgeVerified(v); if (bd) setAgeBirthDate(bd); }} />}
            <TermsAcceptance userId={user?.id} context="drink" onAcceptedChange={setAcceptCgv} />
          </div>
        )}
      </div>

      {/* Footer collant : payer ou passer */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 px-4"
        style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', paddingTop: 12, background: 'linear-gradient(to top, rgba(10,10,10,0.97) 65%, transparent)' }}
      >
        <div className="mx-auto w-full" style={{ maxWidth: 460 }}>
          {selection.length > 0 ? (
            <button className="btn btn--primary w-full" onClick={handlePay} disabled={paying}>
              {paying ? (
                <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />
              ) : (
                <>
                  {t('upsellPage.payCta')} · {total.toFixed(2)} €
                </>
              )}
            </button>
          ) : (
            <button className="btn btn--ghost w-full" onClick={() => exitToConfirmation(ticketId)}>
              {t('upsellPage.skipCta')}
              <ArrowRight style={{ width: 16, height: 16 }} />
            </button>
          )}
          {selection.length > 0 && !venueInfo?.absorbFees && (
            <p className="font-mono uppercase text-center" style={{ fontSize: '9.5px', color: '#5A5A5E', letterSpacing: '0.06em', marginTop: 8 }}>
              {t('upsellPage.feeNote')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
