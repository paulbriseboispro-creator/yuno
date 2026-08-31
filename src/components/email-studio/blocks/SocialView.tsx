import type { EmailTheme, SocialBlock, SocialLinks } from '@/lib/email';
import { type CanvasCtx } from './common';

const SLUGS: Record<keyof SocialLinks, string> = {
  instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', x: 'x', website: 'safari',
};

/** Icônes réelles quand les liens existent, pastilles sinon (prototype). */
export default function SocialView({ theme, ctx }: { block: SocialBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const entries = (Object.entries(ctx.socialLinks) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  const color = theme.muted.replace('#', '');
  return (
    <div style={{
      padding: '18px 24px', display: 'flex', justifyContent: 'center', gap: 14,
      background: theme.card,
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
