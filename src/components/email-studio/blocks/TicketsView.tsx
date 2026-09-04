import { EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailTheme, TicketRow, TicketsBlock } from '@/lib/email';
import { ctaColors, isPricedRow, SOLD_OUT_CHIP, soldOutSub, ticketsCtaLabel, ticketsKicker } from '@/lib/email';
import { EMAIL_FONT, EMAIL_MONO, blockPad, emailBtnStyle, liveFor, type CanvasCtx } from './common';

/**
 * Bloc Billetterie — miroir exact de renderTickets (src/lib/email/render.ts).
 * Carte de la famille Événement / Table VIP, coiffée d'un kicker accent ; le
 * prix est le point focal, la jauge du club reste en mono discret, et un tarif
 * sans chiffre (« Gratuit ») se rend en pastille : c'est une offre, pas un
 * montant. Live branché : la base fait foi — une soirée sans aucune entrée
 * ouverte affiche un état vide honnête, jamais des tarifs inventés.
 */
export default function TicketsView({ block, theme, ctx }: { block: TicketsBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const { t } = useLanguage();
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const btnColors = ctaColors(block.accent, theme);
  const accent = btnColors.bg;
  const rows: TicketRow[] = (block.live && live) ? (live.tickets || []) : block.rows;
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

  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{
        border: `1px solid ${theme.divider}`, borderRadius: 12, overflow: 'hidden',
        background: theme.dark ? theme.tile : '#ffffff',
      }}>
        <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${theme.divider}` }}>
          <div style={{
            fontFamily: EMAIL_MONO, fontSize: 11, lineHeight: '15px', fontWeight: 700,
            letterSpacing: '0.14em', color: accent,
          }}>{ticketsKicker(guestListOnly)}</div>
        </div>
        {rows.map((r, i) => {
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
                  color: r.out ? theme.muted : accent,
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
        })}
      </div>
      {/* L'email pose un bouton pleine largeur sous la carte : l'aperçu doit le
          montrer, ne serait-ce que pour lire le libellé — une soirée en liste
          invités seule n'invite pas à « prendre ses billets ». */}
      <span style={{
        ...emailBtnStyle(theme, { radius: 10, full: true }),
        background: btnColors.bg, color: btnColors.color, marginTop: 14,
      }}>{ticketsCtaLabel(guestListOnly)}</span>
    </div>
  );
}
