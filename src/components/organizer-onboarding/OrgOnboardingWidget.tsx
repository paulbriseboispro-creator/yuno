import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronUp, ChevronDown, X, Rocket, SkipForward, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useOrganizerOnboarding } from '@/hooks/useOrganizerOnboarding';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

interface Sub {
  fr: string;
  en: string;
  es: string;
  page: string;
}

interface StepDef {
  key: string;
  fr: string;
  en: string;
  es: string;
  page: string;
  subs: Sub[];
}

const STEP_DEFS: StepDef[] = [
  {
    key: '1',
    fr: 'Organisation & ville',
    en: 'Organization & city',
    es: 'Organización y ciudad',
    page: '/organizer-app/organization',
    subs: [
      { fr: 'Nom & description de l\'orga', en: 'Org name & description', es: 'Nombre y descripción', page: '/organizer-app/organization' },
      { fr: 'Ville principale des soirées', en: 'Your main event city', es: 'Ciudad principal', page: '/organizer-app/organization' },
    ],
  },
  {
    key: '2',
    fr: 'Profil public',
    en: 'Public profile',
    es: 'Perfil público',
    page: '/organizer-app/profile',
    subs: [
      { fr: 'Photo & bio publique', en: 'Photo & public bio', es: 'Foto y bio pública', page: '/organizer-app/profile' },
      { fr: 'Instagram & réseaux sociaux', en: 'Instagram & social links', es: 'Instagram y redes', page: '/organizer-app/profile' },
    ],
  },
  {
    key: '3',
    fr: 'Premier événement',
    en: 'First event',
    es: 'Primer evento',
    page: '/organizer-app/events',
    subs: [
      { fr: 'Créer une soirée', en: 'Create an event', es: 'Crear un evento', page: '/organizer-app/events' },
      { fr: 'Configurer la billetterie', en: 'Set up tickets', es: 'Configurar entradas', page: '/organizer-app/ticketing' },
      { fr: 'Ouvrir la guest list', en: 'Open the guest list', es: 'Abrir la lista de invitados', page: '/organizer-app/guest-list' },
    ],
  },
  {
    key: '4',
    fr: 'Équipe & promoteurs',
    en: 'Team & promoters',
    es: 'Equipo y promotores',
    page: '/organizer-app/team',
    subs: [
      { fr: 'Inviter un collaborateur', en: 'Invite a collaborator', es: 'Invitar colaborador', page: '/organizer-app/team' },
      { fr: 'Créer des liens promoteurs', en: 'Create promoter links', es: 'Crear links de promotores', page: '/organizer-app/promoters' },
    ],
  },
  {
    key: '5',
    fr: 'Paiements Stripe',
    en: 'Stripe payments',
    es: 'Pagos Stripe',
    page: '/organizer-app/payments',
    subs: [
      { fr: 'Connecter votre compte Stripe', en: 'Connect your Stripe account', es: 'Conectar cuenta Stripe', page: '/organizer-app/payments' },
    ],
  },
  {
    key: '6',
    fr: "Découvrir l'app",
    en: 'Explore the app',
    es: 'Explorar la app',
    page: '/organizer-app',
    subs: [
      { fr: 'QR Check-in en soirée', en: 'QR Check-in at events', es: 'QR Check-in en eventos', page: '/organizer-app/checkin' },
      { fr: 'Tables VIP & bouteilles', en: 'VIP tables & bottles', es: 'Mesas VIP y botellas', page: '/organizer-app/tables' },
      { fr: 'Campagnes email', en: 'Email campaigns', es: 'Campañas de email', page: '/organizer-app/campaigns' },
      { fr: 'Analytique post-soirée', en: 'Post-event analytics', es: 'Analítica post-evento', page: '/organizer-app/analytics' },
      { fr: 'Collaborer avec un club', en: 'Collaborate with a venue', es: 'Colaborar con un club', page: '/organizer-app/collaborations' },
    ],
  },
];

const STEP_COUNT = STEP_DEFS.length;

interface Props { userId: string }

export function OrgOnboardingWidget({ userId }: Props) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const l = (s: { fr: string; en: string; es: string }) =>
    language === 'fr' ? s.fr : language === 'es' ? s.es : s.en;

  const { loading, stepStatuses } = useOrganizerOnboarding(userId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const initRef = useRef(false);
  const [isDismissed, setIsDismissed] = useState(() =>
    sessionStorage.getItem('org_widget_dismissed') === '1',
  );

  const doneCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;

  const nextKey = STEP_DEFS.find(s => {
    const st = stepStatuses[s.key]?.status;
    return st !== 'completed' && st !== 'skipped';
  })?.key ?? null;

  // Auto-expand the next incomplete step once
  useEffect(() => {
    if (!loading && nextKey && !initRef.current) {
      initRef.current = true;
      setExpandedStep(nextKey);
    }
  }, [loading, nextKey]);

  if (loading || isDismissed || doneCount >= STEP_COUNT) return null;

  const progressPct = Math.round((doneCount / STEP_COUNT) * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (progressPct / 100) * circ;

  const toggleStep = (key: string) =>
    setExpandedStep(prev => (prev === key ? null : key));

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    sessionStorage.setItem('org_widget_dismissed', '1');
    setIsDismissed(true);
  };

  return (
    <div className="fixed z-50 flex flex-col items-end gap-2" style={{ bottom: 24, right: 24 }}>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            style={{
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              width: 300,
              maxHeight: 'calc(100dvh - 120px)',
              overflowY: 'auto',
              boxShadow: '0 24px 60px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10"
              style={{ background: '#0a0a0c', borderBottom: `1px solid ${BORDER}` }}
            >
              <div
                className="flex items-center justify-center rounded-lg flex-none"
                style={{ width: 30, height: 30, background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
              >
                <Rocket className="w-4 h-4" style={{ color: RED }} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ color: T1, fontSize: 13, fontWeight: 600, margin: 0 }}>
                  {tt('Finaliser la configuration', 'Complete your setup', 'Finaliza la configuración')}
                </p>
                <p style={{ color: T3, fontSize: 11, marginTop: 1 }} className="tabular-nums">
                  {doneCount}/{STEP_COUNT} {tt('étapes', 'steps', 'pasos')} · {progressPct}%
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer transition-colors hover:bg-white/[0.06]"
                style={{ color: T3 }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: RED, boxShadow: `0 0 8px -1px ${RED}`, transition: 'width 0.4s ease' }} />
            </div>

            {/* Step list */}
            <div className="py-1">
              {STEP_DEFS.map((step) => {
                const status = stepStatuses[step.key]?.status ?? 'not_started';
                const done = status === 'completed' || status === 'skipped';
                const isNext = step.key === nextKey;
                const open = expandedStep === step.key;

                return (
                  <div key={step.key}>
                    {/* Step header row */}
                    <button
                      onClick={() => toggleStep(step.key)}
                      className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.03] text-left"
                    >
                      {/* Status dot */}
                      <div
                        className="flex-none w-5 h-5 rounded-full flex items-center justify-center"
                        style={
                          done
                            ? { background: status === 'skipped' ? 'rgba(255,255,255,0.06)' : POS }
                            : isNext
                            ? { border: `1.5px solid ${RED}`, background: 'rgba(232,25,44,0.08)' }
                            : { border: `1px solid ${BORDER}` }
                        }
                      >
                        {done ? (
                          status === 'skipped'
                            ? <SkipForward className="w-2.5 h-2.5" style={{ color: T3 }} />
                            : <Check className="w-3 h-3" style={{ color: '#04130d' }} />
                        ) : (
                          <span style={{ fontSize: 9, fontWeight: 700, color: isNext ? RED : T3 }}>
                            {step.key}
                          </span>
                        )}
                      </div>

                      {/* Label */}
                      <span style={{
                        flex: 1,
                        fontSize: 12.5,
                        fontWeight: isNext && !done ? 600 : 400,
                        color: done ? T2 : isNext ? T1 : T2,
                        textDecoration: done ? 'line-through' : 'none',
                        textDecorationColor: 'rgba(255,255,255,0.2)',
                      }}>
                        {l(step)}
                      </span>

                      {/* Toggle chevron */}
                      {open
                        ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T3 }} />
                        : <ChevronRight className="w-3.5 h-3.5 flex-none" style={{ color: isNext && !done ? RED : T3 }} />
                      }
                    </button>

                    {/* Sub-steps */}
                    <AnimatePresence>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div
                            className="pb-1"
                            style={{ borderLeft: `1.5px solid ${isNext && !done ? `rgba(232,25,44,0.25)` : BORDER}`, marginLeft: 26, marginRight: 16 }}
                          >
                            {step.subs.map((sub, si) => (
                              <button
                                key={si}
                                onClick={() => { navigate(sub.page); setIsExpanded(false); }}
                                className="flex items-center gap-2 w-full px-3 py-2 cursor-pointer transition-colors hover:bg-white/[0.04] text-left rounded-lg"
                              >
                                <ChevronRight className="w-3 h-3 flex-none" style={{ color: isNext && !done ? RED : T3 }} />
                                <span style={{ fontSize: 11.5, color: done ? T3 : T2 }}>{l(sub)}</span>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating toggle pill */}
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="flex items-center gap-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95"
        style={{
          background: '#0a0a0c',
          border: `1px solid ${BORDER}`,
          borderRadius: 999,
          padding: '8px 14px 8px 10px',
          boxShadow: '0 8px 24px -4px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
          <circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
          <circle
            cx={18} cy={18} r={r} fill="none" stroke={RED} strokeWidth={3}
            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.4s ease', filter: `drop-shadow(0 0 4px ${RED})` }}
          />
          <text x={18} y={22} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: T1 }}>
            {doneCount}/{STEP_COUNT}
          </text>
        </svg>
        <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
          {tt('Config.', 'Setup', 'Config.')}
        </span>
        {isExpanded
          ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
          : <ChevronUp className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
        }
      </button>
    </div>
  );
}
