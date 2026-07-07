import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronDown, ChevronRight, Rocket,
  ArrowRight, SkipForward, Minimize2, Maximize2,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerOnboarding } from '@/hooks/useOwnerOnboarding';
import { SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';

const RED = '#E8192C';
const GREEN = '#22c55e';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.65)';
const T3 = 'rgba(255,255,255,0.38)';
const BORDER = 'rgba(255,255,255,0.08)';
const BG = '#0a0a0c';

// ─── Step definitions ─────────────────────────────────────────────────────────

interface StepDef {
  key: string;
  optional?: boolean;
  page: string;
  title: { fr: string; en: string; es: string };
  desc: { fr: string; en: string; es: string };
  actions: { fr: string; en: string; es: string }[];
  ctaLabel: { fr: string; en: string; es: string };
}

const STEPS: StepDef[] = [
  {
    key: '1',
    page: '/owner/onboarding',
    title: { fr: 'Choisir vos piliers Yuno', en: 'Choose your Yuno pillars', es: 'Elige tus pilares Yuno' },
    desc: {
      fr: "Yuno couvre trois piliers : la billetterie (vente en ligne + QR check-in), les tables VIP (réservation + bouteilles), et les boissons (commande depuis le téléphone). Activez ceux qui correspondent à votre établissement.",
      en: "Yuno covers three pillars: ticketing (online sales + QR check-in), VIP tables (booking + bottles), and drinks (order from phone). Enable the ones that match your venue.",
      es: "Yuno cubre tres pilares: entradas (venta online + QR), mesas VIP (reserva + botellas) y bebidas (pedido desde móvil). Activa los que corresponden a tu local.",
    },
    actions: [
      { fr: 'Billetterie — vente de billets en ligne', en: 'Ticketing — sell tickets online', es: 'Entradas — venta online' },
      { fr: 'Tables VIP — réservation avec package bouteilles', en: 'VIP tables — booking with bottle packages', es: 'Mesas VIP — reserva con botellas' },
      { fr: 'Boissons — commande depuis le téléphone', en: 'Drinks — order from phone', es: 'Bebidas — pedido desde el móvil' },
    ],
    ctaLabel: { fr: 'Choisir mes piliers', en: 'Choose my pillars', es: 'Elegir mis pilares' },
  },
  {
    key: '2',
    page: '/owner/venue',
    title: { fr: 'Informations de l\'établissement', en: 'Venue information', es: 'Información del establecimiento' },
    desc: {
      fr: "Renseignez les informations de base de votre établissement. Ces données sont affichées sur votre profil public et utilisées pour facturer correctement.",
      en: "Fill in your venue's basic information. This data appears on your public profile and is used for correct billing.",
      es: "Rellena la información básica de tu local. Estos datos aparecen en tu perfil público y se usan para facturar correctamente.",
    },
    actions: [
      { fr: 'Nom et adresse de l\'établissement', en: 'Venue name and address', es: 'Nombre y dirección del local' },
      { fr: 'Ville', en: 'City', es: 'Ciudad' },
      { fr: 'Informations légales (SIRET / raison sociale)', en: 'Legal info (registration no.)', es: 'Información legal' },
    ],
    ctaLabel: { fr: 'Compléter les infos', en: 'Complete venue info', es: 'Completar información' },
  },
  {
    key: '3',
    page: '/owner/events',
    title: { fr: 'Configurer votre offre', en: 'Set up your offer', es: 'Configurar tu oferta' },
    desc: {
      fr: "Créez le contenu qui correspond aux piliers que vous avez choisis. Un événement pour la billetterie et les tables VIP, une carte boissons pour le bar.",
      en: "Create the content that matches your chosen pillars. An event for ticketing and VIP tables, a drinks menu for the bar.",
      es: "Crea el contenido que corresponde a tus pilares. Un evento para entradas y mesas VIP, una carta para el bar.",
    },
    actions: [
      { fr: 'Créer un événement (billets ou tables VIP)', en: 'Create an event (tickets or VIP tables)', es: 'Crear un evento (entradas o mesas VIP)' },
      { fr: 'Configurer la carte des boissons', en: 'Set up the drinks menu', es: 'Configurar la carta de bebidas' },
    ],
    ctaLabel: { fr: 'Créer un événement', en: 'Create an event', es: 'Crear un evento' },
  },
  {
    key: '4',
    page: '/owner/venue',
    optional: true,
    title: { fr: 'Image de marque', en: 'Branding', es: 'Imagen de marca' },
    desc: {
      fr: "Une belle page établissement attire plus de clients. Ajoutez une photo de couverture, une description et vos réseaux sociaux pour vous démarquer.",
      en: "A great venue page attracts more customers. Add a cover photo, description and social media links to stand out.",
      es: "Una buena página de local atrae más clientes. Añade foto de portada, descripción y redes sociales para destacar.",
    },
    actions: [
      { fr: 'Photo de couverture', en: 'Cover photo', es: 'Foto de portada' },
      { fr: 'Description et ambiance du club', en: 'Club description and vibe', es: 'Descripción y ambiente del club' },
      { fr: 'Instagram, Facebook, TikTok', en: 'Instagram, Facebook, TikTok', es: 'Instagram, Facebook, TikTok' },
    ],
    ctaLabel: { fr: "Enrichir l'image de marque", en: 'Enhance branding', es: 'Mejorar imagen' },
  },
  {
    key: '5',
    page: '/owner/staff',
    optional: true,
    title: { fr: 'Votre équipe', en: 'Your team', es: 'Tu equipo' },
    desc: {
      fr: "Invitez votre staff opérationnel. Chaque rôle a son interface dédiée sur téléphone : bouncer pour les entrées, barman pour les commandes, hôte VIP pour les tables.",
      en: "Invite your operational staff. Each role has a dedicated phone interface: bouncer for entry, bartender for orders, VIP host for tables.",
      es: "Invita a tu personal. Cada rol tiene su interfaz dedicada: portero para entradas, barman para pedidos, anfitrión VIP para mesas.",
    },
    actions: [
      { fr: 'Inviter un bouncer (contrôle des entrées)', en: 'Invite a bouncer (entry control)', es: 'Invitar un portero' },
      { fr: 'Inviter un barman (commandes boissons)', en: 'Invite a bartender (drink orders)', es: 'Invitar un barman' },
      { fr: 'Inviter un hôte VIP (accueil tables)', en: 'Invite a VIP host (table welcome)', es: 'Invitar anfitrión VIP' },
    ],
    ctaLabel: { fr: 'Gérer le staff', en: 'Manage staff', es: 'Gestionar personal' },
  },
  {
    key: '6',
    page: '/owner/billing',
    title: { fr: 'Connecter Stripe', en: 'Connect Stripe', es: 'Conectar Stripe' },
    desc: {
      fr: "Stripe vous permet de recevoir les paiements directement sur votre compte bancaire. Sans Stripe connecté, les ventes de billets et tables VIP sont désactivées.",
      en: "Stripe lets you receive payments directly to your bank account. Without Stripe, ticket and VIP table sales are disabled.",
      es: "Stripe te permite recibir pagos directamente en tu cuenta bancaria. Sin Stripe, las ventas de entradas y mesas VIP están desactivadas.",
    },
    actions: [
      { fr: 'Créer ou connecter votre compte Stripe', en: 'Create or connect your Stripe account', es: 'Crear o conectar tu cuenta Stripe' },
      // Abonnement coupé (lancement) : pas d'étape « choisir un plan ».
      ...(SUBSCRIPTIONS_ENABLED ? [{ fr: 'Choisir votre abonnement Yuno', en: 'Choose your Yuno plan', es: 'Elegir tu plan Yuno' }] : []),
    ],
    ctaLabel: { fr: 'Connecter Stripe', en: 'Connect Stripe', es: 'Conectar Stripe' },
  },
  {
    key: '7',
    page: '/owner/venue',
    title: { fr: 'Mettre en ligne', en: 'Go live', es: 'Publicar' },
    desc: {
      fr: "Rendez votre établissement visible dans l'espace Explore de l'app Yuno et dans les résultats de recherche. Les clients de votre ville verront vos soirées.",
      en: "Make your venue visible in the Yuno app's Explore section and search results. Customers in your city will see your events.",
      es: "Haz visible tu local en el Explore de Yuno y en los resultados de búsqueda. Los clientes de tu ciudad verán tus eventos.",
    },
    actions: [
      { fr: 'Publier votre premier événement', en: 'Publish your first event', es: 'Publicar tu primer evento' },
      { fr: "Activer la visibilité de l'établissement", en: 'Enable venue visibility', es: 'Activar visibilidad del local' },
    ],
    ctaLabel: { fr: 'Mettre en ligne', en: 'Go live', es: 'Publicar' },
  },
];

const TOTAL = STEPS.length;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { venueId: string }

export function OwnerOnboardingGuide({ venueId }: Props) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const l = useCallback(
    (s: { fr: string; en: string; es: string }) =>
      language === 'fr' ? s.fr : language === 'es' ? s.es : s.en,
    [language],
  );

  const { loading, stepStatuses, currentStep, isComplete, completeStep, skipStep, refetch } =
    useOwnerOnboarding(venueId);

  const [isOpen, setIsOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Auto-open current step when hook loads
  useEffect(() => {
    if (!loading && expanded === null) {
      const nextKey = STEPS.find(s => {
        const st = stepStatuses[s.key]?.status;
        return st !== 'completed' && st !== 'skipped';
      })?.key ?? null;
      setExpanded(nextKey ?? STEPS[STEPS.length - 1].key);
    }
  }, [loading, expanded, stepStatuses]);

  // Refetch when user returns to tab (picks up auto-detected completions)
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  if (loading || isComplete) return null;

  const doneCount = STEPS.filter(s => {
    const st = stepStatuses[s.key]?.status;
    return st === 'completed' || st === 'skipped';
  }).length;
  const pct = Math.round((doneCount / TOTAL) * 100);

  const handleCta = (step: StepDef) => {
    navigate(step.page);
    setIsOpen(false);
  };

  const handleSkip = async (step: StepDef) => {
    await skipStep(Number(step.key));
    const next = STEPS.find(s => {
      if (s.key === step.key) return false;
      const st = stepStatuses[s.key]?.status;
      return st !== 'completed' && st !== 'skipped';
    });
    if (next) setExpanded(next.key);
  };

  // ── Mini pill ────────────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-[84px] z-50 flex items-center gap-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95"
        style={{
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 999,
          padding: '10px 16px 10px 12px',
          boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        <Rocket className="w-4 h-4 flex-none" style={{ color: RED }} />
        <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
          {language === 'fr' ? 'Guide de config' : language === 'es' ? 'Guía' : 'Setup guide'}
        </span>
        <span
          style={{
            background: 'rgba(232,25,44,0.15)',
            border: `1px solid rgba(232,25,44,0.3)`,
            color: RED,
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: 999,
            padding: '1px 7px',
          }}
        >
          {doneCount}/{TOTAL}
        </span>
        <Maximize2 className="w-3.5 h-3.5 flex-none" style={{ color: T3 }} />
      </button>
    );
  }

  // ── Full-page overlay ────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto flex items-start justify-center"
      style={{ background: BG }}
    >
      <div className="w-full max-w-2xl px-4 pb-12 pt-8">

        {/* ── Header ── */}
        <div className="flex items-start gap-4 mb-6">
          <div
            className="flex items-center justify-center rounded-xl flex-none mt-0.5"
            style={{
              width: 44, height: 44,
              background: 'rgba(232,25,44,0.1)',
              border: `1px solid rgba(232,25,44,0.2)`,
            }}
          >
            <Rocket className="w-5 h-5" style={{ color: RED }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 style={{ color: T1, fontSize: 20, fontWeight: 700, margin: 0 }}>
              {language === 'fr' ? 'Guide de configuration'
                : language === 'es' ? 'Guía de configuración'
                : 'Setup guide'}
            </h2>
            <p style={{ color: T2, fontSize: 14, margin: '3px 0 0' }}>
              {language === 'fr' ? 'Complétez les étapes pour lancer votre établissement'
                : language === 'es' ? 'Completa los pasos para lanzar tu establecimiento'
                : 'Complete the steps to launch your venue'}
            </p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-1.5 flex-none cursor-pointer hover:opacity-70 mt-1"
            style={{ color: T3, fontSize: 12 }}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            {language === 'fr' ? 'Réduire' : language === 'es' ? 'Minimizar' : 'Minimize'}
          </button>
        </div>

        {/* ── Progress ── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span style={{ color: T3, fontSize: 12.5 }}>
              {language === 'fr' ? `Étape ${Math.min(doneCount + 1, TOTAL)} / ${TOTAL}`
                : language === 'es' ? `Paso ${Math.min(doneCount + 1, TOTAL)} / ${TOTAL}`
                : `Step ${Math.min(doneCount + 1, TOTAL)} / ${TOTAL}`}
            </span>
            <span style={{ color: doneCount === TOTAL ? GREEN : T3, fontSize: 12.5, fontWeight: 600 }}>
              {pct}%
            </span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: pct === 100 ? GREEN : RED,
                borderRadius: 99,
                boxShadow: `0 0 8px -1px ${pct === 100 ? GREEN : RED}`,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>

        {/* ── Steps ── */}
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {STEPS.map((step, idx) => {
            const status = stepStatuses[step.key]?.status ?? 'not_started';
            const done = status === 'completed' || status === 'skipped';
            const isNext = STEPS.slice(0, idx).every(s => {
              const st = stepStatuses[s.key]?.status;
              return st === 'completed' || st === 'skipped';
            }) && !done;
            const isExpanded = expanded === step.key;
            const isLast = idx === STEPS.length - 1;

            return (
              <div
                key={step.key}
                style={{ borderBottom: isLast ? 'none' : `1px solid ${BORDER}` }}
              >
                {/* Row */}
                <button
                  onClick={() => setExpanded(prev => prev === step.key ? null : step.key)}
                  className="flex items-center gap-4 w-full px-5 py-4 cursor-pointer transition-colors hover:bg-white/[0.02] text-left"
                >
                  {/* Step indicator */}
                  <div
                    className="flex-none w-7 h-7 rounded-full flex items-center justify-center"
                    style={
                      done
                        ? { background: status === 'skipped' ? 'rgba(255,255,255,0.06)' : GREEN }
                        : isNext
                        ? { border: `2px solid ${RED}`, background: 'rgba(232,25,44,0.1)' }
                        : { border: `1px solid ${BORDER}`, background: 'transparent' }
                    }
                  >
                    {done ? (
                      status === 'skipped'
                        ? <SkipForward className="w-3 h-3" style={{ color: T3 }} />
                        : <Check className="w-3.5 h-3.5" style={{ color: '#fff' }} strokeWidth={3} />
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: isNext ? RED : T3 }}>
                        {step.key}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{
                        fontSize: 14.5,
                        fontWeight: isNext && !done ? 600 : 400,
                        color: done ? T2 : isNext ? T1 : T2,
                        textDecoration: status === 'skipped' ? 'line-through' : 'none',
                        textDecorationColor: 'rgba(255,255,255,0.25)',
                      }}>
                        {l(step.title)}
                      </span>
                      {step.optional && (
                        <span style={{
                          fontSize: 10.5, fontWeight: 600, color: T3,
                          background: 'rgba(255,255,255,0.06)',
                          border: `1px solid ${BORDER}`,
                          borderRadius: 999, padding: '1px 6px',
                        }}>
                          {language === 'fr' ? 'Optionnel' : language === 'es' ? 'Opcional' : 'Optional'}
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 flex-none" style={{ color: T3 }} />
                    : <ChevronRight className="w-4 h-4 flex-none" style={{ color: isNext && !done ? RED : T3 }} />
                  }
                </button>

                {/* Expanded content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div
                        className="px-16 pb-5"
                        style={{ borderTop: `1px solid ${BORDER}` }}
                      >
                        {/* Description */}
                        <p style={{ color: T2, fontSize: 13.5, lineHeight: 1.7, marginTop: 14, marginBottom: 14 }}>
                          {l(step.desc)}
                        </p>

                        {/* Action items */}
                        <div className="mb-5 space-y-2">
                          {step.actions.map((action, ai) => (
                            <div key={ai} className="flex items-start gap-2.5">
                              <div
                                className="flex-none mt-0.5 w-1.5 h-1.5 rounded-full"
                                style={{ background: done ? GREEN : isNext ? RED : T3, marginTop: 7 }}
                              />
                              <span style={{ color: done ? T3 : T2, fontSize: 13 }}>{l(action)}</span>
                            </div>
                          ))}
                        </div>

                        {/* CTAs */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => handleCta(step)}
                            className="flex items-center gap-2 cursor-pointer transition-all hover:opacity-90 active:scale-95"
                            style={{
                              background: done ? 'rgba(255,255,255,0.06)' : RED,
                              color: done ? T2 : '#fff',
                              fontSize: 13.5,
                              fontWeight: 600,
                              borderRadius: 10,
                              padding: '9px 18px',
                              boxShadow: done ? 'none' : `0 0 20px -4px ${RED}88`,
                            }}
                          >
                            {l(step.ctaLabel)}
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>

                          {!done && (
                            <button
                              onClick={() => completeStep(Number(step.key))}
                              className="cursor-pointer hover:opacity-70 transition-opacity"
                              style={{ color: T3, fontSize: 12.5 }}
                            >
                              {language === 'fr' ? "J'ai déjà fait ça ✓"
                                : language === 'es' ? 'Ya lo hice ✓'
                                : 'Already done ✓'}
                            </button>
                          )}

                          {step.optional && !done && (
                            <button
                              onClick={() => handleSkip(step)}
                              className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
                              style={{ color: T3, fontSize: 12.5 }}
                            >
                              <SkipForward className="w-3 h-3" />
                              {language === 'fr' ? 'Passer' : language === 'es' ? 'Omitir' : 'Skip'}
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* ── Footer note ── */}
        <p className="text-center mt-5" style={{ color: T3, fontSize: 12 }}>
          {language === 'fr'
            ? 'Le guide disparaît automatiquement une fois toutes les étapes complétées.'
            : language === 'es'
            ? 'La guía desaparece automáticamente al completar todos los pasos.'
            : 'The guide disappears automatically once all steps are complete.'}
        </p>
      </div>
    </div>
  );
}
