// L'e-mail PRATIQUE aux détenteurs d'une soirée (S11) : le rendu des deux
// moteurs (Console et envoi Deno) et le modèle de départ de la Console.
import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_THEME, makeBlock, renderEmailHtml } from '@/lib/email';
import type { EmailBlock, RenderCtx } from '@/lib/email/types';
import { renderStudioEmailHtml, type StudioBlock } from '../../../../supabase/functions/_shared/email-studio-html.ts';
import { CRM_DICT } from '@/i18n/locales/crm/modules';
import {
  PRACTICAL_BLOCK_TYPES, buildPracticalEmail, hasPracticalTodo, practicalIssueKey, practicalReasonKey, practicalRefusalKey,
} from '../practicalEmail';

const theme = DEFAULT_STUDIO_THEME;
const TITLE = 'CLUB SONORE X WOH';

function eventBlock(): EmailBlock {
  return { ...makeBlock('event'), eventId: 'ev', price: true, ctaLabel: 'Prendre ma place' } as EmailBlock;
}

const base: RenderCtx = {
  venueName: 'WOH', emailType: 'informational', subject: 'Infos pratiques', preheader: '',
  recipient: { email: 'camille@example.com' }, unsubscribeUrl: 'https://yunoapp.eu/unsubscribe?token=t',
  socialLinks: {}, baseUrl: 'https://yunoapp.eu', now: new Date('2026-10-20T12:00:00Z'),
  live: {
    ev: {
      title: TITLE, startAt: '2026-10-29T18:00:00Z', dateLabel: 'Jeudi 29 octobre', venueLabel: 'Paris',
      url: 'https://shotgun.live/events/club-sonore', priceFromLabel: 'À partir de 15 €',
    },
  },
};

/** Les deux moteurs, même entrée : la Console montre ce que l'envoi rendra. */
function both(ctx: RenderCtx, blocks: EmailBlock[]): string[] {
  return [
    renderEmailHtml(blocks, theme, ctx),
    renderStudioEmailHtml(blocks as unknown as StudioBlock[], theme, ctx as unknown as Parameters<typeof renderStudioEmailHtml>[2]),
  ];
}

describe('rendu en mode pratique', () => {
  it('la carte de la soirée garde date et lieu, sans prix ni bouton d’achat', () => {
    for (const html of both({ ...base, practicalFor: TITLE }, [eventBlock()])) {
      expect(html).toContain('Jeudi 29 octobre');
      expect(html).not.toContain('15 €');
      expect(html).not.toContain('Prendre ma place');
      expect(html).not.toContain('shotgun.live/events/club-sonore');
    }
  });

  it('hors mode pratique, la même carte vend (témoin)', () => {
    for (const html of both({ ...base, emailType: 'promotional' }, [eventBlock()])) {
      expect(html).toContain('15 €');
      expect(html).toContain('Prendre ma place');
    }
  });

  it('le pied de page dit pourquoi la personne le reçoit, sans lien de désinscription', () => {
    for (const html of both({ ...base, practicalFor: TITLE }, [makeBlock('text')])) {
      expect(html).toContain(`vous avez un billet pour « ${TITLE} »`);
      expect(html).toContain('e-mail pratique sur cette soirée, sans publicité');
      expect(html).not.toContain('Se désabonner');
    }
    for (const html of both({ ...base, practicalFor: TITLE, language: 'es' }, [makeBlock('text')])) {
      expect(html).toContain(`tienes una entrada para «${TITLE}»`);
    }
  });

  it('le titre de la soirée est échappé dans le pied de page', () => {
    for (const html of both({ ...base, practicalFor: '<b>X</b>' }, [makeBlock('text')])) {
      expect(html).not.toContain('<b>X</b>');
      expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    }
  });
});

describe('modèle de départ', () => {
  const t = (lang: 0 | 1 | 2) => (key: string, vars: Record<string, string | number> = {}) => {
    const tri = CRM_DICT[key];
    expect(tri, `clé manquante : ${key}`).toBeDefined();
    return tri[lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
  };
  const night = { id: 'ev', title: TITLE, coverUrl: null, url: 'https://shotgun.live/events/club-sonore' };

  it.each([0, 1, 2] as const)('n’utilise que des blocs permis, carte sans prix (langue %i)', (lang) => {
    const c = buildPracticalEmail({ venueName: 'WOH', t: t(lang), night });
    expect(c.type).toBe('informational');
    for (const b of c.blocks) expect(PRACTICAL_BLOCK_TYPES.has(b.type)).toBe(true);
    const ev = c.blocks.find((b) => b.type === 'event');
    expect(ev && ev.type === 'event' && ev.price).toBe(false);
    expect(ev && ev.type === 'event' && ev.eventId).toBe('ev');
    // Les « à compléter » bloquent l'envoi tant qu'ils restent.
    expect(hasPracticalTodo(c.blocks, c.subject)).toBe(true);
  });

  it('un texte rempli ne bloque plus', () => {
    expect(hasPracticalTodo([{ ...makeBlock('text'), body: 'Portes à 23 h' } as EmailBlock], 'Infos')).toBe(false);
  });
});

describe('codes du serveur → textes', () => {
  it('chaque refus a son texte, dans les trois langues', () => {
    const codes = ['crm_practical_content', 'crm_practical_limit', 'crm_practical_window', 'crm_practical_role',
      'crm_practical_event', 'crm_practical_audience', 'crm_practical_feature', 'crm_practical_locked'];
    for (const c of codes) {
      const key = practicalRefusalKey(`{"error":"${c}"}`);
      expect(key).not.toBeNull();
      expect(CRM_DICT[key!]?.length).toBe(3);
    }
    expect(practicalRefusalKey('crm_sender_identity')).toBeNull();
  });

  it('chaque motif de contenu et chaque raison de soirée a son texte', () => {
    for (const c of ['block_not_allowed', 'other_event', 'price_shown', 'promo_words', 'link_sales',
      'link_other_event', 'link_ticketing', 'link_promo', 'link_variable', 'inconnu']) {
      expect(CRM_DICT[practicalIssueKey(c)]?.length).toBe(3);
    }
    for (const r of ['role', 'window', 'limit', 'not_mirror', null]) {
      expect(CRM_DICT[practicalReasonKey(r)]?.length).toBe(3);
    }
  });
});
