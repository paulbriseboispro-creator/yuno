import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeftRight, Banknote, Zap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { STRIPE_AUTO_SPLIT_ENABLED, collectorForcedToVenue, readSettlement } from '@/lib/splitRules';
import type { CollabSettlement } from '@/hooks/useOrganizerPartnerships';

/**
 * LA question du contrat collab : « Répartir l'argent automatiquement via
 * Stripe ? ». Un OUI et un NON clairs, jamais une case cachée — Stripe ne doit
 * jamais être la condition d'une collaboration.
 *
 *  • Oui : Stripe partage chaque vente (les deux parties ont un compte Stripe).
 *  • Non : UNE partie encaisse tout (seule elle a besoin de Stripe), Yuno suit
 *    la part de chacun vente par vente, fige le décompte 48 h après la soirée,
 *    puis l'encaisseur vire la part de l'autre — IBAN, « J'ai viré », « Bien
 *    reçu », relances et arbitrage, comme le règlement promoteur.
 *
 * Barème ou tables au total dépensé : l'encaisseur est forcément le club (le bar
 * en caisse est chez lui, le décompte part de ses chiffres) — miroir de
 * `readSettlement` / `normalize_collab_settlement`.
 */
export function SettlementModeSwitch({ value, onChange, rules, disabled }: {
  value: CollabSettlement | null | undefined;
  onChange: (s: CollabSettlement) => void;
  /** Les règles en cours d'édition : décident si l'encaisseur est forcé au club. */
  rules?: Record<string, unknown> | null;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const current = readSettlement({ ...(rules ?? {}), settlement: value ?? { mode: 'stripe' } });
  const isTransfer = current.mode === 'transfer';
  const forcedVenue = collectorForcedToVenue(rules);
  const collector = isTransfer ? (current as { collector: 'venue' | 'organizer' }).collector : 'venue';
  const terms = isTransfer ? (current as { payment_terms_days: 7 | 15 | 30 }).payment_terms_days : 15;

  const setTransfer = (patch: Partial<CollabSettlement>) =>
    onChange({ mode: 'transfer', collector, payment_terms_days: terms, ...patch });

  // Partage Stripe automatique éteint (STRIPE_AUTO_SPLIT_ENABLED) : un contrat
  // en cours d'édition bascule de lui-même en virement, pour qu'aucune soirée ne
  // signe un mode que les checkouts refuseraient ensuite.
  // Le parent passe souvent une fonction recréée à chaque rendu : on la garde
  // dans une ref pour que la bascule ne se déclenche qu'une fois par état.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!STRIPE_AUTO_SPLIT_ENABLED && !disabled && !isTransfer) {
      onChangeRef.current({ mode: 'transfer', collector, payment_terms_days: terms });
    }
  }, [disabled, isTransfer, collector, terms]);

  const choice = (active: boolean, onClick: () => void, icon: ReactNode, label: string, hint: string, testId: string, off = false) => (
    <button
      type="button" disabled={disabled || off} onClick={onClick} data-testid={testId} aria-pressed={active}
      className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/40'} ${disabled || off ? 'opacity-60' : ''} ${off ? 'cursor-not-allowed' : ''}`}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">{icon}{label}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </button>
  );

  const pill = (active: boolean, onClick: () => void, label: string, off?: boolean) => (
    <button
      type="button" disabled={disabled || off} onClick={onClick} aria-pressed={active}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40'} ${off ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2.5" data-testid="settlement-switch">
      <p className="text-xs font-semibold text-foreground">
        {t("Répartir l'argent automatiquement via Stripe ?", 'Split the money automatically through Stripe?', '¿Repartir el dinero automáticamente con Stripe?')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {choice(!isTransfer, () => onChange({ mode: 'stripe' }), <Zap className="h-3.5 w-3.5" />,
          t('Oui, Stripe partage chaque vente', 'Yes, Stripe splits every sale', 'Sí, Stripe reparte cada venta'),
          STRIPE_AUTO_SPLIT_ENABLED
            ? t('Chacun reçoit sa part sur son compte Stripe, sans rien faire. Les deux parties doivent avoir un compte Stripe actif.',
              'Each party gets their share on their Stripe account, hands-free. Both parties need an active Stripe account.',
              'Cada parte recibe su parte en su cuenta de Stripe, sin hacer nada. Ambas partes necesitan una cuenta de Stripe activa.')
            : t('Pas encore disponible : chaque vente est encaissée par une seule partie, sur son propre compte Stripe.',
              'Not available yet: each sale is collected by a single party, on its own Stripe account.',
              'Aún no disponible: cada venta la cobra una sola parte, en su propia cuenta de Stripe.'),
          'settlement-stripe', !STRIPE_AUTO_SPLIT_ENABLED)}
        {choice(isTransfer, () => setTransfer({}), <ArrowLeftRight className="h-3.5 w-3.5" />,
          t("Non, une partie encaisse et paie l'autre", 'No, one party collects and pays the other', 'No, una parte cobra y paga a la otra'),
          t("Seul l'encaisseur a besoin de Stripe. Yuno suit la part de chacun et prépare le virement de fin de soirée.",
            'Only the collecting party needs Stripe. Yuno tracks each share and prepares the end-of-night transfer.',
            'Solo quien cobra necesita Stripe. Yuno sigue la parte de cada uno y prepara la transferencia del final de la noche.'),
          'settlement-transfer')}
      </div>

      {isTransfer && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('Qui encaisse les ventes ?', 'Who collects the sales?', '¿Quién cobra las ventas?')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {pill(collector === 'venue', () => setTransfer({ collector: 'venue' }), t('Le club', 'The club', 'El club'))}
              {pill(collector === 'organizer', () => setTransfer({ collector: 'organizer' }), t("L'organisateur", 'The organizer', 'El organizador'), forcedVenue)}
            </div>
            {forcedVenue && (
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                {t('Barème ou tables au total dépensé : le club encaisse, car le bar et les extras passent par sa caisse.',
                  'Tiers or tables on total spend: the club collects, since the bar and extras go through its till.',
                  'Escala o mesas sobre el gasto total: cobra el club, porque la barra y los extras pasan por su caja.')}
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("Délai pour virer la part de l'autre", "Deadline to transfer the other party's share", 'Plazo para transferir la parte del otro')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {([7, 15, 30] as const).map((d) => pill(terms === d, () => setTransfer({ payment_terms_days: d }), t(`${d} jours`, `${d} days`, `${d} días`)))}
            </div>
          </div>
          <ol className="space-y-1 text-[11px] leading-snug text-muted-foreground">
            <li>1. {t('Chaque vente enregistre la part prévue au contrat.', 'Every sale records the share set in the agreement.', 'Cada venta registra la parte prevista en el contrato.')}</li>
            <li>2. {t('48 h après la soirée, le décompte est figé (remboursements déduits).', '48 h after the night, the statement is frozen (refunds deducted).', '48 h después de la noche, la liquidación se congela (reembolsos descontados).')}</li>
            <li>3. {t("L'encaisseur vire la part de l'autre avant l'échéance, l'autre confirme « Bien reçu ». Relances automatiques, et Yuno arbitre en cas de litige.",
              'The collector transfers the other share before the deadline, the other confirms "Received". Automatic reminders, and Yuno arbitrates any dispute.',
              'Quien cobra transfiere la parte del otro antes del plazo, el otro confirma «Recibido». Recordatorios automáticos, y Yuno arbitra en caso de disputa.')}</li>
          </ol>
        </div>
      )}
    </div>
  );
}

/** Une ligne de récapitulatif du mode de règlement (bandeau, contrat, avenant). */
export function SettlementRecap({ rules, className }: { rules: unknown; className?: string }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const s = readSettlement(rules);
  if (s.mode !== 'transfer') {
    return (
      <p className={`flex items-start gap-1.5 text-[11px] text-muted-foreground ${className ?? ''}`} data-testid="settlement-recap">
        <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t('Répartition automatique via Stripe.', 'Automatic split through Stripe.', 'Reparto automático con Stripe.')}
      </p>
    );
  }
  const who = s.collector === 'organizer' ? t("l'organisateur", 'the organizer', 'el organizador') : t('le club', 'the club', 'el club');
  return (
    <p className={`flex items-start gap-1.5 text-[11px] text-muted-foreground ${className ?? ''}`} data-testid="settlement-recap">
      <Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {t(
        `Sans partage Stripe : ${who} encaisse tout, puis vire la part de l'autre sous ${s.payment_terms_days} jours après le décompte (figé 48 h après la soirée).`,
        `No Stripe split: ${who} collects everything, then transfers the other share within ${s.payment_terms_days} days of the statement (frozen 48 h after the night).`,
        `Sin reparto con Stripe: ${who} cobra todo y transfiere la parte del otro en ${s.payment_terms_days} días tras la liquidación (congelada 48 h después de la noche).`,
      )}
    </p>
  );
}
