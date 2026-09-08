import { Fragment } from 'react';
import type { EmailTheme, TableBlock, TablePackRow } from '@/lib/email';
import { ctaColors, mixHex, readableOn, tablesLeftLabel, VIP_GOLD } from '@/lib/email';
import {
  EMAIL_FONT, EMAIL_MONO, blockPad, emailBtnStyle, liveFor,
  splitVariables, varChipStyle, type CanvasCtx,
} from './common';

/**
 * Aperçu canvas du bloc Table VIP — miroir de renderTable (render.ts).
 * Le pro doit voir la carte qui partira : les formules, leurs prix, la rareté
 * et l'alignement. Un aperçu qui simplifie se paie à la réception.
 */
export default function TableView({ block, theme, ctx }: { block: TableBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const btnColors = ctaColors(block.accent, theme);
  const accent = btnColors.bg;
  const layout = block.layout || 'showcase';
  const align = block.align || 'left';
  const left = live?.tablesLeft;
  const soldOut = typeof left === 'number' && left <= 0;

  const livePacks = block.livePacks !== false;
  const hidden = block.hiddenPacks || [];
  const liveRows = block.packDisplay === 'zones' ? live?.tableZones : live?.tablePacks;
  const allPacks: TablePackRow[] = (livePacks && liveRows) ? liveRows : (block.packs || []);
  const packs = hidden.length ? allPacks.filter((p) => !p.id || !hidden.includes(p.id)) : allPacks;
  const coverAtTop = (block.coverPos || 'top') === 'top';
  const coverEl = block.coverUrl
    ? <img src={block.coverUrl} alt={block.title || 'Table VIP'}
        style={{ display: 'block', width: '100%', height: 'auto', borderRadius: layout === 'minimal' ? 12 : undefined }} />
    : null;
  const showPacks = !soldOut && layout !== 'banner' && packs.length > 0;

  const baseCard = theme.dark ? theme.tile : '#ffffff';
  const cardBg = mixHex(accent, baseCard, theme.dark ? 0.10 : 0.05);
  const cardBorder = mixHex(accent, theme.divider, 0.42);
  // Le bouton garde l'accent brut ; l'accent en TEXTE passe par une teinte
  // lisible sur son fond (miroir de renderTable).
  const inkOnCard = readableOn(accent, layout === 'minimal' ? theme.card : cardBg);
  const inkOnPacks = readableOn(accent, baseCard);

  const chipStyle = varChipStyle(theme, 14);
  const withVars = (text: string) => splitVariables(text).map((part, pi) => (
    part.isVar ? <span key={pi} style={chipStyle}>{part.token}</span> : <Fragment key={pi}>{part.token}</Fragment>
  ));

  const perks = (!soldOut && layout !== 'banner' && block.perks?.length) ? block.perks : [];
  const titleSize = layout === 'banner' ? 24 : 22;
  const full = block.full ?? (layout !== 'minimal');

  const scarcity = typeof left === 'number' ? (
    <span style={{
      display: 'inline-block', padding: '5px 10px', borderRadius: 999,
      background: soldOut ? theme.divider : mixHex(VIP_GOLD, cardBg, theme.dark ? 0.20 : 0.17),
      color: soldOut ? theme.muted : readableOn(VIP_GOLD, mixHex(VIP_GOLD, cardBg, theme.dark ? 0.20 : 0.17)),
      fontFamily: EMAIL_MONO, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>{tablesLeftLabel(left)}</span>
  ) : null;

  const body = (
    <>
      {coverEl && coverAtTop && layout === 'minimal' && (
        <div style={{ marginBottom: 16 }}>{coverEl}</div>
      )}
      {(block.kicker || scarcity) && (
        <div style={{ marginBottom: layout === 'minimal' ? 9 : 11, textAlign: align }}>
          {block.kicker && (
            <span style={{
              fontFamily: EMAIL_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: inkOnCard, marginRight: scarcity ? 10 : 0,
            }}>{block.kicker}</span>
          )}
          {scarcity}
        </div>
      )}
      <div style={{
        fontFamily: EMAIL_FONT, fontSize: titleSize, fontWeight: 800, letterSpacing: '-0.02em',
        lineHeight: `${titleSize + 6}px`, color: theme.text, textAlign: align,
        marginBottom: block.sub ? 8 : 14,
      }}>{withVars(block.title)}</div>
      {block.sub && (
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: 14.5, lineHeight: '22px', color: theme.muted,
          textAlign: align, marginBottom: perks.length || showPacks ? 16 : 18,
        }}>{withVars(block.sub)}</div>
      )}
      {perks.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {perks.filter((t) => String(t || '').trim()).map((text, i) => (
            <div key={i} style={{
              fontFamily: EMAIL_FONT, fontSize: 13.5, lineHeight: '19px',
              color: theme.text, textAlign: align, marginBottom: 7,
            }}>
              <span style={{ fontWeight: 800, color: inkOnCard }}>✓</span>&nbsp;&nbsp;{text}
            </div>
          ))}
        </div>
      )}
      {showPacks && (
        <div style={{
          border: `1px solid ${theme.divider}`, borderRadius: 10,
          background: baseCard, marginBottom: 18, overflow: 'hidden',
        }}>
          {packs.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '13px 16px', borderTop: i > 0 ? `1px solid ${theme.divider}` : undefined,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: EMAIL_FONT, fontSize: 15, fontWeight: 700,
                  letterSpacing: '-0.01em', lineHeight: '20px', color: theme.text,
                }}>{r.n}</div>
                {r.s && (
                  <div style={{
                    fontFamily: EMAIL_MONO, fontSize: 11.5, lineHeight: '16px',
                    letterSpacing: '0.02em', color: theme.muted, marginTop: 4,
                  }}>{r.s}</div>
                )}
              </div>
              <div style={{
                fontFamily: EMAIL_FONT, fontSize: 17, fontWeight: 800,
                letterSpacing: '-0.02em', color: inkOnPacks, whiteSpace: 'nowrap',
              }}>{r.p}</div>
            </div>
          ))}
        </div>
      )}
      {coverEl && !coverAtTop && <div style={{ marginBottom: 18 }}>{coverEl}</div>}
      {!soldOut && (
        <div style={{ textAlign: align }}>
          <span style={{
            ...emailBtnStyle(theme, { radius: 10, full }),
            background: btnColors.bg, color: btnColors.color,
          }}>{block.ctaLabel}</span>
        </div>
      )}
      {block.note && !soldOut && (
        <div style={{
          fontFamily: EMAIL_MONO, fontSize: 11, lineHeight: '16px', letterSpacing: '0.03em',
          color: theme.muted, textAlign: align, marginTop: 11,
        }}>{withVars(block.note)}</div>
      )}
    </>
  );

  if (layout === 'minimal') {
    return <div style={{ padding: `${pad.py}px ${pad.px}px` }}>{body}</div>;
  }

  const bannerBg = mixHex(accent, baseCard, theme.dark ? 0.18 : 0.10);
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{
        border: `1px solid ${layout === 'banner' ? mixHex(accent, theme.divider, 0.55) : cardBorder}`,
        borderRadius: 14, background: layout === 'banner' ? bannerBg : cardBg, overflow: 'hidden',
      }}>
        {coverEl && coverAtTop && coverEl}
        <div style={{ padding: layout === 'banner' ? '26px 24px' : '22px 20px' }}>{body}</div>
      </div>
    </div>
  );
}
