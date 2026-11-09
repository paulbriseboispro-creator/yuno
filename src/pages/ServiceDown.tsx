import { Wordmark } from '@/components/brand/Wordmark';

/**
 * Écran statique de maintenance d'urgence (voir `src/lib/platformDown.ts`).
 * Aucun appel réseau, aucune dépendance au backend ni au dictionnaire i18n :
 * il doit s'afficher même quand tout le reste est en panne. Les trois langues
 * sont donc écrites ici, choisies sur la langue du navigateur (anglais par défaut).
 *
 * DA publique (docs/DESIGN_SYSTEM_PUBLIC.md) : affiche de club — noir `#0A0A0A`,
 * titre Space Grotesk capitales, métadonnées en mono, rouge `#E8192C` seul accent.
 */

type Lang = 'en' | 'fr' | 'es';

const WORDS: Record<Lang, { tag: string; line1: string; line2: string; body: string; safe: string; retry: string }> = {
  en: {
    tag: 'Maintenance',
    line1: "We'll be",
    line2: 'right back.',
    body: 'Yuno is taking a short break while we fix a technical issue. The night goes on, we just need a moment.',
    safe: 'Your tickets and reservations are safe',
    retry: 'Try again',
  },
  fr: {
    tag: 'Maintenance',
    line1: 'On revient',
    line2: 'très vite.',
    body: "Yuno fait une courte pause, le temps de régler un problème technique. La nuit continue, il nous faut juste un instant.",
    safe: 'Vos billets et réservations sont en sécurité',
    retry: 'Réessayer',
  },
  es: {
    tag: 'Mantenimiento',
    line1: 'Volvemos',
    line2: 'enseguida.',
    body: 'Yuno hace una breve pausa mientras resolvemos un problema técnico. La noche sigue, solo necesitamos un momento.',
    safe: 'Tus entradas y reservas están a salvo',
    retry: 'Reintentar',
  },
};

function pickLang(): Lang {
  try {
    const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (l === 'fr' || l === 'es') return l;
  } catch {
    /* navigator indisponible : anglais */
  }
  return 'en';
}

const DISPLAY = "'Space Grotesk', 'Inter', system-ui, sans-serif";
const BODY = "'Inter', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

// Hauteurs relatives et décalages des barres de l'égaliseur (clin d'œil à la nuit).
const BARS = [0.45, 0.8, 0.6, 1, 0.5, 0.85, 0.65, 0.95, 0.4, 0.75, 0.55];

const CSS = `
@keyframes yd-eq { 0%,100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }
@keyframes yd-pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(232,25,44,0.55); } 50% { opacity: 0.7; box-shadow: 0 0 0 7px rgba(232,25,44,0); } }
@keyframes yd-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes yd-halo { 0%,100% { opacity: 0.85; transform: translateX(-50%) scale(1); } 50% { opacity: 1; transform: translateX(-50%) scale(1.06); } }
.yd-rise { opacity: 0; animation: yd-rise 0.7s cubic-bezier(0.16,1,0.3,1) forwards; }
.yd-btn { transition: transform 0.18s cubic-bezier(0.16,1,0.3,1), background 0.18s; }
.yd-btn:hover { background: #ff2d41 !important; }
.yd-btn:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .yd-rise { animation: none; opacity: 1; }
  .yd-bar, .yd-dot, .yd-halo { animation: none !important; }
}
`;

export default function ServiceDown() {
  const w = WORDS[pickLang()];
  return (
    <main
      role="status"
      style={{
        position: 'relative',
        minHeight: '100dvh',
        background: '#0A0A0A',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: BODY,
      }}
    >
      <style>{CSS}</style>

      {/* Halo rouge « projecteur », en haut de l'affiche */}
      <div
        className="yd-halo"
        aria-hidden
        style={{
          position: 'absolute',
          top: '-30%',
          left: '50%',
          width: 'min(900px, 140vw)',
          height: 'min(900px, 140vw)',
          transform: 'translateX(-50%)',
          background: 'radial-gradient(circle at center, rgba(232,25,44,0.30) 0%, rgba(232,25,44,0.10) 38%, rgba(10,10,10,0) 68%)',
          animation: 'yd-halo 7s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      <header style={{ position: 'relative', padding: '28px 24px 0', display: 'flex', justifyContent: 'center' }}>
        <Wordmark height={34} />
      </header>

      <section
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '24px 24px 8px',
          maxWidth: 768,
          width: '100%',
          margin: '0 auto',
        }}
      >
        <div
          className="yd-rise"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(20,20,20,0.7)',
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#E5E5E5',
            animationDelay: '0.05s',
          }}
        >
          <span
            className="yd-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: '#E8192C',
              animation: 'yd-pulse 1.8s ease-in-out infinite',
            }}
          />
          {w.tag}
        </div>

        <h1
          className="yd-rise"
          style={{
            margin: '28px 0 0',
            fontFamily: DISPLAY,
            fontWeight: 700,
            textTransform: 'uppercase',
            fontSize: 'clamp(46px, 13vw, 104px)',
            lineHeight: 0.95,
            letterSpacing: '-0.03em',
            animationDelay: '0.15s',
          }}
        >
          {w.line1}
          <br />
          <span style={{ color: '#E8192C' }}>{w.line2}</span>
        </h1>

        <p
          className="yd-rise"
          style={{
            maxWidth: 440,
            margin: '24px 0 0',
            fontSize: 16,
            lineHeight: 1.6,
            color: '#9A9A9A',
            animationDelay: '0.28s',
          }}
        >
          {w.body}
        </p>

        <div
          className="yd-rise"
          style={{
            marginTop: 28,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            maxWidth: 340,
            textAlign: 'left',
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#E5E5E5',
            animationDelay: '0.38s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
            <circle cx="8" cy="8" r="7.25" stroke="#E8192C" strokeWidth="1.5" />
            <path d="M4.8 8.2l2.1 2.1 4.3-4.6" stroke="#E8192C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {w.safe}
        </div>

        <button
          type="button"
          className="yd-btn yd-rise"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 32,
            height: 52,
            padding: '0 34px',
            borderRadius: 999,
            border: 'none',
            background: '#E8192C',
            color: '#fff',
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            animationDelay: '0.48s',
          }}
        >
          {w.retry}
        </button>
      </section>

      {/* Égaliseur : la nuit continue */}
      <footer
        aria-hidden
        style={{
          position: 'relative',
          padding: '24px 24px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 44 }}>
          {BARS.map((h, i) => (
            <span
              key={i}
              className="yd-bar"
              style={{
                width: 5,
                height: 44 * h,
                borderRadius: 2,
                background: i % 3 === 0 ? '#E8192C' : 'rgba(255,255,255,0.22)',
                transformOrigin: 'bottom',
                animation: `yd-eq ${1.1 + (i % 4) * 0.22}s ease-in-out ${i * 0.09}s infinite`,
              }}
            />
          ))}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5A5A5E' }}>
          yunoapp.eu
        </span>
      </footer>
    </main>
  );
}
