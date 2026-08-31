import type { EmailTheme, SocialBlock, SocialLinks } from '@/lib/email';
import { isHexColor } from '@/lib/email';
import { blockBgColor, blockPad, type CanvasCtx } from './common';

const SLUGS: Record<keyof SocialLinks, string> = {
  instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', x: 'x', website: 'safari',
};

/** Icônes réelles quand les liens existent, pastilles sinon (prototype). */
export default function SocialView({ block, theme, ctx }: { block: SocialBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const entries = (Object.entries(ctx.socialLinks) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  // Couleur d'icône du bloc, sinon muted du thème — hex sans # pour simpleicons.
  const src = isHexColor(block.color) ? block.color.trim() : theme.muted;
  const color = /^#[0-9a-fA-F]{6}$/.test(src) ? src.slice(1) : '7a7a7a';
  const bg = blockBgColor(block, theme);
  return (
    <div style={{
      padding: `${pad.py}px ${pad.px}px`, display: 'flex', justifyContent: 'center', gap: 14,
      background: bg === 'transparent' ? theme.card : bg,
    }}>
      {entries.length === 0 ? (
        [0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 22, height: 22, borderRadius: 6,
            background: theme.dark ? '#262626' : '#e6e6e6',
          }} />
        ))
      ) : entries.map(([key]) => (
        <img
          key={key}
          src={`https://cdn.simpleicons.org/${SLUGS[key]}/${color}`}
          alt={key} width={20} height={20}
          style={{ display: 'inline-block' }}
        />
      ))}
    </div>
  );
}
