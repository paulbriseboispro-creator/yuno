import { useState } from 'react';
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

interface OwnerOnboardingWidgetProps {
  venueId: string;
}

const STEP_DEFS = [
  {
    key: '1',
    label: { fr: 'Piliers & bienvenue', en: 'Pillars & welcome', es: 'Pilares y bienvenida' },
    hint: { fr: 'Billets, tables VIP ou boissons ?', en: 'Tickets, VIP tables or drinks?', es: '¿Entradas, mesas VIP o bebidas?' },
    page: '/owner/onboarding',
  },
  {
    key: '2',
    label: { fr: 'Votre établissement', en: 'Your venue', es: 'Tu establecimiento' },
    hint: { fr: 'Nom, ville, adresse', en: 'Name, city, address', es: 'Nombre, ciudad, dirección' },
    page: '/owner/venue',
  },
  {
    key: '3',
    label: { fr: 'Votre offre', en: 'Your offer', es: 'Tu oferta' },
    hint: { fr: 'Soirées, tables VIP, carte boissons', en: 'Events, VIP tables, drinks menu', es: 'Eventos, mesas VIP, carta de bebidas' },
    page: '/owner/events',
  },
  {
    key: '4',
    label: { fr: 'Page & image de marque', en: 'Page & branding', es: 'Página y marca' },
    hint: { fr: 'Photo, description, réseaux', en: 'Cover photo, description, socials', es: 'Foto, descripción, redes' },
    page: '/owner/venue',
  },
  {
    key: '5',
    label: { fr: 'Votre équipe', en: 'Your team', es: 'Tu equipo' },
    hint: { fr: 'Staff, barmans, bouncer, hôte VIP', en: 'Staff, bartenders, bouncer, VIP host', es: 'Staff, bartenders, portero, anfitrión VIP' },
    page: '/owner/staff',
  },
  {
    key: '6',
    label: { fr: 'Paiements Stripe', en: 'Stripe payments', es: 'Pagos Stripe' },
    hint: { fr: 'Recevez vos revenus directement', en: 'Receive your revenue directly', es: 'Recibe tus ingresos directamente' },
    page: '/owner/billing',
  },
  {
    key: '7',
    label: { fr: 'Mise en ligne', en: 'Go live', es: 'Publicar' },
    hint: { fr: 'Publiez votre premier événement', en: 'Publish your first event', es: 'Publica tu primer evento' },
    page: '/owner/events',
  },
];

const STEP_COUNT = STEP_DEFS.length;

export function OwnerOnboardingWidget({ venueId }: OwnerOnboardingWidgetProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  // The hook auto-creates the venue_onboarding row if missing and runs detection.
  const { loading, stepStatuses, isComplete } = useOwnerOnboarding(venueId);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() =>
    sessionStorage.getItem('owner_widget_dismissed') === '1',
  );

  const l = (obj: { fr: string; en: string; es: string }) =>
    language === 'fr' ? obj.fr : language === 'es' ? obj.es : obj.en;

  if (loading || isDismissed || isComplete) return null;

  const doneCount = Object.values(stepStatuses).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;

  if (doneCount >= STEP_COUNT) return null;

  const progressPct = Math.round((doneCount / STEP_COUNT) * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (progressPct / 100) * circ;

  const nextKey = STEP_DEFS.find(s => {
    const st = stepStatuses[s.key]?.status;
    return st !== 'completed' && st !== 'skipped';
  })?.key;

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
              boxShadow: '0 24px 60px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
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
                aria-label={t('common.close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: RED,
                  transition: 'width 0.4s ease',
                  boxShadow: `0 0 8px -1px ${RED}`,
                }}
              />
            </div>

            {/* Step list */}
            <div className="py-2">
              {STEP_DEFS.map((step) => {
                const status = stepStatuses[step.key]?.status ?? 'not_started';
                const done = status === 'completed' || status === 'skipped';
                const isNext = step.key === nextKey;
                const label = l(step.label);
                const hint = l(step.hint);
                return (
                  <button
                    key={step.key}
                    onClick={() => { navigate(step.page); setIsExpanded(false); }}
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

                    <div className="flex-1 min-w-0">
                      <p style={{
                        fontSize: 12.5,
                        color: done ? T2 : isNext ? T1 : T2,
                        textDecoration: done ? 'line-through' : 'none',
                        textDecorationColor: 'rgba(255,255,255,0.2)',
                        fontWeight: isNext ? 600 : 400,
                        margin: 0,
                      }}>
                        {label}
                      </p>
                      {!done && (
                        <p style={{ fontSize: 10.5, color: T3, marginTop: 1 }}>{hint}</p>
                      )}
                    </div>

                    {!done && (
                      <ChevronRight
                        className="w-3.5 h-3.5 flex-none"
                        style={{ color: isNext ? RED : T3 }}
                      />
                    )}
                  </button>
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
        aria-label={isExpanded ? t('common.collapse') : t('onboarding.setup')}
      >
        <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
          <circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
          <circle
            cx={18} cy={18} r={r}
            fill="none"
            stroke={RED}
            strokeWidth={3}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={circ / 4}
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
