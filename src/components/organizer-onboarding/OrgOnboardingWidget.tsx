import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronUp, ChevronDown, X, Rocket, SkipForward } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

interface StepStatus {
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
}

interface OrgOnboardingWidgetProps {
  userId: string;
}

const STEP_COUNT = 6;

export function OrgOnboardingWidget({ userId }: OrgOnboardingWidgetProps) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [steps, setSteps] = useState<Record<string, StepStatus> | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Per-session hide: dismissed until next page load
  const [isDismissed, setIsDismissed] = useState(() =>
    sessionStorage.getItem('org_widget_dismissed') === '1',
  );

  const STEP_LABELS = [
    tt('Bienvenue & organisation', 'Welcome & organization', 'Bienvenida y organización'),
    tt('Profil public', 'Public profile', 'Perfil público'),
    tt('Premier événement', 'First event', 'Primer evento'),
    tt('Équipe & promoteurs', 'Team & promoters', 'Equipo y promotores'),
    tt('Paiements Stripe', 'Stripe payments', 'Pagos Stripe'),
    tt("Tour de l'app", 'App tour', 'Tour de la app'),
  ];

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('organizer_onboarding')
      .select('steps')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.steps) setSteps(data.steps as Record<string, StepStatus>);
      });
  }, [userId]);

  if (!steps || isDismissed) return null;

  const doneCount = Object.values(steps).filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length;

  // All steps done → no widget needed
  if (doneCount >= STEP_COUNT) return null;

  const progressPct = Math.round((doneCount / STEP_COUNT) * 100);
  // SVG ring math
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (progressPct / 100) * circ;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    sessionStorage.setItem('org_widget_dismissed', '1');
    setIsDismissed(true);
  };

  return (
    <div
      className="fixed z-50 flex flex-col items-end gap-2"
      style={{ bottom: 24, right: 24 }}
    >
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
            {/* Card header */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: `1px solid ${BORDER}` }}
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
                aria-label={tt('Fermer', 'Close', 'Cerrar')}
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
              {STEP_LABELS.map((label, i) => {
                const stepNum = String(i + 1);
                const status = steps[stepNum]?.status ?? 'not_started';
                const done = status === 'completed' || status === 'skipped';
                const skipped = status === 'skipped';
                return (
                  <button
                    key={stepNum}
                    onClick={() => navigate(`/organizer-app/onboarding`)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.03] text-left"
                  >
                    <div
                      className="flex-none w-5 h-5 rounded-full flex items-center justify-center"
                      style={
                        done
                          ? { background: skipped ? 'rgba(255,255,255,0.06)' : POS }
                          : { border: `1px solid ${BORDER}` }
                      }
                    >
                      {done ? (
                        skipped
                          ? <SkipForward className="w-2.5 h-2.5" style={{ color: T3 }} />
                          : <Check className="w-3 h-3" style={{ color: '#04130d' }} />
                      ) : (
                        <span style={{ fontSize: 9, fontWeight: 700, color: T3 }}>{i + 1}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 12.5, color: done ? T2 : T1, textDecoration: done ? 'line-through' : 'none', textDecorationColor: 'rgba(255,255,255,0.2)' }}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* CTA */}
            <div className="px-4 pb-4">
              <button
                onClick={() => navigate('/organizer-app/onboarding')}
                className="w-full py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer transition-all"
                style={{ background: RED, color: '#fff', boxShadow: `0 0 16px -4px ${RED}88` }}
              >
                {tt('Continuer la configuration', 'Continue setup', 'Continuar configuración')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating toggle button */}
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
        aria-label={isExpanded ? tt('Réduire', 'Collapse', 'Contraer') : tt('Configuration', 'Setup', 'Configuración')}
      >
        {/* SVG progress ring */}
        <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
          <circle
            cx={18} cy={18} r={r}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={3}
          />
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
