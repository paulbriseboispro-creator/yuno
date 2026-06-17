import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { CreditCard, ShieldCheck, Zap, ExternalLink, Check, type LucideIcon } from 'lucide-react';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, DoneRow, RED, POS, T1, T2, T3, BORDER } from '@/components/onboarding/onboardingUI';

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip?: () => void;
}

export function OrgOnboardingStepStripe({ userId, onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { canSell, status, loading, startOnboarding, openDashboard } = useOrganizerStripe(userId);

  return (
    <div className="space-y-6">
      <StepHeader
        icon={CreditCard}
        title={tt('Activer les paiements', 'Activate payments', 'Activar los pagos')}
        subtitle={tt(
          'Connectez Stripe pour vendre des billets. Les revenus arrivent directement sur votre compte bancaire.',
          'Connect Stripe to sell tickets. Revenue lands directly in your bank account.',
          'Conecta Stripe para vender entradas. Los ingresos llegan directamente a tu cuenta bancaria.',
        )}
      />

      <div className="grid sm:grid-cols-3 gap-2.5">
        <Benefit icon={Zap} title={tt('Versements rapides', 'Fast payouts', 'Pagos rápidos')} desc={tt('Reçus en J+2 sur votre IBAN.', 'Settled in 2 days to your IBAN.', 'Recibidos en 2 días en tu IBAN.')} />
        <Benefit icon={ShieldCheck} title={tt('Sécurisé Stripe', 'Stripe-secured', 'Protegido por Stripe')} desc={tt('Conformité PCI & 3DS.', 'PCI & 3DS handled.', 'Conformidad PCI y 3DS.')} />
        <Benefit icon={CreditCard} title={tt('Apple Pay & cartes', 'Apple Pay & cards', 'Apple Pay y tarjetas')} desc={tt('Tous les moyens de paiement.', 'All payment methods.', 'Todos los métodos de pago.')} />
      </div>

      <div className="rounded-xl" style={{ padding: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
        <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>
          {tt(
            'Frais Yuno : max(0,99 € ; 4 %) par billet vendu. Frais Stripe : 1,5 % + 0,25 €. Tout est transparent et déduit avant versement.',
            'Yuno fee: max(€0.99; 4%) per ticket sold. Stripe fee: 1.5% + €0.25. Fully transparent, deducted before payout.',
            'Comisión Yuno: máx(0,99 € ; 4 %) por entrada vendida. Comisión Stripe: 1,5 % + 0,25 €. Todo transparente y deducido antes del pago.',
          )}
        </p>
      </div>

      {canSell ? (
        <DoneRow>
          <Check className="w-5 h-5 flex-none" style={{ color: POS }} />
          <div className="flex-1 min-w-0">
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{tt('Stripe connecté', 'Stripe connected', 'Stripe conectado')}</p>
            <p style={{ color: T3, fontSize: 12, marginTop: 1 }}>{tt('Vous pouvez vendre dès maintenant.', 'You can start selling right now.', 'Ya puedes vender ahora mismo.')}</p>
          </div>
          <button
            onClick={openDashboard}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium cursor-pointer transition-opacity hover:opacity-80 flex-none"
            style={{ color: T2 }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {tt('Dashboard', 'Dashboard', 'Panel')}
          </button>
        </DoneRow>
      ) : status === 'pending' ? (
        <div className="rounded-xl" style={{ padding: '12px 14px', background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.22)' }}>
          <p style={{ color: '#FCD34D', fontSize: 13.5, fontWeight: 600 }}>{tt('Onboarding incomplet', 'Onboarding incomplete', 'Configuración incompleta')}</p>
          <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{tt('Reprenez votre configuration Stripe pour pouvoir vendre.', 'Resume your Stripe setup to start selling.', 'Reanuda tu configuración de Stripe para poder vender.')}</p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {!canSell ? (
          <>
            <PrimaryButton fullWidth icon={CreditCard} onClick={startOnboarding} loading={loading}>
              {status === 'pending' ? tt('Reprendre Stripe', 'Resume Stripe', 'Reanudar Stripe') : tt('Connecter Stripe', 'Connect Stripe', 'Conectar Stripe')}
            </PrimaryButton>
            {onSkip && (
              <GhostButton fullWidth onClick={onSkip}>
                {tt('Configurer plus tard', 'Set up later', 'Configurar más tarde')}
              </GhostButton>
            )}
            <p style={{ color: T3, fontSize: 11, textAlign: 'center', lineHeight: 1.45 }}>
              {tt(
                'Activable à tout moment depuis Réglages. La vente de billets nécessite Stripe.',
                'Activate anytime from Settings. Ticket sales require Stripe.',
                'Se puede activar en cualquier momento desde Ajustes. La venta de entradas requiere Stripe.',
              )}
            </p>
          </>
        ) : (
          <PrimaryButton fullWidth onClick={onComplete}>
            {tt('Continuer', 'Continue', 'Continuar')}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function Benefit({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <InnerCard style={{ padding: '12px 14px' }}>
      <Icon className="w-4 h-4 mb-2" style={{ color: RED }} />
      <div style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{title}</div>
      <div style={{ color: T3, fontSize: 11, marginTop: 2, lineHeight: 1.35 }}>{desc}</div>
    </InnerCard>
  );
}
