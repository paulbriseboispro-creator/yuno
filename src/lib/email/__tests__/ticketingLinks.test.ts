// Un lien Shotgun collé à la main (une guest list `?ids=…`) reçoit la source
// de la campagne, dans le rendu de la Console ET dans le port Deno de l'envoi.
import { describe, expect, it } from 'vitest';
import { makeBlock, renderBlock, DEFAULT_STUDIO_THEME } from '../index';
import type { CtaBlock, RenderCtx } from '../types';
import { renderStudioEmailHtml, type StudioBlock } from '../../../../supabase/functions/_shared/email-studio-html.ts';

const ctx: RenderCtx = {
  venueName: 'WOH', city: 'Paris', emailType: 'promotional', subject: 's',
  recipient: { email: 'a@example.com' },
  baseUrl: 'https://yunoapp.eu', campaignId: 'camp-1', ticketingSource: 'yuno-m-ab12cd34',
};

const GL = 'https://shotgun.live/events/woh-revival?ids=1861576';

function cta(url: string): CtaBlock {
  return { ...(makeBlock('cta') as CtaBlock), url, label: 'Je prends ma place' };
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

describe('lien Shotgun collé à la main', () => {
  it('reçoit la source de la campagne et garde le tarif', () => {
    const [href] = hrefs(renderBlock(cta(GL), DEFAULT_STUDIO_THEME, ctx));
    const u = new URL(href);
    expect(u.searchParams.get('ids')).toBe('1861576');
    expect(u.searchParams.get('utm_source')).toBe('yuno-m-ab12cd34');
    expect(u.searchParams.get('utm_medium')).toBe('email');
  });

  it('ne remplace jamais une source déjà posée', () => {
    const [href] = hrefs(renderBlock(cta(`${GL}&utm_source=dj-masza`), DEFAULT_STUDIO_THEME, ctx));
    expect(new URL(href).searchParams.get('utm_source')).toBe('dj-masza');
  });

  it('laisse tel quel un autre site, un test ou un aperçu', () => {
    expect(hrefs(renderBlock(cta('https://instagram.com/woh'), DEFAULT_STUDIO_THEME, ctx))[0]).toBe('https://instagram.com/woh');
    expect(hrefs(renderBlock(cta(GL), DEFAULT_STUDIO_THEME, { ...ctx, ticketingSource: null }))[0]).toBe(GL);
    expect(hrefs(renderBlock(cta(GL), DEFAULT_STUDIO_THEME, { ...ctx, campaignId: undefined }))[0]).toBe(GL);
  });

  it('le port Deno de l’envoi fait pareil', () => {
    const html = renderStudioEmailHtml(
      [cta(GL)] as unknown as StudioBlock[],
      DEFAULT_STUDIO_THEME,
      ctx as unknown as Parameters<typeof renderStudioEmailHtml>[2],
    );
    const href = hrefs(html).find((h) => h.includes('shotgun.live'))!;
    expect(new URL(href).searchParams.get('utm_source')).toBe('yuno-m-ab12cd34');
    expect(new URL(href).searchParams.get('ids')).toBe('1861576');
  });
});
