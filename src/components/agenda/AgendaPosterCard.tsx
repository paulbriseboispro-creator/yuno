/* ============================================================
   AgendaPosterCard — grande carte 1:1 des pages Agenda.

   La page « toutes les soirées » est un scroll simple de grandes
   affiches carrées : image 1:1 pleine largeur, panneau d'infos
   dessous (#141414), CTA rouge. La logique de clic/tracking reste
   dans la page appelante.
   ============================================================ */

const MONO = "'JetBrains Mono', monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

function IconArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5h6M5 2l3 3-3 3"/>
    </svg>
  );
}

export interface AgendaPosterCardProps {
  image: string | null;
  title: string;
  /** Ligne au-dessus du titre : club · ville / orga. */
  topLine?: string | null;
  /** Heure(s), affichée en mono à côté du prix. */
  timeLabel?: string | null;
  priceLabel?: string | null;
  genreLine?: string | null;
  ctaLabel: string;
  live?: boolean;
  soldOut?: boolean;
  soldOutLabel?: string;
  onOpen: () => void;
}

export function AgendaPosterCard({
  image, title, topLine, timeLabel, priceLabel, genreLine, ctaLabel, live, soldOut, soldOutLabel, onOpen,
}: AgendaPosterCardProps) {
  const canHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  return (
    <div
      onClick={() => { if (!soldOut) onOpen(); }}
      role="link"
      tabIndex={soldOut ? -1 : 0}
      onKeyDown={(e) => { if (!soldOut && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      style={{
        borderRadius: '12px',
        border: live ? '1px solid rgba(232,25,44,0.45)' : '1px solid rgba(255,255,255,0.08)',
        background: '#141414',
        overflow: 'hidden',
        cursor: soldOut ? 'default' : 'pointer',
        opacity: soldOut ? 0.55 : 1,
        boxShadow: live ? '0 0 0 1px rgba(232,25,44,0.20)' : 'none',
        transition: 'border-color 250ms ease, transform 250ms cubic-bezier(0.16,1,0.3,1)',
      }}
      onMouseEnter={(e) => {
        if (!canHover || soldOut) return;
        (e.currentTarget as HTMLElement).style.borderColor = live ? 'rgba(232,25,44,0.6)' : 'rgba(255,255,255,0.16)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        if (!canHover) return;
        (e.currentTarget as HTMLElement).style.borderColor = live ? 'rgba(232,25,44,0.45)' : 'rgba(255,255,255,0.08)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Affiche 1:1 */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', background: '#111111' }}>
        {image ? (
          <img
            src={image}
            alt={title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
        )}
        {live && (
          <div
            style={{
              position: 'absolute', top: '10px', left: '10px',
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '4px 9px', borderRadius: '999px',
              background: 'rgba(232,25,44,0.90)',
              backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex', width: '6px', height: '6px' }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '999px', background: '#fff', opacity: 0.75, animation: 'agendaLivePing 1.4s cubic-bezier(0,0,0.2,1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', width: '6px', height: '6px', borderRadius: '999px', background: '#fff' }} />
            </span>
            <span style={{ fontFamily: MONO, fontSize: '9px', fontWeight: 800, letterSpacing: '0.14em', color: '#FFFFFF', textTransform: 'uppercase' as const }}>
              Live
            </span>
          </div>
        )}
        {soldOut && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.60)' }}>
            <span
              style={{
                fontFamily: MONO, fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', color: '#FFFFFF',
                background: 'rgba(232,25,44,0.90)', padding: '5px 10px', borderRadius: '4px', textTransform: 'uppercase' as const,
              }}
            >
              {soldOutLabel ?? 'SOLD OUT'}
            </span>
          </div>
        )}
      </div>

      {/* Panneau d'infos — compact : la carte vit dans une grille 2-3 colonnes */}
      <div style={{ padding: '10px 11px 9px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {topLine && (
          <p
            style={{
              fontFamily: MONO, fontSize: '9px', fontWeight: 600, color: '#9A9A9A',
              letterSpacing: '0.08em', textTransform: 'uppercase' as const, lineHeight: 1, margin: 0,
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {topLine}
          </p>
        )}
        <h3
          style={{
            fontFamily: GROTESK, fontSize: 'clamp(13px, 3.4vw, 15px)', fontWeight: 700, color: '#FFFFFF',
            textTransform: 'uppercase' as const, letterSpacing: '-0.005em', lineHeight: 1.1,
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', margin: 0,
          }}
        >
          {title}
        </h3>
        {(timeLabel || priceLabel || genreLine) && (
          <p
            style={{
              fontFamily: MONO, fontSize: '9.5px', color: '#5A5A5E', letterSpacing: '0.04em', lineHeight: 1.3,
              margin: 0, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {[timeLabel, priceLabel, genreLine].filter(Boolean).join(' · ')}
          </p>
        )}
        <div style={{ display: 'flex', paddingTop: '7px', marginTop: '2px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <span
            style={{
              flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '7px 10px', borderRadius: '999px',
              background: soldOut ? '#2A2A2E' : '#E8192C',
              color: soldOut ? '#9A9A9A' : '#FFFFFF',
              fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const,
            }}
          >
            {ctaLabel}
            {!soldOut && <IconArrow />}
          </span>
        </div>
      </div>
    </div>
  );
}
