// « Vos clients » (exception clients) : le pied de page d'un e-mail envoyé à un
// client dit pourquoi il le reçoit, et les deux moteurs (Console et envoi Deno)
// rendent la même chose.
import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_THEME, makeBlock, renderEmailHtml } from '@/lib/email';
import type { EmailBlock, RenderCtx } from '@/lib/email/types';
import { renderStudioEmailHtml, type StudioBlock } from '../../../../supabase/functions/_shared/email-studio-html.ts';

const base: RenderCtx = {
  venueName: '3 AM', emailType: 'promotional', subject: 'Samedi', preheader: '',
  recipient: { email: 'camille@example.com' }, unsubscribeUrl: 'https://yunoapp.eu/unsubscribe?token=t',
  socialLinks: {}, baseUrl: 'https://yunoapp.eu', now: new Date('2026-10-29T12:00:00Z'),
};
const blocks: EmailBlock[] = [{ ...makeBlock('text'), body: 'On rouvre samedi.' } as EmailBlock];

function both(ctx: RenderCtx): string[] {
  return [
    renderEmailHtml(blocks, DEFAULT_STUDIO_THEME, ctx),
    renderStudioEmailHtml(blocks as unknown as StudioBlock[], DEFAULT_STUDIO_THEME, ctx as unknown as Parameters<typeof renderStudioEmailHtml>[2]),
  ];
}

describe('pied de page « Vos clients »', () => {
  it('dit la soirée et le mois, garde le lien de désinscription, à l’octet près dans les deux moteurs', () => {
    const [front, deno] = both({ ...base, customerReason: { night: 'Nuit Noire', when: 'octobre 2026' } });
    expect(front).toBe(deno);
    expect(front).toContain('vous avez pris une place pour « Nuit Noire » (octobre 2026)');
    expect(front).toContain('vous pouvez vous désinscrire en un clic');
    expect(front).toContain('Se désabonner');
    expect(front).not.toContain('abonné à sa newsletter');
  });

  it('sans soirée connue, une phrase générale', () => {
    const [front, deno] = both({ ...base, customerReason: { night: '', when: '' } });
    expect(front).toBe(deno);
    expect(front).toContain('vous avez pris une place à l’une de nos soirées'.replace('’', "'"));
  });

  it('suit la langue de l’e-mail et échappe le titre', () => {
    const [en] = both({ ...base, language: 'en', customerReason: { night: 'A & B', when: 'October 2026' } });
    expect(en).toContain('you got a place for “A &amp; B” (October 2026)');
    const [es] = both({ ...base, language: 'es', customerReason: { night: 'Fiesta', when: 'octubre de 2026' } });
    expect(es).toContain('conseguiste una entrada para «Fiesta» (octubre de 2026)');
  });

  it('un destinataire à l’accord garde le pied de page d’avant', () => {
    const [front, deno] = both(base);
    expect(front).toBe(deno);
    expect(front).toContain('abonné à sa newsletter');
  });
});
