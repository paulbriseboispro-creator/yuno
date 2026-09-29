import { CreditCard, Check, AlertCircle, ExternalLink, Loader2, ShieldCheck, Banknote, Receipt, Lock } from 'lucide-react';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, OrgButton, OrgPill, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { useConnectCountry } from '@/hooks/useConnectCountry';
import { StripeAccountCountry, StripeCountryField } from '@/components/stripe/StripeCountryField';

export function OrgStripeConnectCard({ userId }: { userId: string | null | undefined }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { status, chargesEnabled, payoutsEnabled, country, loading, startingOnboarding, startOnboarding, openDashboard, refresh } =
    useOrganizerStripe(userId);
  // Pays du compte à ouvrir : lu seulement tant qu'aucun compte n'existe (il est figé ensuite).
  const connectCountry = useConnectCountry({ kind: 'organizer', userId }, !loading && status === 'none' && !chargesEnabled);

  if (loading) {
    return (
      <OrgCard className="flex items-center justify-center" style={{ padding: 24 }}>
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
      </OrgCard>
    );
  }

  // « Actif » = l'encaissement est ouvert : c'est ce qui permet de vendre. Les
  // virements peuvent suivre (IBAN en vérification) — signalé à part.
  const isActive = chargesEnabled;
  const isNone = !chargesEnabled && status === 'none';
  const isRestricted = !chargesEnabled && status === 'restricted';
  const isPending = !chargesEnabled && !isNone && !isRestricted;

  return (
    <OrgCard style={{ padding: 24 }}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(232,25,44,0.1)' }}
        >
          <CreditCard className="h-5 w-5" style={{ color: RED }} />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
              {t('Paiements (Stripe Connect)', 'Payments (Stripe Connect)')}
            </h3>
            {isActive && (
              <OrgPill tone="success" dot>
                {t('Actif', 'Active')}
              </OrgPill>
            )}
            {isPending && <OrgPill tone="warn">{t('En attente', 'Pending')}</OrgPill>}
            {isNone && <OrgPill tone="muted">{t('Non configuré', 'Not configured')}</OrgPill>}
            {isRestricted && <OrgPill tone="danger">{t('Restreint', 'Restricted')}</OrgPill>}
          </div>
          <p style={{ color: T3, fontSize: 12.5, marginTop: 4 }}>
            {t(
              'Recevez les paiements de vos billets directement sur votre compte bancaire.',
              'Receive ticket payments directly to your bank account.',
            )}
          </p>
        </div>
      </div>

      {isNone && (
        <div className="mt-4 space-y-3 rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--acc-fcd34d)' }} />
            <p style={{ color: T2, fontSize: 12.5 }}>
              {t(
                'Vous devez activer Stripe pour vendre des billets. Formulaire sécurisé, quelques minutes.',
                'You must activate Stripe to sell tickets. Secure form, a few minutes.',
                'Debes activar Stripe para vender entradas. Formulario seguro, unos minutos.',
              )}
            </p>
          </div>
          <StripeCountryField choice={connectCountry} />
          <OrgButton
            variant="primary"
            onClick={() => startOnboarding({ country: connectCountry.country })}
            disabled={startingOnboarding || !connectCountry.canCreate}
          >
            {startingOnboarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            {t('Activer les paiements', 'Activate payments', 'Activar los pagos')}
          </OrgButton>
        </div>
      )}

      {(isPending || isRestricted) && (
        <div
          className="mt-4 space-y-3 rounded-xl p-4"
          style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--acc-fcd34d)' }} />
            <p style={{ color: T2, fontSize: 12.5 }}>
              {isRestricted
                ? t(
                  'Stripe attend encore une information ou un document avant d\'ouvrir la vente. Complétez le formulaire.',
                  'Stripe still needs some information or a document before selling can start. Complete the form.',
                  'Stripe aún necesita un dato o un documento antes de abrir la venta. Completa el formulario.',
                )
                : t(
                  'Onboarding incomplet. Terminez les vérifications Stripe pour activer la vente. Si vous venez de finir, Stripe peut prendre quelques minutes : actualisez.',
                  'Onboarding incomplete. Finish Stripe verifications to enable selling. If you just finished, Stripe can take a few minutes: refresh.',
                  'Configuración incompleta. Termina las verificaciones de Stripe para activar la venta. Si acabas de terminar, Stripe puede tardar unos minutos: actualiza.',
                )}
            </p>
          </div>
          <StripeAccountCountry country={country} />
          <div className="flex flex-wrap gap-2">
            <OrgButton variant="primary" size="sm" onClick={() => startOnboarding()} disabled={startingOnboarding}>
              {startingOnboarding && <Loader2 className="h-4 w-4 animate-spin" />}
              {isRestricted ? t('Compléter', 'Complete', 'Completar') : t('Reprendre', 'Resume')}
            </OrgButton>
            <OrgButton variant="ghost" size="sm" onClick={refresh}>
              {t('Actualiser', 'Refresh')}
            </OrgButton>
          </div>
        </div>
      )}

      {isActive && (
        <div className="mt-4 space-y-3">
          {!payoutsEnabled && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}>
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--acc-fcd34d)' }} />
              <p style={{ color: T2, fontSize: 12 }}>
                {t(
                  'Vous pouvez vendre. Stripe vérifie encore votre compte bancaire : les virements partiront dès que c\'est fait.',
                  'You can sell. Stripe is still verifying your bank account: payouts will start as soon as it is done.',
                  'Ya puedes vender. Stripe aún verifica tu cuenta bancaria: las transferencias saldrán en cuanto termine.',
                )}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
            >
              <Check className="h-3.5 w-3.5" style={{ color: 'var(--acc-34d399)' }} />
              {t('Encaissement', 'Charges')}
            </div>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
            >
              {payoutsEnabled ? (
                <Check className="h-3.5 w-3.5" style={{ color: 'var(--acc-34d399)' }} />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" style={{ color: 'var(--acc-fcd34d)' }} />
              )}
              {t('Virements', 'Payouts')}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <OrgButton variant="secondary" size="sm" onClick={openDashboard}>
              <ExternalLink className="h-4 w-4" />
              {t('Dashboard Stripe', 'Stripe dashboard')}
            </OrgButton>
            {!payoutsEnabled && (
              <OrgButton variant="ghost" size="sm" onClick={() => startOnboarding()} disabled={startingOnboarding}>
                {t('Compléter', 'Complete', 'Completar')}
              </OrgButton>
            )}
            <OrgButton variant="ghost" size="sm" onClick={refresh}>
              {t('Actualiser', 'Refresh')}
            </OrgButton>
          </div>
          <p style={{ color: T3, fontSize: 11.5 }}>
            {t(
              'Le tableau de bord Stripe s\'ouvre sur dashboard.stripe.com : connectez-vous avec l\'e-mail et le mot de passe choisis pendant l\'activation.',
              'The Stripe dashboard opens on dashboard.stripe.com: sign in with the email and password you chose during activation.',
              'El panel de Stripe se abre en dashboard.stripe.com: inicia sesión con el correo y la contraseña elegidos durante la activación.',
            )}
          </p>
        </div>
      )}

      {/* About Stripe — reassurance for organizers new to Stripe */}
      <div className="mt-4 space-y-3 rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'rgba(99,91,255,0.14)' }}
          >
            <Lock className="h-3.5 w-3.5" style={{ color: 'var(--acc-8b85ff)' }} />
          </div>
          <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
            {t('Qu\'est-ce que Stripe ?', 'What is Stripe?')}
          </p>
        </div>
        <p style={{ color: T2, fontSize: 12, lineHeight: 1.55 }}>
          {t(
            'Stripe est l\'une des plus grandes et des plus fiables sociétés de paiement au monde. Elle gère en toute sécurité les paiements en ligne de millions d\'entreprises, du commerce de quartier à Amazon, Google et Shopify. Yuno utilise Stripe pour que vos clients paient en sécurité et que vous soyez payé de façon fiable.',
            'Stripe is one of the world\'s largest and most trusted payment companies. It securely handles online payments for millions of businesses, from local shops to Amazon, Google and Shopify. Yuno uses Stripe so your customers pay safely and you get paid reliably.',
          )}
        </p>
        <div className="space-y-2.5 pt-0.5">
          {[
            {
              icon: ShieldCheck,
              color: 'var(--acc-34d399)',
              title: t('Votre argent est en sécurité', 'Your money is safe'),
              desc: t(
                'Stripe est un établissement de paiement agréé et réglementé en Europe et aux États-Unis, avec une sécurité de niveau bancaire (certifié PCI-DSS). Les données de carte sont chiffrées et ne passent jamais par Yuno.',
                'Stripe is a licensed, regulated payment institution in Europe and the US, with bank-level security (PCI-DSS certified). Card details are encrypted and never pass through Yuno.',
              ),
            },
            {
              icon: Banknote,
              color: 'var(--acc-60a5fa)',
              title: t('Virements automatiques vers votre banque', 'Automatic transfers to your bank'),
              desc: t(
                'Après chaque vente, vos gains sont automatiquement virés sur votre propre compte bancaire, généralement sous quelques jours ouvrés. Aucune demande manuelle, vous n\'attendez pas après nous.',
                'After each sale, your earnings are automatically transferred to your own bank account, typically within a few business days. No manual request, no waiting on us.',
              ),
            },
            {
              icon: Receipt,
              color: T2,
              title: t('Pourquoi y a-t-il des frais ?', 'Why are there fees?'),
              desc: t(
                'Chaque paiement par carte entraîne de petits frais de traitement prélevés par Stripe (1,5% + 0,25€ par transaction). Ils couvrent le traitement sécurisé, la protection anti-fraude et les réseaux bancaires. Stripe prélève ses frais automatiquement, puis le reste vous est versé.',
                'Every card payment carries a small processing fee charged by Stripe (1.5% + €0.25 per transaction). It covers secure processing, fraud protection and the bank networks. Stripe deducts its fee automatically, then the rest is paid out to you.',
              ),
            },
          ].map(({ icon: Icon, color, title, desc }, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
              <div>
                <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{title}</p>
                <p style={{ color: T3, fontSize: 12, lineHeight: 1.5, marginTop: 1 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t pt-3" style={{ borderColor: BORDER }}>
        <p style={{ color: T3, fontSize: 11.5 }}>
          {t(
            'Yuno applique 4 % de frais de service sur la billetterie. Les paiements arrivent directement sur votre compte.',
            'Yuno applies a 4% service fee on ticketing. Payments arrive directly to your account.',
          )}
        </p>
      </div>
    </OrgCard>
  );
}
