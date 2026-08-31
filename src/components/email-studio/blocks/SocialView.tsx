import type { EmailTheme, SocialBlock, SocialLinks } from '@/lib/email';
import { socialChip, socialLabel } from '@/lib/email';
import { blockBgColor, blockPad, type CanvasCtx } from './common';

/**
 * Réseaux = pastilles rondes avec les vrais logos (PNG transparents servis
 * par NOTRE domaine, /email-social/*.png — miroir exact de renderSocial).
 * Pastilles grises vides quand aucun lien n'est renseigné.
 */
export default function SocialView({ block, theme, ctx }: { block: SocialBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const entries = (Object.entries(ctx.socialLinks) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  const { chip, glyph } = socialChip(block.color, theme);
  const bg = blockBgColor(block, theme);
  return (
    <div style={{
      padding: `${pad.py}px ${pad.px}px`, display: 'flex', justifyContent: 'center',
      alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: bg === 'transparent' ? theme.card : bg,
    }}>
      {entries.length === 0 ? (
        [0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 34, height: 34, borderRadius: '50%',
            background: theme.dark ? '#262626' : '#e6e6e6',
          }} />
        ))
      ) : entries.map(([key, url]) => (
        <span
          key={key}
          title={socialLabel(key, url!)}
          style={{
            width: 34, height: 34, borderRadius: '50%', background: chip,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img
            src={`/email-social/${key}-${glyph}.png`}
            alt={socialLabel(key, url!)}
            width={16} height={16}
            style={{ display: 'block' }}
          />
        </span>
      ))}
    </div>
  );
}
