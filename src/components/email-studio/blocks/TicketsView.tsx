import { Fragment } from 'react';
import { EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailTheme, TicketRow, TicketsBlock } from '@/lib/email';
import {
  ctaColors, isPricedRow, priceFromLabel, SOLD_OUT_CHIP, soldOutSub, splitFromLabel,
  ticketsCtaLabel, ticketsKicker,
} from '@/lib/email';
import {
  EMAIL_FONT, EMAIL_MONO, blockBgColor, blockPad, liveFor,
  offerCardViewColors, splitVariables, varChipStyle, type CanvasCtx,
} from './common';
import OfferCardView from './OfferCardView';

/**
 * Bloc Billetterie — miroir de renderTickets (src/lib/email/render.ts).
 * Mêmes réglages que le bloc Table VIP : les deux vendent une entrée sous
 * deux formes et partagent leur carte. Le prix reste le point focal, la jauge
 * du club en mono discret, et un tarif sans chiffre (« Gratuit ») se rend en
 * pastille : c'est une offre, pas un montant. Live branché, la base fait foi.
 */
export default function TicketsView({ block, theme, ctx }: { block: TicketsBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const { t } = useLanguage();
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const btnColors = ctaColors(block.accent, theme);
  const accent = btnColors.bg;
  const layout = block.layout || 'showcase';
  const align = block.align || 'left';
  const blockBg = blockBgColor(block, theme);

  const all: TicketRow[] = (block.live && live) ? (live.tickets || []) : block.rows;
  const hidden = block.hiddenRows || [];
  const rows = hidden.length ? all.filter((r) => !r.id || !hidden.includes(r.id)) : all;
  const guestListOnly = !!block.live && live?.guestListOnly;

  if (!rows || rows.length === 0) {
    return (
      <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
        <div style={{
          border: `1px dashed ${theme.divider}`, borderRadius: 12, padding: '18px 16px',
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center',
        }}>
          <EyeOff size={14} strokeWidth={1.75} style={{ color: theme.muted, flex: 'none' }} />
          <span style={{ fontFamily: EMAIL_FONT, fontSize: 12.5, color: theme.muted, lineHeight: 1.5 }}>
            {t('studio.inspector.ticketsNone')}
          </span>
        </div>
      </div>
    );
  }

  const c = offerCardViewColors(accent, theme, layout, blockBg);
  const chipStyle = varChipStyle(theme, 14);
  const withVars = (text: string) => splitVariables(text).map((part, pi) => (
    part.isVar ? <span key={pi} style={chipStyle}>{part.token}</span> : <Fragment key={pi}>{part.token}</Fragment>
  ));

  const fromLabel = live?.priceFromLabel || priceFromLabel(
    rows.filter((r) => !r.out && isPricedRow(r.p)).map((r) => parseFloat(r.p.replace(',', '.')) || 0),
    rows.some((r) => !isPricedRow(r.p)),
  );
  const showRows = layout !== 'banner' && block.priceDisplay !== 'from';
  const from = (layout !== 'banner' && block.priceDisplay === 'from' && fromLabel)
    ? splitFromLabel(fromLabel) : null;

  return (
    <OfferCardView
      theme={theme} pad={pad} blockBg={blockBg} layout={layout} align={align}
      accent={accent} btnColor={btnColors.color}
      kicker={block.kicker ?? ticketsKicker(guestListOnly)}
      title={block.title ? withVars(block.title) : null}
      sub={block.sub ? withVars(block.sub) : null}
      perks={block.perks || []}
      extra={from ? (
        <div style={{ marginBottom: 18, textAlign: align }}>
          {from.label && (
            <div style={{
              fontFamily: EMAIL_MONO, fontSize: 11, lineHeight: '15px', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: theme.muted, marginBottom: 3,
            }}>{from.label}</div>
          )}
          <div style={{
            fontFamily: EMAIL_FONT, fontSize: 32, lineHeight: '38px', fontWeight: 800,
            letterSpacing: '-0.03em', color: c.inkOnCard,
          }}>{from.value}</div>
        </div>
      ) : null}
      rows={showRows ? rows.map((r, i) => {
        const sub = r.out ? soldOutSub(r.s) : r.s;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
            padding: '16px 18px',
            borderTop: i === 0 ? 'none' : `1px solid ${theme.divider}`,
            fontFamily: EMAIL_FONT,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 17, lineHeight: '22px', fontWeight: 600, letterSpacing: '-0.01em',
                color: r.out ? theme.muted : theme.text,
              }}>{r.n}</div>
              {sub && (
                <div style={{
                  fontFamily: EMAIL_MONO, fontSize: 12, lineHeight: '17px', letterSpacing: '0.02em',
                  color: theme.muted, marginTop: 5,
                }}>{sub}</div>
              )}
              {r.out && (
                <div style={{
                  display: 'inline-block', marginTop: 7, padding: '4px 8px',
                  background: theme.divider, borderRadius: 3,
                  fontFamily: EMAIL_MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                  color: theme.muted,
                }}>{SOLD_OUT_CHIP}</div>
              )}
            </div>
            {isPricedRow(r.p) ? (
              <div style={{
                fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
                color: r.out ? theme.muted : c.inkOnRows,
                textDecoration: r.out ? 'line-through' : 'none',
              }}>{r.p}</div>
            ) : (
              <div style={{
                padding: '7px 13px', borderRadius: 999, whiteSpace: 'nowrap',
                background: r.out ? theme.divider : accent,
                color: r.out ? theme.muted : btnColors.color,
                fontSize: 12.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>{r.p}</div>
            )}
          </div>
        );
      }) : null}
      ctaLabel={block.ctaLabel || ticketsCtaLabel(guestListOnly)}
      full={block.full}
      note={block.note ? withVars(block.note) : null}
      coverUrl={block.coverUrl}
      coverPos={block.coverPos}
    />
  );
}
