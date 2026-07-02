import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronUp, ChevronDown, X, Rocket, SkipForward, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerOnboarding } from '@/hooks/useOwnerOnboarding';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

interface Sub { fr: string; en: string; es: string; page: string }
interface StepDef { key: string; fr: string; en: string; es: string; page: string; subs: Sub[] }

const STEP_DEFS: StepDef[] = [
  {
    key: '1',
    fr: 'Piliers & bienvenue',
    en: 'Pillars & welcome',
    es: 'Pilares y bienvenida',
    page: '/owner/onboarding',
    subs: [
      { fr: 'Billets, tables VIP ou boissons ?', en: 'Tickets, VIP tables or drinks?', es: '¿Entradas, mesas VIP o bebidas?', page: '/owner/onboarding' },
    ],
  },
  {
    key: '2',
    fr: 'Votre établissement',
    en: 'Your venue',
    es: 'Tu establecimiento',
    page: '/owner/venue',
    subs: [
      { fr: 'Nom, ville, adresse', en: 'Name, city, address', es: 'Nombre, ciudad, dirección', page: '/owner/venue' },
      { fr: 'Informations légales (SIRET)', en: 'Legal info (registration no.)', es: 'Información legal', page: '/owner/venue' },
    ],
  },
  {
    key: '3',
    fr: 'Votre offre',
    en: 'Your offer',
    es: 'Tu oferta',
    page: '/owner/events',
    subs: [
      { fr: 'Créer un événement', en: 'Create an event', es: 'Crear un evento', page: '/owner/events' },
      { fr: 'Tables VIP & bouteilles', en: 'VIP tables & bottles', es: 'Mesas VIP y botellas', page: '/owner/tables' },
      { fr: 'Carte des boissons', en: 'Drinks menu', es: 'Carta de bebidas', page: '/owner/menu' },
    ],
  },
  {
    key: '4',
    fr: 'Image de marque',
    en: 'Branding',
    es: 'Imagen de marca',
    page: '/owner/venue',
    subs: [
      { fr: 'Photo de couverture', en: 'Cover photo', es: 'Foto de portada', page: '/owner/venue' },
      { fr: 'Description & ambiance', en: 'Description & vibe', es: 'Descripción y ambiente', page: '/owner/venue' },
      { fr: 'Instagram & réseaux', en: 'Instagram & socials', es: 'Instagram y redes', page: '/owner/venue' },
    ],
  },
  {
    key: '5',
    fr: 'Votre équipe',
    en: 'Your team',
    es: 'Tu equipo',
    page: '/owner/staff',
    subs: [
      { fr: 'Inviter le staff (bouncer, barman…)', en: 'Invite staff (bouncer, bartender…)', es: 'Invitar staff (portero, barman…)', page: '/owner/staff' },
      { fr: 'Hôte VIP & vestiaire', en: 'VIP host & cloakroom', es: 'Anfitrión VIP y guardarropa', page: '/owner/staff' },
    ],
  },
  {
    key: '6',
    fr: 'Paiements Stripe',
    en: 'Stripe payments',
    es: 'Pagos Stripe',
    page: '/owner/billing',
    subs: [
      { fr: 'Connecter votre compte Stripe', en: 'Connect your Stripe account', es: 'Conectar cuenta Stripe', page: '/owner/billing' },
      { fr: 'Choisir votre abonnement Yuno', en: 'Choose your Yuno plan', es: 'Elegir tu plan Yuno', page: '/owner/billing' },
    ],
  },
  {
    key: '7',
    fr: 'Mise en ligne',
    en: 'Go live',
    es: 'Publicar',
    page: '/owner/events',
    subs: [
      { fr: 'Publier votre premier événement', en: 'Publish your first event', es: 'Publicar tu primer evento', page: '/owner/events' },
      { fr: 'Rendre votre club visible', en: 'Make your venue visible', es: 'Hacer tu club visible', page: '/owner/venue' },
    ],
  },
];

const STEP_COUNT = STEP_DEFS.length;

interface Props { venueId: string }

export function OwnerOnboardingWidget({ venueId }: Props) {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const l = (s: { fr: string; en: string; es: string }) =>
    language === 'fr' ? s.fr : language === 'es' ? s.es : s.en;

  const { loading, stepStatuses, isComplete } = useOwnerOnboarding(venueId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const initRef = useRef(false);
  const [isDismissed, setIsDismissed] = useState(() =>
    sessionStorage.getItem('owner_widget_dismissed') === '1',
  );

  const doneCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;

  const nextKey = STEP_DEFS.find(s => {
    const st = stepStatuses[s.key]?.status;
    return st !== 'completed' && st !== 'skipped';
  })?.key ?? null;

  useEffect(() => {
    if (!loading && nextKey && !initRef.current) {
      initRef.current = true;
      setExpandedStep(nextKey);
    }
  }, [loading, nextKey]);

  if (loading || isDismissed || isComplete || doneCount >= STEP_COUNT) return null;

  const progressPct = Math.round((doneCount / STEP_COUNT) * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (progressPct / 100) * circ;

  const toggleStep = (key: string) =>
    setExpandedStep(prev => (prev === key ? null : key));

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    sessionStorage.setItem('owner_widget_dismissed', '1');
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
                  {t('onboarding.completeSetup')}
                </p>
                <p style={{ color: T3, fontSize: 11, marginTop: 1 }} className="tabular-nums">
                  {doneCount}/{STEP_COUNT} {t('onboarding.steps')} · {progressPct}%
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
            <div style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
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
                    <button
                      onClick={() => toggleStep(step.key)}
                      className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.03] text-left"
                    >
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

                      {open
                        ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T3 }} />
                        : <ChevronRight className="w-3.5 h-3.5 flex-none" style={{ color: isNext && !done ? RED : T3 }} />
                      }
                    </button>

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
                            style={{ borderLeft: `1.5px solid ${isNext && !done ? 'rgba(232,25,44,0.25)' : BORDER}`, marginLeft: 26, marginRight: 16 }}
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
          {t('onboarding.setup')}
        </span>
        {isExpanded
          ? <ChevronDown className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
          : <ChevronUp className="w-3.5 h-3.5 flex-none" style={{ color: T2 }} />
        }
      </button>
    </div>
  );
}
