// Shared HTML builder for email campaigns (Edge Function side)

export type EmailBlock =
  | { id: string; type: 'header'; logo_url?: string; venue_name?: string; bg_color?: string; text_color?: string; show_name?: boolean; logo_size?: 'sm' | 'md' | 'lg'; logo_shape?: 'free' | 'rounded' | 'circle' }
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'image'; url: string; alt?: string; link_url?: string; align?: 'left' | 'center' | 'right' }
  | { id: string; type: 'cta'; label: string; url: string; bg_color?: string; text_color?: string; align?: 'left' | 'center' | 'right' }
  | { id: string; type: 'event'; event_id: string; title?: string; date_label?: string; venue_label?: string; cover_url?: string; cta_url?: string; cta_label?: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; size?: 'sm' | 'md' | 'lg' | 'xl' };

export interface EmailTheme {
  bg?: string;
  card_bg?: string;
  header_bg?: string;
  header_text?: string;
  body_text?: string;
  accent?: string;
  button_text?: string;
  link_color?: string;
  divider_color?: string;
  footer_bg?: string;
  footer_text?: string;
  footer_link?: string;
  social_bg?: string;
  social_icon?: string;
}

export interface SocialLinks {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
  website?: string;
}

const DEFAULT_THEME: Required<EmailTheme> = {
  bg: '#f3f4f6',
  card_bg: '#ffffff',
  header_bg: '#0a0a0a',
  header_text: '#ffffff',
  body_text: '#1a1a1a',
  accent: '#dc2626',
  button_text: '#ffffff',
  link_color: '#dc2626',
  divider_color: '#e5e7eb',
  footer_bg: '#f9fafb',
  footer_text: '#6b7280',
  footer_link: '#6b7280',
  social_bg: '#f9fafb',
  social_icon: '777777',
};

export function slugifyVenueName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'club';
}

function escape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOGO_SIZES = { sm: 60, md: 90, lg: 130 };
const SPACER_SIZES = { sm: 8, md: 16, lg: 32, xl: 56 };

function renderBlock(b: EmailBlock, theme: Required<EmailTheme>): string {
  switch (b.type) {
    case 'header': {
      const bg = b.bg_color || theme.header_bg;
      const fg = b.text_color || theme.header_text;
      const size = LOGO_SIZES[b.logo_size || 'md'];
      const radius = b.logo_shape === 'circle' ? '50%' : b.logo_shape === 'rounded' ? '14px' : '0';
      const logo = b.logo_url
        ? `<img src="${escape(b.logo_url)}" alt="${escape(b.venue_name || '')}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:contain;display:block;margin:0 auto 12px;border:0;border-radius:${radius};background:transparent;" />`
        : '';
      const name = b.show_name !== false
        ? `<h1 style="margin:0;font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:${fg};letter-spacing:0.5px;">${escape(b.venue_name || '')}</h1>`
        : '';
      return `<tr><td style="padding:32px 24px;text-align:center;background:${bg};color:${fg};">${logo}${name}</td></tr>`;
    }
    case 'text':
      return `<tr><td style="padding:24px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:${theme.body_text};">${b.html || ''}</td></tr>`;
    case 'image': {
      const align = b.align || 'center';
      const img = `<img src="${escape(b.url)}" alt="${escape(b.alt || '')}" style="max-width:100%;height:auto;display:block;margin:${align === 'center' ? '0 auto' : '0'};border:0;border-radius:6px;" />`;
      const wrapped = b.link_url ? `<a href="${escape(b.link_url)}" target="_blank">${img}</a>` : img;
      return `<tr><td style="padding:16px 24px;text-align:${align};">${wrapped}</td></tr>`;
    }
    case 'cta': {
      const bg = b.bg_color || theme.accent;
      const fg = b.text_color || theme.button_text;
      const align = b.align || 'center';
      return `<tr><td style="padding:24px;text-align:${align};">
        <a href="${escape(b.url)}" target="_blank" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:14px 32px;border-radius:8px;font-size:16px;">${escape(b.label)}</a>
      </td></tr>`;
    }
    case 'event': {
      const cover = b.cover_url
        ? `<img src="${escape(b.cover_url)}" alt="" style="width:100%;height:auto;display:block;border:0;" />`
        : '';
      return `<tr><td style="padding:16px 24px;">
        <table role="presentation" width="100%" style="border:1px solid ${theme.divider_color};border-radius:12px;overflow:hidden;background:${theme.card_bg};">
          <tr><td>${cover}</td></tr>
          <tr><td style="padding:20px;font-family:Arial,sans-serif;">
            <h2 style="margin:0 0 8px;font-size:20px;color:${theme.body_text};">${escape(b.title || '')}</h2>
            <p style="margin:0 0 4px;color:${theme.body_text};opacity:0.7;font-size:14px;">${escape(b.date_label || '')}</p>
            <p style="margin:0 0 16px;color:${theme.body_text};opacity:0.7;font-size:14px;">${escape(b.venue_label || '')}</p>
            ${b.cta_url ? `<a href="${escape(b.cta_url)}" target="_blank" style="display:inline-block;background:${theme.accent};color:${theme.button_text};text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">${escape(b.cta_label || "Voir l'événement")}</a>` : ''}
          </td></tr>
        </table>
      </td></tr>`;
    }
    case 'divider':
      return `<tr><td style="padding:8px 24px;"><hr style="border:none;border-top:1px solid ${theme.divider_color};margin:0;" /></td></tr>`;
    case 'spacer': {
      const h = SPACER_SIZES[b.size || 'md'];
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
    }
    default:
      return '';
  }
}

const SOCIAL_SLUG: Record<keyof SocialLinks, string> = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  facebook: 'facebook',
  x: 'x',
  website: 'safari',
};

function renderSocialRow(links: SocialLinks, theme: Required<EmailTheme>): string {
  const entries = (Object.entries(links) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  if (entries.length === 0) return '';
  const color = (theme.social_icon || '777777').replace('#', '');
  const cells = entries.map(([key, url]) => {
    const href = url!.startsWith('http') ? url! : `https://${url}`;
    return `<a href="${escape(href)}" target="_blank" style="display:inline-block;margin:0 6px;text-decoration:none;"><img src="https://cdn.simpleicons.org/${SOCIAL_SLUG[key]}/${color}" alt="${key}" width="22" height="22" style="display:inline-block;border:0;" /></a>`;
  }).join('');
  return `<tr><td style="padding:20px 24px 4px;text-align:center;background:${theme.social_bg};">${cells}</td></tr>`;
}

export function buildLegalFooter(opts: {
  venueName: string;
  city?: string | null;
  recipientEmail: string;
  emailType: 'promotional' | 'informational';
  unsubscribeUrl?: string;
  platformName?: string;
  theme?: Required<EmailTheme>;
}): string {
  const theme = opts.theme || DEFAULT_THEME;
  const platform = opts.platformName || 'Yuno';
  const year = new Date().getFullYear();
  const reason = opts.emailType === 'promotional' ? 'vous êtes abonné à sa newsletter' : 'vous avez acheté un billet';
  const unsubLine = opts.emailType === 'promotional' && opts.unsubscribeUrl
    ? `<p style="margin:12px 0 0;font-size:11px;color:${theme.footer_link};">Vous ne souhaitez plus recevoir ces emails ? <a href="${opts.unsubscribeUrl}" style="color:${theme.footer_link};text-decoration:underline;">Se désabonner</a></p>`
    : '';
  return `<tr><td style="padding:24px;background:${theme.footer_bg};border-top:1px solid ${theme.divider_color};font-family:Arial,sans-serif;font-size:12px;color:${theme.footer_text};text-align:center;">
    <p style="margin:0 0 8px;font-weight:600;color:${theme.footer_text};">${escape(opts.venueName)}${opts.city ? ' — ' + escape(opts.city) : ''}</p>
    <p style="margin:0 0 8px;">Cet email a été envoyé à <span style="color:${theme.footer_text};">${escape(opts.recipientEmail)}</span> car ${reason} sur ${escape(platform)}.</p>
    <p style="margin:0;">© ${year} ${escape(opts.venueName)} via ${escape(platform)}. Tous droits réservés.</p>
    ${unsubLine}
  </td></tr>`;
}

export function buildCampaignHtml(opts: {
  blocks: EmailBlock[];
  preheader?: string;
  subject: string;
  venueName: string;
  city?: string | null;
  recipientEmail: string;
  emailType: 'promotional' | 'informational';
  unsubscribeUrl?: string;
  firstName?: string;
  lastName?: string;
  theme?: EmailTheme;
  socialLinks?: SocialLinks;
}): string {
  const theme: Required<EmailTheme> = { ...DEFAULT_THEME, ...(opts.theme || {}) };

  const personalize = (s: string) =>
    String(s ?? '')
      .replace(/\{\{\s*prenom\s*\}\}/gi, opts.firstName || '')
      .replace(/\{\{\s*nom\s*\}\}/gi, opts.lastName || '');

  const blocksHtml = opts.blocks.map((b) => {
    const cloned = JSON.parse(JSON.stringify(b));
    if (cloned.type === 'text' && cloned.html) cloned.html = personalize(cloned.html);
    if (cloned.type === 'cta' && cloned.label) cloned.label = personalize(cloned.label);
    return renderBlock(cloned, theme);
  }).join('');

  const footer = buildLegalFooter({ ...opts, theme });
  const socialRow = renderSocialRow(opts.socialLinks || {}, theme);
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#fff;">${escape(personalize(opts.preheader))}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:${theme.bg};font-family:Arial,sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.bg};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${theme.card_bg};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      ${blocksHtml}
      ${socialRow}
      ${footer}
    </table>
  </td></tr>
</table>
</body></html>`;
}
