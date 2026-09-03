import { EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailTheme, TicketsBlock } from '@/lib/email';
import { ctaColors, ticketsCtaLabel } from '@/lib/email';
import { EMAIL_FONT, blockPad, emailBtnStyle, liveFor, type CanvasCtx } from './common';

/**
 * Lignes de tarifs (rowsEl du prototype) : prix accent, épuisé barré.
 * Live branché : la base fait foi — un événement sans billetterie affiche un
 * état vide honnête (et le bloc ne partira pas), jamais des tarifs inventés.
 */
export default function TicketsView({ block, theme, ctx }: { block: TicketsBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const { t } = useLanguage();
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const btnColors = ctaColors(block.accent, theme);
  const accent = btnColors.bg;
  const rows = (block.live && live) ? (live.tickets || []) : block.rows;

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
      <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '13px 16px',
            borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${theme.divider}`,
            fontFamily: EMAIL_FONT,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: r.out ? theme.muted : theme.text }}>{r.n}</div>
              {r.s && <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{r.s}</div>}
            </div>
            <div style={{
              fontSize: 14.5, fontWeight: 700, whiteSpace: 'nowrap',
              color: r.out ? theme.muted : accent,
              textDecoration: r.out ? 'line-through' : 'none',
            }}>{r.p}</div>
          </div>
        ))}
      </div>
      {/* L'email pose un bouton pleine largeur sous les lignes : l'aperçu doit
          le montrer, ne serait-ce que pour lire le libellé — une soirée en
          liste invités seule n'invite pas à « prendre ses billets ». */}
      <span style={{
        ...emailBtnStyle(theme, { radius: 8, full: true, small: true }),
        background: btnColors.bg, color: btnColors.color, marginTop: 12,
      }}>{ticketsCtaLabel(block.live && live?.guestListOnly)}</span>
    </div>
  );
}
