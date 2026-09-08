import { Fragment } from 'react';
import type { EmailTheme, TableBlock, TablePackRow } from '@/lib/email';
import { ctaColors, mixHex, readableOn, tablesLeftLabel, VIP_GOLD } from '@/lib/email';
import {
  EMAIL_FONT, EMAIL_MONO, blockBgColor, blockPad, liveFor,
  offerCardViewColors, splitVariables, varChipStyle, type CanvasCtx,
} from './common';
import OfferCardView from './OfferCardView';

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
  const blockBg = blockBgColor(block, theme);
  const left = live?.tablesLeft;
  const soldOut = typeof left === 'number' && left <= 0;

  const livePacks = block.livePacks !== false;
  const hidden = block.hiddenPacks || [];
  const liveRows = block.packDisplay === 'zones' ? live?.tableZones : live?.tablePacks;
  const allPacks: TablePackRow[] = (livePacks && liveRows) ? liveRows : (block.packs || []);
  const packs = hidden.length ? allPacks.filter((p) => !p.id || !hidden.includes(p.id)) : allPacks;
  const showPacks = !soldOut && layout !== 'banner' && packs.length > 0;

  const c = offerCardViewColors(accent, theme, layout, blockBg);
  const chipStyle = varChipStyle(theme, 14);
  const withVars = (text: string) => splitVariables(text).map((part, pi) => (
    part.isVar ? <span key={pi} style={chipStyle}>{part.token}</span> : <Fragment key={pi}>{part.token}</Fragment>
  ));

  const scarcityBg = mixHex(VIP_GOLD, c.cardBg, theme.dark ? 0.20 : 0.17);
  const scarcity = typeof left === 'number' ? (
    <span style={{
      display: 'inline-block', padding: '5px 10px', borderRadius: 999,
      background: soldOut ? theme.divider : scarcityBg,
      color: soldOut ? theme.muted : readableOn(VIP_GOLD, scarcityBg),
      fontFamily: EMAIL_MONO, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>{tablesLeftLabel(left)}</span>
  ) : null;

  return (
    <OfferCardView
      theme={theme} pad={pad} blockBg={blockBg} layout={layout} align={align}
      accent={accent} btnColor={btnColors.color}
      kicker={block.kicker} chip={scarcity}
      title={block.title ? withVars(block.title) : null}
      sub={block.sub ? withVars(block.sub) : null}
      perks={soldOut ? [] : (block.perks || [])}
      rows={showPacks ? packs.map((r, i) => (
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
            letterSpacing: '-0.02em', color: c.inkOnRows, whiteSpace: 'nowrap',
          }}>{r.p}</div>
        </div>
      )) : null}
      ctaLabel={soldOut ? undefined : block.ctaLabel}
      full={block.full}
      note={block.note && !soldOut ? withVars(block.note) : null}
      coverUrl={block.coverUrl}
      coverPos={block.coverPos}
    />
  );
}
