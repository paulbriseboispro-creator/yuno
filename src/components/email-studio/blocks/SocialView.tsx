import type { EmailTheme, SocialBlock, SocialLinks } from '@/lib/email';
import { isHexColor, socialLabel } from '@/lib/email';
import { EMAIL_FONT, blockBgColor, blockPad, type CanvasCtx } from './common';

/**
 * Réseaux = liens texte stylés (miroir exact de renderSocial dans render.ts).
 * Plus d'icônes-images : les SVG d'un CDN tiers étaient bloqués par Gmail et
 * invisibles dès que le CDN ne répondait pas. Pastilles quand aucun lien.
 */
export default function SocialView({ block, theme, ctx }: { block: SocialBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const entries = (Object.entries(ctx.socialLinks) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  const color = isHexColor(block.color) ? block.color.trim() : theme.muted;
  const bg = blockBgColor(block, theme);
  return (
    <div style={{
      padding: `${pad.py}px ${pad.px}px`, display: 'flex', justifyContent: 'center',
      alignItems: 'center', flexWrap: 'wrap', columnGap: 0,
      background: bg === 'transparent' ? theme.card : bg,
    }}>
      {entries.length === 0 ? (
        [0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 22, height: 22, borderRadius: 6, margin: '0 7px',
            background: theme.dark ? '#262626' : '#e6e6e6',
          }} />
        ))
      ) : entries.map(([key, url], i) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {i > 0 && <span style={{ color, opacity: 0.45, fontFamily: EMAIL_FONT, fontSize: 12.5 }}>&nbsp;·&nbsp;</span>}
          <span style={{
            margin: '0 4px', fontFamily: EMAIL_FONT, fontSize: 12.5, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase', color,
          }}>{socialLabel(key, url!)}</span>
        </span>
      ))}
    </div>
  );
}
