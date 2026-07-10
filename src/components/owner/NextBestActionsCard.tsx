import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens (pro dashboard) ──────────────────────────────────────
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

type NbaAction = { title: string; why: string; category: string; path: string };

// « À faire aujourd'hui » : 3 actions priorisées générées par owner-assistant
// (action generate_next_best_actions) à partir de l'état réel du club.
// Cache serveur par jour × langue → 1 seul appel IA par jour. Best-effort :
// en cas d'erreur (backend pas déployé, réseau), la carte disparaît sans
// jamais casser le dashboard.
export function NextBestActionsCard() {
  const { t, language } = useLanguage();
  const [actions, setActions] = useState<NbaAction[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('owner-assistant', {
          body: { action: 'generate_next_best_actions', language },
        });
        if (cancelled) return;
        if (error || !Array.isArray(data?.actions) || data.actions.length === 0) {
          setFailed(true);
          return;
        }
        setActions(data.actions as NbaAction[]);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [language]);

  if (failed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 18 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4" style={{ color: T2 }} />
        <h3 style={{ color: T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {t('nba.title')}
        </h3>
        <span style={{ color: T3, fontSize: 10, fontWeight: 700, border: `1px solid ${BORDER}`, borderRadius: 5, padding: '1px 5px', letterSpacing: '0.08em' }}>
          IA
        </span>
      </div>

      {!actions ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-lg" style={{ height: 52, background: INNER_BG }} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((a, i) => (
            <Link
              key={i}
              to={a.path}
              className="flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-white/[0.05]"
              style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, textDecoration: 'none' }}
            >
              <span
                className="flex-none tabular-nums"
                style={{ color: T3, fontSize: 12, fontWeight: 700, width: 16, textAlign: 'center' }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p style={{ color: T1, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{a.title}</p>
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45, marginTop: 2 }}>{a.why}</p>
                <span style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t(`nightai.cat.${a.category}`)}
                </span>
              </div>
              <ArrowRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
            </Link>
          ))}
        </div>
      )}

      <p style={{ color: T3, fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>{t('nba.footnote')}</p>
    </motion.div>
  );
}
