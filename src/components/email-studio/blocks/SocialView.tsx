import type { EmailTheme, SocialBlock, SocialLinks } from '@/lib/email';
import { EMAIL_FONT, type CanvasCtx } from './common';

const SLUGS: Record<keyof SocialLinks, string> = {
  instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', x: 'x', website: 'safari',
};

export default function SocialView({ theme, ctx }: { block: SocialBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const entries = (Object.entries(ctx.socialLinks) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  const color = theme.muted.replace('#', '');
  return (
    <div style={{ padding: '18px 24px 4px', textAlign: 'center' }}>
      {entries.length === 0 ? (
        <p style={{ margin: 0, fontFamily: EMAIL_FONT, fontSize: 12, color: theme.muted }}>
          Ajoute tes réseaux dans Données pour remplir ce bloc
        </p>
      ) : entries.map(([key]) => (
        <img
          key={key}
          src={`https://cdn.simpleicons.org/${SLUGS[key]}/${color}`}
          alt={key} width={20} height={20}
          style={{ display: 'inline-block', margin: '0 7px' }}
        />
      ))}
    </div>
  );
}
