import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  MessageSquare,
  Loader2,
  Sparkles,
  Check,
  TrendingUp,
  Receipt,
  ShieldCheck,
  AlertTriangle,
  Users,
  CalendarDays,
  Crown,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SmsPack {
  id: string;
  name: string;
  description: string | null;
  credits_amount: number;
  price_eur: number;
  position: number;
}

interface SmsTransaction {
  id: string;
  type: 'purchase' | 'consume' | 'refund' | 'bonus' | 'admin_adjust';
  amount: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}

const TYPE_META: Record<SmsTransaction['type'], { label: string; tone: string }> = {
  purchase: { label: 'sms.type.purchase', tone: 'text-emerald-400' },
  consume: { label: 'sms.type.consume', tone: 'text-rose-400' },
  refund: { label: 'sms.type.refund', tone: 'text-sky-400' },
  bonus: { label: 'sms.type.bonus', tone: 'text-amber-400' },
  admin_adjust: { label: 'sms.type.admin_adjust', tone: 'text-muted-foreground' },
};

export default function OwnerSmsCredits() {
  const { venueId, scope, organizerUserId, loading: venueLoading } = useVenueContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const [packs, setPacks] = useState<SmsPack[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<SmsTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const ownerId = scope === 'venue' ? venueId : organizerUserId;

  useEffect(() => {
    if (venueLoading || !ownerId) return;
    void load();
  }, [ownerId, venueLoading]);

  // Handle Stripe redirect
  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const status = searchParams.get('purchase');

    if (status === 'cancelled') {
      toast.info(t('sms.toastCancelled'));
      searchParams.delete('purchase');
      setSearchParams(searchParams, { replace: true });
      return;
    }

    if (sessionId && status === 'success') {
      void verifyPurchase(sessionId);
    }
  }, [searchParams]);

  const load = async () => {
    setLoading(true);
    try {
      const [packsRes, balanceRes] = await Promise.all([
        supabase
          .from('sms_packs')
          .select('id, name, description, credits_amount, price_eur, position')
          .eq('is_active', true)
          .order('position', { ascending: true }),
        loadBalance(),
      ]);
      if (packsRes.error) throw packsRes.error;
      setPacks((packsRes.data ?? []) as SmsPack[]);

      if (balanceRes?.id) {
        await loadTransactions(balanceRes.id);
      } else {
        setTransactions([]);
      }
    } catch (e: any) {
      console.error('[sms credits] load', e);
      toast.error(e.message ?? t('sms.toastLoadError'));
    } finally {
      setLoading(false);
    }
  };

  const loadBalance = async () => {
    const query = supabase.from('sms_credit_balances').select('id, balance');
    if (scope === 'venue') {
      query.eq('venue_id', venueId!).is('organizer_id', null);
    } else {
      query.eq('organizer_id', organizerUserId!).is('venue_id', null);
    }
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    setBalance(data?.balance ?? 0);
    return data;
  };

  const loadTransactions = async (balanceId: string) => {
    const { data, error } = await supabase
      .from('sms_credit_transactions')
      .select('id, type, amount, balance_after, notes, created_at')
      .eq('balance_id', balanceId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    setTransactions((data ?? []) as SmsTransaction[]);
  };

  const verifyPurchase = async (sessionId: string) => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('sms-purchase-verify', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      if (data?.status === 'paid') {
        toast.success(
          data.credited
            ? `+${data.credits_added} ${t('sms.creditsAddedSuffix')}`
            : t('sms.toastAlreadyAdded'),
        );
        await load();
      } else {
        toast.warning(t('sms.toastPending'));
      }
    } catch (e: any) {
      console.error('[sms credits] verify', e);
      toast.error(e.message ?? t('sms.toastVerifyImpossible'));
    } finally {
      setVerifying(false);
      searchParams.delete('session_id');
      searchParams.delete('purchase');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const handlePurchase = async (pack: SmsPack) => {
    if (!ownerId) {
      toast.error(t('sms.toastNoContext'));
      return;
    }
    setPurchasing(pack.id);
    try {
      const { data, error } = await supabase.functions.invoke('sms-purchase-checkout', {
        body: {
          pack_id: pack.id,
          scope,
          venue_id: scope === 'venue' ? venueId : null,
        },
      });
      if (error) throw error;
      if (data?.code === 'PAYMENTS_DISABLED') {
        toast.error(t('payments.disabledBanner'));
        setPurchasing(null);
        return;
      }
      if (data?.demo) {
        toast.success(`Demo: +${data.credits_added} SMS`);
        await loadBalance();
        setPurchasing(null);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(t('sms.noPaymentUrl'));
      }
    } catch (e: any) {
      console.error('[sms credits] checkout', e);
      toast.error(e.message ?? t('sms.toastPayError'));
      setPurchasing(null);
    }
  };

  const recommendedPack = useMemo(
    () => packs.find((p) => p.name === 'Standard') ?? packs[1] ?? null,
    [packs],
  );

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <OwnerHeader title={t('sms.title')} />

      <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <ComingSoonBanner
          title={t('sms.comingSoonTitle')}
          description={t('sms.comingSoonDesc')}
        />

        {/* Balance hero */}
        <Card className="relative overflow-hidden border-white/[0.06] bg-gradient-to-br from-primary/15 via-background to-background p-6 sm:p-8">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MessageSquare className="h-4 w-4" />
                {t('sms.balanceAvailable')}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-tight text-foreground">
                  {balance.toLocaleString('fr-FR')}
                </span>
                <span className="text-base text-muted-foreground">{t('sms.creditsWord')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('sms.creditExplain')}
              </p>
            </div>
            {verifying && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('sms.validatingPayment')}
              </div>
            )}
          </div>
        </Card>

        {balance < 50 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-400" />
            <div>
              <p className="font-medium">{t('sms.lowBalance')}</p>
              <p className="text-amber-200/80">
                {t('sms.lowBalanceDesc')}
              </p>
            </div>
          </div>
        )}

        {/* Packs */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t('sms.recharge')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('sms.transparentPricing')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {packs.map((pack) => {
              const recommended = recommendedPack?.id === pack.id;
              const perSms = pack.price_eur / pack.credits_amount;
              return (
                <Card
                  key={pack.id}
                  className={cn(
                    'relative flex flex-col overflow-hidden border-white/[0.06] bg-surface/40 p-5 transition-all hover:border-primary/40',
                    recommended && 'border-primary/60 bg-primary/[0.04]',
                  )}
                >
                  {recommended && (
                    <Badge className="absolute right-3 top-3 gap-1 bg-primary text-primary-foreground">
                      <Sparkles className="h-3 w-3" />
                      {t('sms.popular')}
                    </Badge>
                  )}
                  <div className="text-sm font-medium text-muted-foreground">
                    {pack.name}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">
                      {pack.credits_amount.toLocaleString('fr-FR')}
                    </span>
                    <span className="text-sm text-muted-foreground">SMS</span>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-semibold text-foreground">
                      {pack.price_eur.toFixed(2)} €
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('sms.perSmsPrefix')} {perSms.toFixed(3)} € / SMS
                    </div>
                  </div>
                  {pack.description && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {pack.description}
                    </p>
                  )}
                  <div className="mt-auto pt-5">
                    <Button
                      onClick={() => handlePurchase(pack)}
                      disabled={purchasing !== null || true}
                      className="w-full"
                      variant={recommended ? 'default' : 'outline'}
                    >
                      {purchasing === pack.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('sms.redirecting')}
                        </>
                      ) : (
                        t('sms.buy')
                      )}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Trust row */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="flex items-start gap-3 border-white/[0.06] bg-surface/30 p-4">
            <ShieldCheck className="h-5 w-5 flex-shrink-0 text-emerald-400" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('sms.antiFraud')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('sms.antiFraudDesc')}
              </div>
            </div>
          </Card>
          <Card className="flex items-start gap-3 border-white/[0.06] bg-surface/30 p-4">
            <TrendingUp className="h-5 w-5 flex-shrink-0 text-sky-400" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('sms.refundAuto')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('sms.refundAutoDesc')}
              </div>
            </div>
          </Card>
          <Card className="flex items-start gap-3 border-white/[0.06] bg-surface/30 p-4">
            <Check className="h-5 w-5 flex-shrink-0 text-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('sms.noExpiry')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('sms.noExpiryDesc')}
              </div>
            </div>
          </Card>
        </div>

        {/* SMS Campaigns feature card */}
        <Card className="relative overflow-hidden border-white/[0.06] bg-gradient-to-br from-primary/10 via-background to-background p-6">
          <div className="absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />
          <div className="relative">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-base font-semibold text-foreground">{t('sms.campaignsTitle')}</h2>
            </div>

            <p className="mb-5 text-sm text-muted-foreground leading-relaxed">
              {t('sms.campaignsDesc')}
            </p>

            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <Users className="h-4 w-4 shrink-0 text-sky-400" />
                <div>
                  <p className="text-xs font-medium text-foreground">{t('sms.allContacts')}</p>
                  <p className="text-[11px] text-muted-foreground">{t('sms.allContactsDesc')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <CalendarDays className="h-4 w-4 shrink-0 text-violet-400" />
                <div>
                  <p className="text-xs font-medium text-foreground">{t('sms.byEvent')}</p>
                  <p className="text-[11px] text-muted-foreground">{t('sms.byEventDesc')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <Crown className="h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-xs font-medium text-foreground">{t('sms.vipClients')}</p>
                  <p className="text-[11px] text-muted-foreground">{t('sms.vipClientsDesc')}</p>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              className="gap-2 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
              onClick={() => navigate('/owner/sms-campaigns')}
            >
              {t('sms.designCampaign')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        {/* Transactions */}
        <Card className="border-white/[0.06] bg-surface/40">
          <div className="flex items-center justify-between p-5 pb-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                {t('sms.recentHistory')}
              </h3>
            </div>
            <span className="text-xs text-muted-foreground">
              {transactions.length} {t('sms.movements')}
            </span>
          </div>
          <Separator className="bg-white/[0.04]" />
          {transactions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t('sms.noMovements')}
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {transactions.map((tx) => {
                const meta = TYPE_META[tx.type];
                const sign = tx.amount > 0 ? '+' : '';
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-medium', meta.tone)}>
                          {t(meta.label)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleString(language, {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {tx.notes && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {tx.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div
                        className={cn(
                          'text-sm font-semibold',
                          tx.amount > 0 ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {sign}
                        {tx.amount}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {t('sms.balancePrefix')} {tx.balance_after}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
