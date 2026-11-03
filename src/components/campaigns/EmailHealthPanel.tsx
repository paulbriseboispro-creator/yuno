import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StudioScope } from '@/components/email-studio/hooks';
import { useSenderHealth } from '@/lib/email/senderHealth';
import { useSenderHealthVisual } from '@/lib/email/senderHealthVisual';
import { healthWord, type HealthLang } from '@/lib/email/senderHealthWords';
import { HealthDashboard, type HealthPalette } from '@/components/email-health/HealthDashboard';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

/** Palette des Consoles pro (sombre et clair, cf. pro-theme.css). */
const PRO: HealthPalette = {
  ink: T1, sub: T2, muted: T3, line: 'rgb(var(--ink)/0.12)', inner: INNER_BG,
  card: { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 },
  h2: { margin: 0, color: T1, fontSize: 16, fontWeight: 620, letterSpacing: '-0.01em' },
  display: 'inherit',
  green: 'var(--acc-34d399)', amber: 'var(--acc-fcd34d)', red: 'var(--acc-ff5c63)', neutral: 'rgb(var(--ink)/0.3)', blue: 'var(--acc-60a5fa)',
  toneBg: { ok: 'rgba(52,211,153,0.10)', warn: 'rgba(252,211,77,0.10)', bad: 'rgba(255,92,99,0.10)', neutral: INNER_BG },
  onInk: 'var(--sf-000000)',
};

/**
 * Billetterie › E-mails › Santé des envois (`…/campaigns/health`) : la même
 * page que la Console CRM (HealthDashboard), au design des Consoles pro.
 */
export default function EmailHealthPanel({ scope, basePath }: { scope: StudioScope; basePath: string }) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const L = (['en', 'fr', 'es'].includes(language) ? language : 'en') as HealthLang;
  const w = (k: string, v?: Record<string, string | number | null | undefined>) => healthWord(L, k, v);
  const loc = L === 'en' ? 'en-GB' : L === 'fr' ? 'fr-FR' : 'es-ES';
  const n = (v: number) => v.toLocaleString(loc);
  const dShort = (iso: string) => new Date(iso).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  const time = (iso: string) => new Date(iso).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const venueId = scope.kind === 'venue' ? scope.venueId : null;
  const organizerId = scope.kind === 'organizer' ? scope.organizerId : null;
  const q = useSenderHealth(venueId, organizerId, 'suite');
  const v = useSenderHealthVisual(venueId, organizerId, 'suite');
  const r = q.data;

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--sf-000000)' }}>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 w-full" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => navigate(basePath)} aria-label="back" className="cursor-pointer"
            style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${BORDER}`, background: INNER_BG, display: 'grid', placeItems: 'center' }}>
            <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{scope.name}</div>
            <h1 style={{ margin: '6px 0 0', color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{w('title')}</h1>
          </div>
        </div>

        {q.loading && !r ? (
          <div style={{ ...PRO.card, alignItems: 'center', padding: 40 }}><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
        ) : q.error || !r ? (
          <div style={PRO.card}>
            <p style={{ margin: 0, color: T2, fontSize: 13 }}>{w('error')}</p>
            <button type="button" onClick={() => { void q.reload(); void v.reload(); }} style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 10, background: T1, color: 'var(--sf-000000)', fontSize: 12.5, fontWeight: 600 }}>{w('retry')}</button>
          </div>
        ) : (
          <HealthDashboard report={r} visual={v.data} lang={L} n={n} dShort={dShort} time={time} P={PRO}
            campaignHref={(id) => `${basePath}/${id}/report`} />
        )}
      </div>
    </div>
  );
}
