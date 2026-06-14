// Shared types and helpers for email campaign blocks (frontend)

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
  social_icon?: string; // hex without #, used in simpleicons URL
}

export interface SocialLinks {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
  website?: string;
}

export const DEFAULT_THEME: Required<EmailTheme> = {
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

export const THEME_PRESETS: { id: string; name: string; theme: Required<EmailTheme> }[] = [
  { id: 'classic_dark', name: 'Sombre élégant', theme: { ...DEFAULT_THEME } },
  {
    id: 'clean_light', name: 'Clair épuré',
    theme: { ...DEFAULT_THEME, bg: '#fafafa', header_bg: '#ffffff', header_text: '#0a0a0a', accent: '#000000', link_color: '#000000', social_icon: '999999' },
  },
  {
    id: 'yuno_red', name: 'Yuno red',
    theme: { ...DEFAULT_THEME, bg: '#1a0606', header_bg: '#dc2626', accent: '#dc2626', link_color: '#dc2626', footer_bg: '#1a0606', footer_text: '#9ca3af', footer_link: '#fca5a5', social_bg: '#1a0606', social_icon: 'fca5a5' },
  },
  {
    id: 'gold_night', name: 'Or & nuit',
    theme: { bg: '#0a0a0a', card_bg: '#0f0f0f', header_bg: '#0f0f0f', header_text: '#d4af37', body_text: '#f5f5f5', accent: '#d4af37', button_text: '#0a0a0a', link_color: '#d4af37', divider_color: '#262626', footer_bg: '#0a0a0a', footer_text: '#9ca3af', footer_link: '#d4af37', social_bg: '#0a0a0a', social_icon: 'd4af37' },
  },
  {
    id: 'midnight_blue', name: 'Bleu nuit',
    theme: { bg: '#0b1220', card_bg: '#0f172a', header_bg: '#1e293b', header_text: '#e0f2fe', body_text: '#e2e8f0', accent: '#38bdf8', button_text: '#0b1220', link_color: '#38bdf8', divider_color: '#1e293b', footer_bg: '#0b1220', footer_text: '#94a3b8', footer_link: '#7dd3fc', social_bg: '#0b1220', social_icon: '7dd3fc' },
  },
];

export const newBlock = (type: EmailBlock['type'], opts?: Partial<any>): EmailBlock => {
  const id = crypto.randomUUID();
  switch (type) {
    case 'header': return { id, type, venue_name: opts?.venue_name || '', logo_url: opts?.logo_url, show_name: true, logo_size: 'md', logo_shape: 'free' };
    case 'text': return { id, type, html: opts?.html || '<p>Votre texte ici…</p>' };
    case 'image': return { id, type, url: opts?.url || '', align: 'center' };
    case 'cta': return { id, type, label: opts?.label || "Voir l'événement", url: opts?.url || 'https://yunoapp.eu', align: 'center' };
    case 'event': return { id, type, event_id: opts?.event_id || '', title: opts?.title, date_label: opts?.date_label, venue_label: opts?.venue_label, cover_url: opts?.cover_url, cta_url: opts?.cta_url, cta_label: "Voir l'événement" };
    case 'divider': return { id, type };
    case 'spacer': return { id, type, size: 'md' };
  }
};

function escape(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LOGO_SIZES = { sm: 60, md: 90, lg: 130 };
const SPACER_SIZES = { sm: 8, md: 16, lg: 32, xl: 56 };

function renderBlock(b: EmailBlock, theme: Required<EmailTheme>, editable?: boolean): string {
  const html = renderBlockInner(b, theme);
  // In editor mode, tag the block's outer row so the canvas runtime can map
  // clicks back to a block id. Only touches the first <tr — the block wrapper.
  return editable ? html.replace('<tr', `<tr data-block-id="${b.id}"`) : html;
}

function renderBlockInner(b: EmailBlock, theme: Required<EmailTheme>): string {
  switch (b.type) {
    case 'header': {
      const bg = b.bg_color || theme.header_bg;
      const fg = b.text_color || theme.header_text;
      const size = LOGO_SIZES[b.logo_size || 'md'];
      const radius = b.logo_shape === 'circle' ? '50%' : b.logo_shape === 'rounded' ? '14px' : '0';
      const logo = b.logo_url
        ? `<img src="${escape(b.logo_url)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:contain;display:block;margin:0 auto 12px;border:0;border-radius:${radius};background:transparent;" />`
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
      const wrapped = b.link_url ? `<a href="${escape(b.link_url)}" target="_blank" rel="noreferrer">${img}</a>` : img;
      return `<tr><td style="padding:16px 24px;text-align:${align};">${wrapped}</td></tr>`;
    }
    case 'cta': {
      const bg = b.bg_color || theme.accent;
      const fg = b.text_color || theme.button_text;
      const align = b.align || 'center';
      return `<tr><td style="padding:24px;text-align:${align};"><a href="${escape(b.url)}" target="_blank" rel="noreferrer" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:14px 32px;border-radius:8px;font-size:16px;">${escape(b.label)}</a></td></tr>`;
    }
    case 'event': {
      const cover = b.cover_url ? `<img src="${escape(b.cover_url)}" alt="" style="width:100%;height:auto;display:block;border:0;" />` : '';
      return `<tr><td style="padding:16px 24px;"><table role="presentation" width="100%" style="border:1px solid ${theme.divider_color};border-radius:12px;overflow:hidden;background:${theme.card_bg};"><tr><td>${cover}</td></tr><tr><td style="padding:20px;font-family:Arial,sans-serif;"><h2 style="margin:0 0 8px;font-size:20px;color:${theme.body_text};">${escape(b.title || '')}</h2><p style="margin:0 0 4px;color:${theme.body_text};opacity:0.7;font-size:14px;">${escape(b.date_label || '')}</p><p style="margin:0 0 16px;color:${theme.body_text};opacity:0.7;font-size:14px;">${escape(b.venue_label || '')}</p>${b.cta_url ? `<a href="${escape(b.cta_url)}" target="_blank" rel="noreferrer" style="display:inline-block;background:${theme.accent};color:${theme.button_text};text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">${escape(b.cta_label || "Voir l'événement")}</a>` : ''}</td></tr></table></td></tr>`;
    }
    case 'divider':
      return `<tr><td style="padding:8px 24px;"><hr style="border:none;border-top:1px solid ${theme.divider_color};margin:0;" /></td></tr>`;
    case 'spacer': {
      const h = SPACER_SIZES[b.size || 'md'];
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
    }
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
    return `<a href="${escape(href)}" target="_blank" rel="noreferrer" style="display:inline-block;margin:0 6px;text-decoration:none;"><img src="https://cdn.simpleicons.org/${SOCIAL_SLUG[key]}/${color}" alt="${key}" width="22" height="22" style="display:inline-block;border:0;" /></a>`;
  }).join('');
  return `<tr><td style="padding:20px 24px 4px;text-align:center;background:${theme.social_bg};">${cells}</td></tr>`;
}

// Injected only in editor mode: turns the static email into an interactive
// canvas. Clicking a block posts {type:'select'} to the parent; the inline "+"
// zones post {type:'insertAfter'}. The parent drives selection highlight back
// via postMessage({type:'setSelected'}) so editing the selection never reloads
// the iframe (only block/theme edits do).
const EDITOR_CSS = `
[data-block-id]{cursor:pointer;}
[data-block-id]:hover{outline:2px dashed #93c5fd;outline-offset:-2px;}
.yn-sel{outline:2px solid #3b82f6 !important;outline-offset:-2px;}
.yn-ins td{padding:0 !important;height:0;line-height:0;}
.yn-ins-line{position:relative;height:14px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s;cursor:pointer;}
.yn-ins:hover .yn-ins-line,.yn-ins-line:hover{opacity:1;}
.yn-ins-line:before{content:'';position:absolute;left:24px;right:24px;height:2px;background:#3b82f6;border-radius:2px;}
.yn-ins-btn{position:relative;z-index:1;background:#3b82f6;color:#fff;width:20px;height:20px;border-radius:9999px;display:inline-flex;align-items:center;justify-content:center;font:700 14px/1 Arial,sans-serif;}
`;

const EDITOR_RUNTIME = `(function(){
  function post(m){m.source='yuno-email-editor';parent.postMessage(m,'*');}
  document.addEventListener('click',function(e){
    var z=e.target.closest('[data-ins-after]');
    if(z){e.preventDefault();e.stopPropagation();post({type:'insertAfter',id:z.getAttribute('data-ins-after')});return;}
    var el=e.target.closest('[data-block-id]');
    if(el){e.preventDefault();post({type:'select',id:el.getAttribute('data-block-id')});}
    else{post({type:'select',id:null});}
  },true);
  function apply(id){document.querySelectorAll('[data-block-id]').forEach(function(n){n.classList.toggle('yn-sel',n.getAttribute('data-block-id')===id);});}
  window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='setSelected'){apply(d.id);}});
  document.querySelectorAll('tr[data-block-id]').forEach(function(tr){
    var ins=document.createElement('tr');ins.className='yn-ins';ins.setAttribute('data-ins-after',tr.getAttribute('data-block-id'));
    var td=document.createElement('td');td.innerHTML='<div class="yn-ins-line"><span class="yn-ins-btn">+</span></div>';
    ins.appendChild(td);tr.parentNode.insertBefore(ins,tr.nextSibling);
  });
  post({type:'ready'});
})();`;

export function buildPreviewHtml(opts: {
  blocks: EmailBlock[];
  preheader?: string;
  emailType: 'promotional' | 'informational';
  venueName: string;
  city?: string | null;
  recipientEmail?: string;
  theme?: EmailTheme;
  socialLinks?: SocialLinks;
  /** When true, removes the page-level vertical padding so the email card sits flush at the top — matches what Gmail/Outlook actually display. */
  flush?: boolean;
  /** When true, tags blocks and injects the interactive canvas runtime. Never set for actual sends. */
  editable?: boolean;
  /** When true, omit the campaign footer + social row + unsubscribe (for transactional/admin templates). */
  omitFooter?: boolean;
}): string {
  const theme: Required<EmailTheme> = { ...DEFAULT_THEME, ...(opts.theme || {}) };
  const blocksHtml = opts.blocks.map(b => renderBlock(b, theme, opts.editable)).join('');
  const year = new Date().getFullYear();
  const sample = opts.recipientEmail || 'destinataire@example.com';
  const reason = opts.emailType === 'promotional' ? 'vous êtes abonné à sa newsletter' : 'vous avez acheté un billet';
  const unsub = opts.emailType === 'promotional'
    ? `<p style="margin:12px 0 0;font-size:11px;color:${theme.footer_link};">Vous ne souhaitez plus recevoir ces emails ? <a href="#" style="color:${theme.footer_link};text-decoration:underline;">Se désabonner</a></p>`
    : '';
  const socialRow = renderSocialRow(opts.socialLinks || {}, theme);
  const footer = `<tr><td style="padding:24px;background:${theme.footer_bg};border-top:1px solid ${theme.divider_color};font-family:Arial,sans-serif;font-size:12px;color:${theme.footer_text};text-align:center;"><p style="margin:0 0 8px;font-weight:600;color:${theme.footer_text};">${escape(opts.venueName)}${opts.city ? ' — ' + escape(opts.city) : ''}</p><p style="margin:0 0 8px;">Cet email a été envoyé à <span style="color:${theme.footer_text};">${escape(sample)}</span> car ${reason} sur Yuno.</p><p style="margin:0;">© ${year} ${escape(opts.venueName)} via Yuno. Tous droits réservés.</p>${unsub}</td></tr>`;

  const preheader = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escape(opts.preheader)}</div>` : '';
  const wrapperPad = opts.flush ? '0' : '24px 0';
  const editorHead = opts.editable ? `<style>${EDITOR_CSS}</style>` : '';
  const editorScript = opts.editable ? `<script>${EDITOR_RUNTIME}</script>` : '';
  const chrome = opts.omitFooter ? '' : `${socialRow}${footer}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${editorHead}</head><body style="margin:0;padding:0;background:${theme.bg};font-family:Arial,sans-serif;">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.bg};padding:${wrapperPad};"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${theme.card_bg};border-radius:${opts.flush ? '0' : '12px'};overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">${blocksHtml}${chrome}</table></td></tr></table>${editorScript}</body></html>`;
}

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
