import { useCallback, useEffect, useState } from 'react';
import { Mail, MessageSquare, Megaphone, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface SubscriptionRow {
  scope_type: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  scope_name: string;
  email_opted_in: boolean;
  sms_opted_in: boolean;
  since: string | null;
}

/**
 * « Mes abonnements » — un club par ligne, un retrait par canal.
 *
 * Le checkout permet déjà de se retirer pour le club en cours (EDPB 05/2020
 * §114 : le retrait doit être possible dans l'interface où le consentement a
 * été donné). Cet écran couvre les autres : sans lui, se désabonner d'un club
 * où l'on ne réserve plus supposerait de rouvrir son checkout, ce qui n'est pas
 * « aussi simple que de donner » son consentement (art. 7(3) RGPD). Le droit
 * d'opposition à la prospection est par ailleurs absolu (art. 21(2)).
 */
export function MarketingSubscriptions() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_marketing_subscriptions');
    if (error) {
      console.error('[marketing-subscriptions] chargement impossible', error);
      setRows([]);
    } else {
      setRows((data ?? []) as SubscriptionRow[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async (row: SubscriptionRow, channel: 'email' | 'sms') => {
    const key = `${row.venue_id ?? row.organizer_user_id}:${channel}`;
    setBusyKey(key);
    const { error } = await supabase.rpc('withdraw_my_marketing_consent', {
      p_channel: channel,
      p_venue_id: row.venue_id,
      p_organizer_user_id: row.organizer_user_id,
      p_wording_text: `${row.scope_name} — ${channel}`,
      p_locale: null,
      p_source: 'account_settings',
    });
    setBusyKey(null);

    if (error) {
      console.error('[marketing-subscriptions] retrait impossible', error);
      toast.error(t('consent.withdrawFailed'));
      return;
    }
    toast.success(t('consent.unsubscribed'));
    await load();
  };

  // Rien à afficher tant que la personne n'a accepté nulle part : une carte
  // vide « vous n'avez aucun abonnement » n'apprend rien et alourdit l'écran.
  if (!user || (!loading && rows.length === 0)) return null;

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Megaphone className="h-4 w-4" />
          {t('consent.mySubscriptions')}
        </div>
        <p className="text-xs text-muted-foreground">{t('consent.mySubscriptionsHint')}</p>

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {rows.map((row) => (
              <div key={row.venue_id ?? row.organizer_user_id} className="py-3 space-y-2">
                <div className="text-sm font-medium">{row.scope_name}</div>
                <div className="flex flex-wrap gap-2">
                  {row.email_opted_in && (
                    <ChannelChip
                      icon={<Mail className="h-3.5 w-3.5" />}
                      label={t('consent.channelEmail')}
                      busy={busyKey === `${row.venue_id ?? row.organizer_user_id}:email`}
                      onWithdraw={() => withdraw(row, 'email')}
                      withdrawLabel={t('consent.unsubscribe')}
                    />
                  )}
                  {row.sms_opted_in && (
                    <ChannelChip
                      icon={<MessageSquare className="h-3.5 w-3.5" />}
                      label={t('consent.channelSms')}
                      busy={busyKey === `${row.venue_id ?? row.organizer_user_id}:sms`}
                      onWithdraw={() => withdraw(row, 'sms')}
                      withdrawLabel={t('consent.unsubscribe')}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelChip({
  icon,
  label,
  busy,
  onWithdraw,
  withdrawLabel,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onWithdraw: () => void;
  withdrawLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{icon}</span>
      {label}
      <button
        type="button"
        onClick={onWithdraw}
        disabled={busy}
        className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : withdrawLabel}
      </button>
    </span>
  );
}
