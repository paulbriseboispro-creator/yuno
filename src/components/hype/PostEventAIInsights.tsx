import { useState } from 'react';
import { Sparkles, Loader2, Lightbulb, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { NightStats } from '@/lib/hypePostEvent';

// ─── Yuno Design Tokens (pro dashboard) ──────────────────────────────────────
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#34D399',
  neutral: 'rgba(255,255,255,0.4)',
  negative: '#F87171',
};

type Insight = { text: string; metric: string; sentiment: 'positive' | 'neutral' | 'negative' };
type Action = { text: string; category: 'marketing' | 'pricing' | 'operations' | 'experience' };
type NightReport = { headline: string; insights: Insight[]; actions: Action[] };

interface Props {
  eventId: string;
  stats: NightStats;
}

// Analyse IA de la soirée : envoie les NightStats déjà calculées côté client
// à owner-assistant (action generate_night_report) — narration, pas de recalcul.
// Génération à la demande (pas d'auto-génération : coût + latence maîtrisés),
// mise en cache serveur par event × langue.
export function PostEventAIInsights({ eventId, stats }: Props) {
  const { t, language } = useLanguage();
  const [report, setReport] = useState<NightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('owner-assistant', {
        body: { action: 'generate_night_report', eventId, language, stats },
      });
      if (fnError || !data?.report) throw fnError || new Error('empty');
      setReport(data.report as NightReport);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: T2 }} />
          <h3 style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{t('nightai.title')}</h3>
          <span style={{ color: T3, fontSize: 10, fontWeight: 700, border: `1px solid ${BORDER}`, borderRadius: 5, padding: '1px 5px', letterSpacing: '0.08em' }}>
            IA
          </span>
        </div>
        {report && !loading && (
          <button
            type="button"
            onClick={generate}
            style={{ color: T3, fontSize: 11.5 }}
            className="hover:opacity-80 transition-opacity"
          >
            {t('nightai.regenerate')}
          </button>
        )}
      </div>
      <p style={{ color: T3, fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>{t('nightai.subtitle')}</p>

      {!report && (
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 13, fontWeight: 600 }}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? t('nightai.generating') : t('nightai.generate')}
        </button>
      )}
      {error && (
        <p style={{ color: '#F87171', fontSize: 12, marginTop: 8 }}>{t('nightai.error')}</p>
      )}

      {report && (
        <div className="space-y-4">
          <p style={{ color: T1, fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>{report.headline}</p>

          <div>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              {t('nightai.insights')}
            </p>
            <div className="space-y-2">
              {report.insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                  <span
                    className="mt-1.5 h-1.5 w-1.5 rounded-full flex-none"
                    style={{ background: SENTIMENT_COLORS[ins.sentiment] || SENTIMENT_COLORS.neutral }}
                  />
                  <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{ins.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              {t('nightai.actions')}
            </p>
            <div className="space-y-2">
              {report.actions.map((act, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                  <ArrowRight className="h-3.5 w-3.5 mt-0.5 flex-none" style={{ color: T3 }} />
                  <div className="min-w-0">
                    <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{act.text}</p>
                    <span style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {t(`nightai.cat.${act.category}`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-1.5" style={{ color: T3, fontSize: 11, lineHeight: 1.5 }}>
            <Lightbulb className="h-3 w-3 mt-0.5 flex-none" />
            {t('nightai.disclaimer')}
          </p>
        </div>
      )}
    </div>
  );
}
