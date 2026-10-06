import { Music2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailTheme, LineupArtist, LineupBlock } from '@/lib/email';
import {
  LINEUP_AVATAR, LINEUP_KICKER, artistInitials, lineupArtists, lineupColors, lineupRows, lineupUsesPhotos,
} from '@/lib/email';
import { EMAIL_FONT, EMAIL_MONO, blockBgColor, blockPad, liveFor, type CanvasCtx } from './common';

/**
 * Bloc Line-up — miroir de renderLineup (src/lib/email/render.ts) : liste de
 * noms, ou grille de photos rondes trois par rangée. Sans artiste connu, le
 * canvas dit que le bloc ne partira pas (l'email, lui, l'efface) : jamais de
 * noms d'exemple qui pourraient partir chez un client.
 */
export default function LineupView({ block, theme, ctx }: { block: LineupBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const { t } = useLanguage();
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const bg = blockBgColor(block, theme);
  const artists = lineupArtists(live?.lineup, block);
  const c = lineupColors(block.accent, theme, bg);

  if (artists.length === 0) {
    return (
      <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
        <div style={{
          border: `1px dashed ${theme.divider}`, borderRadius: 12, padding: '18px 16px',
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', textAlign: 'center',
        }}>
          <Music2 size={14} strokeWidth={1.75} style={{ color: theme.muted, flex: 'none' }} />
          <span style={{ fontFamily: EMAIL_FONT, fontSize: 12.5, color: theme.muted, lineHeight: 1.5 }}>
            {t(live ? 'studio.lineup.none' : 'studio.lineup.unlinked')}
          </span>
        </div>
      </div>
    );
  }

  const kickerText = block.kicker ?? LINEUP_KICKER;
  const grid = lineupUsesPhotos(block.photos, artists);
  const align = grid ? 'center' : (block.align || 'left');
  const D = LINEUP_AVATAR;

  const kicker = kickerText ? (
    <div style={{
      margin: `0 0 ${grid ? 14 : 10}px`, fontFamily: EMAIL_MONO, fontSize: 11, lineHeight: '16px', fontWeight: 700,
      letterSpacing: '0.16em', textTransform: 'uppercase', color: c.kicker, textAlign: align,
    }}>{kickerText}</div>
  ) : null;

  if (!grid) {
    return (
      <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
        {kicker}
        {artists.map((a, i) => (
          <div key={`${a.name}-${i}`} style={{
            margin: i === artists.length - 1 ? 0 : '0 0 6px', fontFamily: EMAIL_FONT, fontSize: 21, lineHeight: '27px',
            fontWeight: 800, letterSpacing: '-0.02em', color: c.ink, textAlign: align, overflowWrap: 'break-word',
          }}>{a.name}</div>
        ))}
      </div>
    );
  }

  const face = (a: LineupArtist) => (a.photo ? (
    <img src={a.photo} alt={a.name} width={D} height={D} style={{ display: 'block', width: D, height: D, borderRadius: D / 2, objectFit: 'cover', margin: '0 auto' }} />
  ) : (
    <div style={{
      width: D, height: D, borderRadius: D / 2, margin: '0 auto', background: c.chip, color: c.chipInk,
      display: 'grid', placeItems: 'center', fontFamily: EMAIL_FONT, fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em',
    }}>{artistInitials(a.name)}</div>
  ));

  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      {kicker}
      {lineupRows(artists).map((row, ri) => (
        <div key={ri} style={{ display: 'flex', width: `${Math.round((row.length / 3) * 100)}%`, margin: '0 auto' }}>
          {row.map((a, i) => (
            <div key={`${a.name}-${i}`} style={{ flex: 1, minWidth: 0, padding: '8px 4px', textAlign: 'center' }}>
              {face(a)}
              <div style={{
                marginTop: 10, fontFamily: EMAIL_FONT, fontSize: 15, lineHeight: '19px', fontWeight: 700,
                letterSpacing: '-0.01em', color: c.ink, overflowWrap: 'break-word',
              }}>{a.name}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
