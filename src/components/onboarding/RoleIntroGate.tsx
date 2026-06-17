import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { ROLE_INTROS, type RoleIntroKey } from './roleIntroContent';
import { PrimaryButton, GhostButton, RED, T1, T2, T3, BORDER, CARD_BG, CARD_SHADOW, C_FAINT } from './onboardingUI';

interface Props {
  role: RoleIntroKey;
}

const flagKey = (role: RoleIntroKey) => `yuno_role_intro_${role}`;

function alreadySeen(role: RoleIntroKey): boolean {
  try {
    return localStorage.getItem(flagKey(role)) === '1';
  } catch {
    return false;
  }
}

/**
 * First-run intro for operational / commission roles (promoter, bouncer,
 * barman, VIP host, affiliate). Not a setup wizard — a 2-3 slide explainer
 * of "what is this screen and what's my one job", shown once per device.
 */
export function RoleIntroGate({ role }: Props) {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const tt = (l: [string, string, string]) => translate(language, l[0], l[1], l[2]);
  const def = ROLE_INTROS[role];

  // ?intro=1 force l'affichage (démo en appel / re-lecture), ignore le flag vu.
  const forced = searchParams.get('intro') === '1';
  const [open, setOpen] = useState(() => forced || !alreadySeen(role));
  const [slide, setSlide] = useState(0);

  if (!open || !def) return null;

  const slides = def.slides;
  const isLast = slide === slides.length - 1;
  const current = slides[slide];
  const Icon = current.icon;
  const HeaderIcon = def.icon;

  const dismiss = () => {
    try {
      localStorage.setItem(flagKey(role), '1');
    } catch {
      // best-effort; intro just re-shows next time
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      >
        {/* Backdrop — tap to skip */}
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }} onClick={dismiss} />

        <motion.div
          initial={{ y: 28, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 28, opacity: 0, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="relative w-full max-w-sm"
          style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 22, boxShadow: CARD_SHADOW, overflow: 'hidden' }}
        >
          {/* Ambient glow */}
          <div className="pointer-events-none absolute -top-16 -right-16 w-52 h-52 rounded-full" style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(56px)' }} />

          {/* Header */}
          <div className="relative flex items-center justify-between px-5 pt-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                <HeaderIcon className="w-[18px] h-[18px]" style={{ color: RED }} />
              </div>
              <span style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>{tt(def.title)}</span>
            </div>
            <button onClick={dismiss} className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-white/[0.05]" style={{ color: T3 }} aria-label="Skip">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Slide */}
          <div className="relative px-6 pt-5 pb-2 min-h-[180px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={slide}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                  <Icon className="w-7 h-7" style={{ color: RED }} />
                </div>
                <h3 style={{ color: T1, fontSize: 19, fontWeight: 680, letterSpacing: '-0.02em' }}>{tt(current.title)}</h3>
                <p style={{ color: T2, fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>{tt(current.desc)}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="relative flex items-center justify-between px-6 pb-5 pt-3">
            <div className="flex gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSlide(i)}
                  className="rounded-full transition-all cursor-pointer"
                  style={{ height: 6, width: i === slide ? 22 : 6, background: i === slide ? RED : C_FAINT }}
                  aria-label={`slide ${i + 1}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {slide > 0 && (
                <GhostButton onClick={() => setSlide(s => s - 1)} style={{ padding: '9px 12px' }}>
                  <ArrowLeft className="w-4 h-4" />
                </GhostButton>
              )}
              {isLast ? (
                <PrimaryButton icon={Check} onClick={dismiss} style={{ padding: '9px 16px' }}>
                  {translate(language, 'Compris', 'Got it', 'Entendido')}
                </PrimaryButton>
              ) : (
                <PrimaryButton icon={ArrowRight} onClick={() => setSlide(s => s + 1)} style={{ padding: '9px 16px' }}>
                  {translate(language, 'Suivant', 'Next', 'Siguiente')}
                </PrimaryButton>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
