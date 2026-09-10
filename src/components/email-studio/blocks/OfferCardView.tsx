import type { CSSProperties, ReactNode } from 'react';
import type { EmailTheme, OfferLayout } from '@/lib/email';
import { mixHex } from '@/lib/email';
import { EMAIL_FONT, EMAIL_MONO, emailBtnStyle, offerCardViewColors } from './common';

/**
 * Carte d'offre du canvas — miroir de offerCard (src/lib/email/render.ts).
 *
 * Les blocs Billetterie et Table VIP partagent leur mise en page ; seules
 * leurs LIGNES de tarifs diffèrent. La dupliquer ici aurait garanti qu'elle
 * diverge du rendu email au premier correctif — et un aperçu qui ment est
 * pire que pas d'aperçu.
 */
export interface OfferCardViewProps {
  theme: EmailTheme;
  pad: { px: number; py: number };
  /** Fond du bloc, déjà résolu par le canvas ('transparent' possible). */
  blockBg: string;
  layout: OfferLayout;
  align: 'left' | 'center' | 'right';
  /** Accent BRUT (aplats : bouton, pastilles). */
  accent: string;
  btnColor: string;
  kicker?: ReactNode;
  chip?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  perks?: string[];
  /** Lignes de tarifs, rendues par le bloc appelant. */
  rows?: ReactNode;
  /** Bloc libre à la place des tarifs (prix d'appel en gros). */
  extra?: ReactNode;
  ctaLabel?: string;
  full?: boolean;
  note?: ReactNode;
  coverUrl?: string;
  coverPos?: 'top' | 'bottom';
  /**
   * Repli de l'affiche quand le bloc n'en a pas encore : le canvas montre un
   * placeholder hachuré là où l'email n'affichera rien. C'est une affordance
   * d'édition, jamais quelque chose qui part.
   */
  coverFallback?: ReactNode;
  /** Aperçu téléphone : le côte à côte s'empile, comme sous 620 px en email. */
  mobile?: boolean;
}

export default function OfferCardView(p: OfferCardViewProps) {
  const { theme, pad, layout, align, accent } = p;
  const c = offerCardViewColors(accent, theme, layout, p.blockBg);
  const perks = p.perks || [];
  const coverAtTop = (p.coverPos || 'top') === 'top';
  const titleSize = layout === 'banner' ? 24 : layout === 'split' ? 19 : 22;

  const coverEl = p.coverUrl ? (
    <img src={p.coverUrl} alt="" style={{
      display: 'block', width: '100%', height: 'auto',
      borderRadius: (layout === 'minimal' || layout === 'split') ? 12 : undefined,
    }} />
  ) : p.coverFallback ?? null;
  // Côte à côte SANS affiche : une seule colonne, comme le rendu email — on
  // n'ouvre pas une demi-largeur vide.
  const split = layout === 'split' && !!coverEl;

  const body = (
    <>
      {coverEl && coverAtTop && !split && layout === 'minimal' && <div style={{ marginBottom: 16 }}>{coverEl}</div>}
      {(p.kicker || p.chip) && (
        <div style={{ marginBottom: layout === 'minimal' ? 9 : 11, textAlign: align }}>
          {p.kicker && (
            <span style={{
              fontFamily: EMAIL_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: c.inkOnCard, marginRight: p.chip ? 10 : 0,
            }}>{p.kicker}</span>
          )}
          {p.chip}
        </div>
      )}
      {p.title && (
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: titleSize, fontWeight: 800, letterSpacing: '-0.02em',
          lineHeight: `${titleSize + 6}px`, color: theme.text, textAlign: align,
          marginBottom: p.sub ? 8 : 14,
        }}>{p.title}</div>
      )}
      {p.sub && (
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: 14.5, lineHeight: '22px', color: theme.muted,
          textAlign: align, marginBottom: perks.length || p.rows || p.extra ? 16 : 18,
        }}>{p.sub}</div>
      )}
      {layout !== 'banner' && perks.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {perks.filter((x) => String(x || '').trim()).map((text, i) => (
            <div key={i} style={{
              fontFamily: EMAIL_FONT, fontSize: 13.5, lineHeight: '19px',
              color: theme.text, textAlign: align, marginBottom: 7,
            }}>
              <span style={{ fontWeight: 800, color: c.inkOnCard }}>✓</span>&nbsp;&nbsp;{text}
            </div>
          ))}
        </div>
      )}
      {p.extra}
      {p.rows && (
        <div style={{
          border: `1px solid ${theme.divider}`, borderRadius: 10,
          background: c.baseCard, marginBottom: 18, overflow: 'hidden',
        }}>{p.rows}</div>
      )}
      {coverEl && !coverAtTop && !split && <div style={{ marginBottom: 18 }}>{coverEl}</div>}
      {p.ctaLabel && (
        <div style={{ textAlign: align }}>
          <span style={{
            ...emailBtnStyle(theme, { radius: 10, full: p.full ?? (layout !== 'minimal') }),
            background: accent, color: p.btnColor,
          }}>{p.ctaLabel}</span>
        </div>
      )}
      {p.note && (
        <div style={{
          fontFamily: EMAIL_MONO, fontSize: 11, lineHeight: '16px', letterSpacing: '0.03em',
          color: theme.muted, textAlign: align, marginTop: 11,
        }}>{p.note}</div>
      )}
    </>
  );

  // Les deux cellules s'empilent sur l'aperçu téléphone, exactement comme
  // `.yn-col` le fait sous 620 px dans l'email.
  const laid = split ? (
    <div style={{ display: 'flex', flexDirection: p.mobile ? 'column' : 'row', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: p.mobile ? undefined : '0 0 40%', width: p.mobile ? '100%' : undefined }}>{coverEl}</div>
      <div style={{ flex: '1 1 auto', minWidth: 0, width: p.mobile ? '100%' : undefined }}>{body}</div>
    </div>
  ) : body;

  if (layout === 'minimal') {
    return <div style={{ padding: `${pad.py}px ${pad.px}px` }}>{laid}</div>;
  }

  const bannerBg = mixHex(accent, c.baseCard, theme.dark ? 0.18 : 0.10);
  const shell: CSSProperties = {
    border: `1px solid ${layout === 'banner' ? mixHex(accent, theme.divider, 0.55) : c.cardBorder}`,
    borderRadius: 14,
    background: layout === 'banner' ? bannerBg : c.cardBg,
    overflow: 'hidden',
  };
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={shell}>
        {coverEl && coverAtTop && !split && coverEl}
        <div style={{ padding: layout === 'banner' ? '26px 24px' : layout === 'split' ? '18px' : '22px 20px' }}>{laid}</div>
      </div>
    </div>
  );
}
