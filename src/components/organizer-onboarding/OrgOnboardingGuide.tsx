import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronDown, ChevronRight, Rocket,
  ArrowRight, SkipForward, Minimize2, Maximize2,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizerOnboarding } from '@/hooks/useOrganizerOnboarding';

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
  completeOnCta?: boolean;
  page: string;
  title: { fr: string; en: string; es: string };
  desc: { fr: string; en: string; es: string };
  actions: { fr: string; en: string; es: string }[];
  ctaLabel: { fr: string; en: string; es: string };
}

const STEPS: StepDef[] = [
  {
    key: '1',
    page: '/organizer-app/profile',
    completeOnCta: true,
    title: { fr: 'Bienvenue & votre organisation', en: 'Welcome & your organization', es: 'Bienvenida y tu organización' },
    desc: {
      fr: "Confirmez le nom de votre organisation et votre ville. Ces informations apparaissent sur toutes vos soirées et votre profil public.",
      en: "Confirm your organization's name and city. This info appears on all your events and your public profile.",
      es: "Confirma el nombre de tu organización y tu ciudad. Esta información aparece en todos tus eventos.",
    },
    actions: [
      { fr: "Nom de l'organisation", en: 'Organization name', es: 'Nombre de la organización' },
      { fr: 'Ville d\'activité principale', en: 'Main city', es: 'Ciudad principal' },
    ],
    ctaLabel: { fr: 'Compléter mon profil', en: 'Complete my profile', es: 'Completar mi perfil' },
  },
  {
    key: '2',
    page: '/organizer-app/profile',
    optional: true,
    title: { fr: 'Profil public', en: 'Public profile', es: 'Perfil público' },
    desc: {
      fr: "Un profil soigné attire plus de clients et rassure les clubs partenaires. Ajoutez un logo, une biographie et votre compte Instagram.",
      en: "A polished profile attracts more customers and reassures partner clubs. Add a logo, bio and your Instagram.",
      es: "Un perfil cuidado atrae más clientes y tranquiliza a los clubs asociados. Añade logo, bio e Instagram.",
    },
    actions: [
      { fr: 'Photo de profil ou logo', en: 'Profile photo or logo', es: 'Foto de perfil o logo' },
      { fr: "Biographie de l'organisation", en: 'Organization bio', es: 'Biografía de la organización' },
      { fr: 'Compte Instagram', en: 'Instagram account', es: 'Cuenta de Instagram' },
    ],
    ctaLabel: { fr: 'Enrichir mon profil', en: 'Enrich my profile', es: 'Enriquecer mi perfil' },
  },
  {
    key: '3',
    page: '/organizer-app/events',
    title: { fr: 'Créez votre première soirée', en: 'Create your first event', es: 'Crea tu primer evento' },
    desc: {
      fr: "Votre première soirée est le point de départ. Configurez la billetterie pour vendre en ligne, et ouvrez la guest list pour gérer vos invités.",
      en: "Your first event is where it all starts. Set up ticketing to sell online, and open the guest list to manage your guests.",
      es: "Tu primer evento es donde comienza todo. Configura la venta de entradas y abre la lista de invitados.",
    },
    actions: [
      { fr: 'Créer la soirée (lieu, date, affiche)', en: 'Create the event (venue, date, poster)', es: 'Crear el evento (lugar, fecha, cartel)' },
      { fr: 'Configurer la billetterie', en: 'Set up ticketing', es: 'Configurar venta de entradas' },
      { fr: 'Ouvrir la guest list', en: 'Open the guest list', es: 'Abrir la lista de invitados' },
    ],
    ctaLabel: { fr: 'Créer une soirée', en: 'Create an event', es: 'Crear un evento' },
  },
  {
    key: '4',
    page: '/organizer-app/team',
    optional: true,
    title: { fr: 'Invitez votre équipe', en: 'Invite your team', es: 'Invita a tu equipo' },
    desc: {
      fr: "Ajoutez vos co-organisateurs pour gérer les soirées ensemble. Ils auront accès au dashboard et pourront gérer les billets et la guest list.",
      en: "Add your co-organizers to manage events together. They'll get dashboard access to manage tickets and the guest list.",
      es: "Añade co-organizadores para gestionar eventos juntos. Tendrán acceso al dashboard.",
    },
    actions: [
      { fr: "Inviter un membre de l'équipe", en: 'Invite a team member', es: 'Invitar a un miembro' },
      { fr: 'Définir les accès et permissions', en: 'Set access and permissions', es: 'Definir accesos y permisos' },
    ],
    ctaLabel: { fr: "Gérer l'équipe", en: 'Manage team', es: 'Gestionar equipo' },
  },
  {
    key: '5',
    page: '/organizer-app/payments',
    title: { fr: 'Connecter Stripe', en: 'Connect Stripe', es: 'Conectar Stripe' },
    desc: {
      fr: "Stripe vous permet de recevoir les ventes de billets directement sur votre compte bancaire. Sans Stripe connecté, la vente de billets est désactivée.",
      en: "Stripe lets you receive ticket sales directly to your bank account. Without Stripe, ticket selling is disabled.",
      es: "Stripe te permite recibir las ventas directamente en tu cuenta bancaria. Sin Stripe, la venta de entradas está desactivada.",
    },
    actions: [
      { fr: 'Créer ou connecter votre compte Stripe', en: 'Create or connect your Stripe account', es: 'Crear o conectar tu cuenta Stripe' },
      { fr: 'Vérifier vos informations bancaires', en: 'Verify your bank details', es: 'Verificar información bancaria' },
    ],
    ctaLabel: { fr: 'Connecter Stripe', en: 'Connect Stripe', es: 'Conectar Stripe' },
  },
  {
    key: '6',
    page: '/organizer-app/checkin',
    completeOnCta: true,
    title: { fr: 'Explorer les outils avancés', en: 'Explore advanced tools', es: 'Explorar herramientas avanzadas' },
    desc: {
      fr: "Yuno offre des outils puissants pour développer votre audience : QR check-in, réseau de promoteurs, tables VIP, campagnes marketing et analytique post-soirée.",
      en: "Yuno has powerful tools to grow your audience: QR check-in, promoter network, VIP tables, marketing campaigns and post-event analytics.",
      es: "Yuno tiene herramientas avanzadas: QR check-in, red de promotores, mesas VIP, campañas y analítica post-evento.",
    },
    actions: [
      { fr: "QR check-in pour valider les billets à l'entrée", en: 'QR check-in to validate tickets at the door', es: 'QR check-in para validar entradas' },
      { fr: 'Réseau de promoteurs affiliés', en: 'Affiliate promoter network', es: 'Red de promotores afiliados' },
      { fr: 'Analytique et rapport post-soirée', en: 'Post-event analytics & reports', es: 'Analítica e informe post-evento' },
    ],
    ctaLabel: { fr: 'Découvrir Yuno', en: 'Explore Yuno', es: 'Explorar Yuno' },
  },
];

const TOTAL = STEPS.length;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { userId: string }

export function OrgOnboardingGuide({ userId }: Props) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const l = useCallback(
    (s: { fr: string; en: string; es: string }) =>
      language === 'fr' ? s.fr : language === 'es' ? s.es : s.en,
    [language],
  );

  const { loading, stepStatuses, currentStep, isComplete, completeStep, skipStep, refetch } =
    useOrganizerOnboarding(userId);

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

  // Refetch when user comes back (picks up auto-detected steps)
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

  const handleCta = async (step: StepDef) => {
    if (step.completeOnCta) {
      await completeStep(Number(step.key));
    }
    navigate(step.page);
    setIsOpen(false);
  };

  const handleSkip = async (step: StepDef) => {
    await skipStep(Number(step.key));
    const next = STEPS.find(s => {
      const k = s.key;
      if (k === step.key) return false;
      const st = stepStatuses[k]?.status;
      return st !== 'completed' && st !== 'skipped';
    });
    if (next) setExpanded(next.key);
  };

  // ── Mini pill ────────────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95"
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
              {language === 'fr' ? 'Complétez les étapes pour lancer votre organisation'
                : language === 'es' ? 'Completa los pasos para lanzar tu organización'
                : 'Complete the steps to launch your organization'}
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
            const isNext = step.key === String(currentStep) || (!done && !STEPS.slice(0, idx).some(s => {
              const st = stepStatuses[s.key]?.status;
              return st !== 'completed' && st !== 'skipped';
            }));
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
                                style={{ background: done ? GREEN : isNext ? RED : T3 }}
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
                              onClick={() => { completeStep(Number(step.key)); }}
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
