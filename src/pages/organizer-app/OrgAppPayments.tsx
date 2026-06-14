import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Banknote, Clock, Receipt } from 'lucide-react';
import { OrgStripeConnectCard } from '@/components/organizer-app/OrgStripeConnectCard';
import { OrgPage, OrgPageHeader, OrgCard, T1, T2, T3, RED, BORDER, INNER_BG } from '@/components/org-ui';

/**
 * Dedicated payments page for organizers — manages the Stripe Connect account in isolation
 * (status, onboarding, dashboard access). Also the landing target for the Stripe onboarding
 * return flow: the edge function's return_url is `/organizer-app/settings?stripe=...`, which is
 * routed here, so we keep handling that query param.
 */
export default function OrgAppPayments() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'success') {
      toast.success(t('Onboarding Stripe terminé', 'Stripe onboarding complete'));
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('stripe') === 'refresh') {
      toast.info(t('Reprenez votre onboarding Stripe', 'Resume your Stripe onboarding'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [language]);

  const facts: { icon: typeof Banknote; title: string; desc: string }[] = [
    {
      icon: Banknote,
      title: t('Vous êtes payé directement', 'You get paid directly'),
      desc: t(
        "L'argent des billets arrive sur votre compte Stripe, puis sur votre compte bancaire. Yuno ne touche jamais vos fonds.",
        'Ticket money lands in your Stripe account, then your bank account. Yuno never holds your funds.',
      ),
    },
    {
      icon: Clock,
      title: t('Virements automatiques', 'Automatic payouts'),
      desc: t(
        'Stripe verse vos revenus sur votre compte bancaire selon le calendrier défini dans votre dashboard Stripe.',
        'Stripe pays out your revenue to your bank account on the schedule set in your Stripe dashboard.',
      ),
    },
    {
      icon: Receipt,
      title: t('Frais de service Yuno', 'Yuno service fee'),
      desc: t(
        'Yuno applique 4 % de frais de service sur la billetterie (min. 0,99 €), prélevés automatiquement à chaque vente.',
        'Yuno applies a 4% service fee on ticketing (min. €0.99), deducted automatically on each sale.',
      ),
    },
  ];

  return (
    <OrgPage className="mx-auto max-w-2xl">
      <OrgPageHeader
        title={t('Paiements', 'Payments')}
        subtitle={t('Gérez votre compte Stripe et vos virements en toute autonomie.', 'Manage your Stripe account and payouts independently.')}
      />

      <div className="space-y-4">
        <OrgStripeConnectCard userId={user?.id} />

        <OrgCard style={{ padding: 24 }}>
          <h3 className="mb-3" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            {t('Comment ça marche', 'How it works')}
          </h3>
          <div className="space-y-3">
            {facts.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(232,25,44,0.1)' }}>
                  <Icon className="h-4 w-4" style={{ color: RED }} />
                </div>
                <div>
                  <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{title}</p>
                  <p className="mt-0.5" style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3" style={{ color: T3, fontSize: 11.5 }}>
            {t(
              'Pour modifier votre IBAN, vos coordonnées bancaires ou votre calendrier de virement, ouvrez votre dashboard Stripe ci-dessus.',
              'To change your IBAN, bank details or payout schedule, open your Stripe dashboard above.',
            )}
          </p>
        </OrgCard>
      </div>
    </OrgPage>
  );
}
