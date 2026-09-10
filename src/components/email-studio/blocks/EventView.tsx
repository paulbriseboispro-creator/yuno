import { Fragment } from 'react';
import type { EmailTheme, EventBlock } from '@/lib/email';
import {
  ctaColors, EVENT_META_DATE, EVENT_META_PRICE, EVENT_META_VENUE,
} from '@/lib/email';
import {
  EMAIL_FONT, EMAIL_MONO, blockBgColor, blockPad, liveFor,
  offerCardViewColors, placeholderLabelStyle, splitVariables, stripesBg,
  varChipStyle, type CanvasCtx,
} from './common';
import OfferCardView from './OfferCardView';

/**
 * Aperçu canvas du bloc Soirée — miroir de renderEvent (render.ts).
 *
 * Il passe par la même carte que les blocs Billetterie et Table VIP : c'est ce
 * qui garantit que la mise en page, l'alignement et la place de l'affiche
 * choisis dans l'inspecteur se voient ICI avant de partir. Un aperçu qui ne
 * bouge pas quand on règle est pire que pas d'aperçu.
 */
export default function EventView({ block, theme, ctx, mobile }: {
  block: EventBlock; theme: EmailTheme; ctx: CanvasCtx; mobile?: boolean;
}) {
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const btnColors = ctaColors(block.accent, theme);
  const accent = btnColors.bg;
  const layout = block.layout || 'showcase';
  const align = block.align || 'left';
  const blockBg = blockBgColor(block, theme);
  const c = offerCardViewColors(accent, theme, layout, blockBg);

  const title = live?.title || block.title;
  const dateLabel = live?.dateLabel || block.dateLabel;
  const venueLabel = live?.venueLabel || block.venueLabel;
  const coverUrl = live?.coverUrl || block.coverUrl;

  const chipStyle = varChipStyle(theme, 14);
  const withVars = (text: string) => splitVariables(text).map((part, pi) => (
    part.isVar ? <span key={pi} style={chipStyle}>{part.token}</span> : <Fragment key={pi}>{part.token}</Fragment>
  ));

  // Prix : la base fait foi — un événement sans billetterie n'affiche rien
  // (l'email fait pareil), le montant d'exemple n'existe que sans événement.
  const priceLabel = live ? live.priceFromLabel : 'À partir de 18 €';
  const items: { k: string; v: string; strong?: boolean }[] = [];
  if (dateLabel) items.push({ k: EVENT_META_DATE, v: dateLabel });
  if (block.venue && venueLabel) items.push({ k: EVENT_META_VENUE, v: venueLabel });
  if (block.price && priceLabel) items.push({ k: EVENT_META_PRICE, v: priceLabel, strong: true });

  const display = layout === 'banner' ? 'inline'
    : (layout === 'split' && (block.metaDisplay || 'stack') === 'rows') ? 'stack'
    : (block.metaDisplay || 'stack');
  const useRows = display === 'rows' && items.length > 0;

  const metaRows = useRows ? items.map((it, i) => (
    <div key={i} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '11px 16px', borderTop: i > 0 ? `1px solid ${theme.divider}` : undefined,
    }}>
      <div style={{
        fontFamily: EMAIL_MONO, fontSize: 10.5, lineHeight: '15px', fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.muted, whiteSpace: 'nowrap',
      }}>{it.k}</div>
      <div style={{
        fontFamily: EMAIL_FONT, fontSize: 15, lineHeight: '20px', fontWeight: 700,
        letterSpacing: '-0.01em', color: it.strong ? c.inkOnRows : theme.text, textAlign: 'right',
      }}>{it.v}</div>
    </div>
  )) : null;

  const metaFlow = (!useRows && items.length > 0) ? (
    display === 'inline' ? (
      <div style={{
        fontFamily: EMAIL_MONO, fontSize: 12, lineHeight: '19px', letterSpacing: '0.04em',
        color: theme.muted, textAlign: align, marginBottom: 16,
      }}>{items.map((it) => it.v).join(' · ')}</div>
    ) : (
      <div style={{ marginBottom: 16 }}>
        {items.map((it, i) => (
          <div key={i} style={{
            fontFamily: EMAIL_FONT,
            fontSize: i === 0 ? 15.5 : 14,
            lineHeight: i === 0 ? '21px' : '20px',
            fontWeight: i === 0 || it.strong ? 700 : undefined,
            color: i === 0 ? theme.text : it.strong ? c.inkOnCard : theme.muted,
            textAlign: align,
            marginBottom: i === items.length - 1 ? 0 : 5,
          }}>{it.v}</div>
        ))}
      </div>
    )
  ) : null;

  // Affordance d'édition : l'affiche viendra de la soirée reliée, mais tant
  // qu'on n'en voit pas une, le pro doit comprendre OÙ elle se posera.
  const coverFallback = block.cover ? (
    <div style={{
      height: layout === 'split' ? 190 : 150, background: stripesBg(theme, true),
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px',
      borderRadius: (layout === 'minimal' || layout === 'split') ? 12 : undefined,
    }}>
      <span style={{ ...placeholderLabelStyle(theme), textAlign: 'center' }}>
        {block.eventId || ctx.fallbackEventId ? `cover auto — ${title}` : 'cover auto — relie un événement'}
      </span>
    </div>
  ) : null;

  return (
    <OfferCardView
      theme={theme} pad={pad} blockBg={blockBg} layout={layout} align={align}
      accent={accent} btnColor={btnColors.color} mobile={mobile}
      kicker={block.kicker || undefined}
      title={title ? withVars(title) : null}
      sub={block.sub ? withVars(block.sub) : null}
      perks={block.perks || []}
      extra={metaFlow}
      rows={metaRows}
      ctaLabel={block.ctaLabel}
      full={block.full}
      note={block.note ? withVars(block.note) : null}
      coverUrl={block.cover ? coverUrl : undefined}
      coverFallback={coverFallback}
      coverPos={block.coverPos}
    />
  );
}
