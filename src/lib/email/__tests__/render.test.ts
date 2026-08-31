import { describe, expect, it } from 'vitest';
import {
  makeBlock, renderEmailHtml, renderBlock, formatCountdown,
  THEME_PRESETS, DEFAULT_STUDIO_THEME,
  interpolateVariables, usesVariables,
  runChecklist, checklistBlocksSend,
  migrateV1Blocks, migrateV1Theme, migrateV1Audience,
} from '../index';
import type { EmailBlock, RenderCtx } from '../types';

const theme = DEFAULT_STUDIO_THEME;

const ctx: RenderCtx = {
  venueName: 'Le Silo',
  city: 'Marseille',
  emailType: 'promotional',
  subject: 'Samedi au Silo',
  preheader: 'Ta table t’attend',
  recipient: {
    email: 'clara@example.com', firstName: 'Clara', lastName: 'Moreau',
    city: 'Marseille', lastEventTitle: 'NUIT ROUGE', loyaltyPoints: 240,
  },
  unsubscribeUrl: 'https://yunoapp.eu/unsubscribe?token=t',
  socialLinks: { instagram: 'https://instagram.com/lesilo' },
  baseUrl: 'https://yunoapp.eu',
  campaignId: 'camp-1',
  now: new Date('2026-08-31T12:00:00Z'),
  live: {
    'ev-1': {
      title: 'NUIT ROUGE II', startAt: '2026-09-03T21:00:00Z',
      dateLabel: 'Jeudi 3 sept · 23:00', venueLabel: 'Le Silo — Marseille',
      coverUrl: 'https://cdn.example.com/cover.jpg',
      url: 'https://yunoapp.eu/event/ev-1', priceFromLabel: 'Dès 12 €',
      tickets: [
        { n: 'Early bird', s: '', p: '12 €', out: true },
        { n: 'Standard', s: 'Toute la nuit', p: '18 €', out: false },
      ],
      tablesLeft: 3,
    },
  },
};

function renderOne(b: EmailBlock): string {
  return renderBlock(b, theme, ctx);
}

describe('renderEmailHtml — enveloppe', () => {
  const html = renderEmailHtml([makeBlock('text')], theme, ctx);

  it('émet un document email 600px en tables présentation', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('width="600"');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
  });

  it('inclut les fallbacks MSO et le meta color-scheme', () => {
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('color-scheme');
    const withSpacer = renderEmailHtml([makeBlock('spacer')], theme, ctx);
    expect(withSpacer).toContain('mso-line-height-rule');
  });

  it('cache le preheader avec padding d’entités', () => {
    expect(html).toContain('Ta table t’attend');
    expect(html).toContain('&#8199;&#847;');
  });

  it('footer légal : désinscription un clic pour le promotionnel', () => {
    expect(html).toContain('Se désabonner en un clic');
    expect(html).toContain('clara@example.com');
  });

  it('footer informationnel : pas de lien de désinscription', () => {
    const info = renderEmailHtml([makeBlock('text')], theme, { ...ctx, emailType: 'informational' });
    expect(info).not.toContain('Se désabonner');
    expect(info).toContain('acheté un billet');
  });
});

describe('blocs — un rendu par type', () => {
  it('header : logo tailles + nom', () => {
    const b = makeBlock('header', { venueName: 'LE SILO', logoUrl: 'https://cdn.x/l.png' });
    const html = renderOne(b);
    expect(html).toContain('LE SILO');
    expect(html).toContain('width="54"'); // md = 54px
  });

  it('image sans url : placeholder avec label', () => {
    const b = makeBlock('image');
    if (b.type === 'image') b.label = 'Affiche';
    expect(renderOne(b)).toContain('Affiche');
  });

  it('image avec url : alt obligatoire présent', () => {
    const b = makeBlock('image');
    if (b.type === 'image') { b.url = 'https://cdn.x/a.jpg'; b.label = 'Affiche de la soirée'; }
    expect(renderOne(b)).toContain('alt="Affiche de la soirée"');
  });

  it('text : interpole les variables avec repli', () => {
    const b = makeBlock('text');
    if (b.type === 'text') b.body = '<p>Salut {{prénom}}, tu as {{points_fidélité}} points.</p>';
    const html = renderOne(b);
    expect(html).toContain('Salut Clara');
    expect(html).toContain('240 points');
  });

  it('cta : bouton VML pour Outlook + lien tracké', () => {
    const b = makeBlock('cta');
    if (b.type === 'cta') b.url = 'https://yunoapp.eu/event/ev-1';
    const html = renderOne(b);
    expect(html).toContain('v:roundrect');
    expect(html).toContain('yc=camp-1');
  });

  it('columns : deux colonnes 50% empilables', () => {
    const html = renderOne(makeBlock('columns'));
    expect(html).toContain('yn-col');
    expect((html.match(/width="50%"/g) || []).length).toBe(2);
  });

  it('event : les données live priment sur les props figées', () => {
    const b = makeBlock('event', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('NUIT ROUGE II');
    expect(html).toContain('Jeudi 3 sept');
  });

  it('tickets : lignes live, épuisé barré', () => {
    const b = makeBlock('tickets', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('Early bird');
    expect(html).toContain('Épuisé');
    expect(html).toContain('line-through');
    expect(html).toContain('18 €');
  });

  it('table : condition + tables restantes live', () => {
    const b = makeBlock('table', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('VIP · Table');
    expect(html).toContain('3 tables encore libres');
  });

  it('countdown : calculé au rendu, jamais figé', () => {
    const b = makeBlock('countdown', { eventId: 'ev-1' });
    expect(renderOne(b)).toContain('J-3');
  });

  it('countdown sans événement : le bloc s’efface', () => {
    expect(renderOne(makeBlock('countdown'))).toBe('');
  });

  it('social : icônes depuis les liens campagne', () => {
    expect(renderOne(makeBlock('social'))).toContain('instagram');
  });

  it('divider et spacer', () => {
    expect(renderOne(makeBlock('divider'))).toContain('border-top');
    const sp = makeBlock('spacer');
    if (sp.type === 'spacer') sp.size = 'xl';
    expect(renderOne(sp)).toContain('height:56px');
  });

  it('html : code brut, variables interpolées', () => {
    const b = makeBlock('html');
    if (b.type === 'html') b.code = '<b>{{nom_club}}</b>';
    expect(renderOne(b)).toContain('<b>Le Silo</b>');
  });
});

describe('formatCountdown', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  it('jours, heures, minutes, passé', () => {
    expect(formatCountdown('2026-09-05T12:00:00Z', now)).toBe('J-5');
    expect(formatCountdown('2026-09-01T02:30:00Z', now)).toContain('Dans 14 h');
    expect(formatCountdown('2026-08-31T12:20:00Z', now)).toBe('Dans 20 min');
    expect(formatCountdown('2026-08-31T11:00:00Z', now)).toBe('C’est maintenant');
  });
});

describe('variables', () => {
  it('accepte les alias sans accent et les héritées v1', () => {
    expect(interpolateVariables('{{prenom}} / {{points_fidelite}}', ctx)).toBe('Clara / 240');
  });
  it('variable vide → repli, variable inconnue → laissée visible', () => {
    const anon: RenderCtx = { ...ctx, recipient: { email: 'x@y.z' } };
    expect(interpolateVariables('{{dernier_event}}', anon)).toBe('ta dernière soirée');
    expect(interpolateVariables('{{inconnu}}', anon)).toBe('{{inconnu}}');
  });
  it('usesVariables détecte les clés connues', () => {
    expect(usesVariables(['salut {{ville}}'])).toBe(true);
    expect(usesVariables(['salut {{nawak}}'])).toBe(false);
  });
});

describe('checklist pré-envoi', () => {
  const blocks = [makeBlock('header'), makeBlock('cta')];
  it('tout au vert sur une campagne saine', () => {
    const items = runChecklist({ subject: 'Court', preheader: 'ok', type: 'promotional', blocks });
    expect(items).toHaveLength(7);
    expect(items.filter((i) => i.status === 'warn')).toHaveLength(0);
    expect(checklistBlocksSend(items)).toBe(false);
  });
  it('objet trop long + image sans alt → warn non bloquant', () => {
    const img = makeBlock('image');
    if (img.type === 'image') img.url = 'https://x/y.jpg';
    const items = runChecklist({
      subject: 'x'.repeat(80), preheader: '', type: 'promotional', blocks: [img],
    });
    const warned = items.filter((i) => i.status === 'warn').map((i) => i.id);
    expect(warned).toContain('subject_length');
    expect(warned).toContain('img_alt');
    expect(warned).toContain('cta');
    expect(checklistBlocksSend(items)).toBe(false);
  });
  it('domaine non authentifié → bloque l’envoi', () => {
    const items = runChecklist({
      subject: 's', preheader: 'p', type: 'promotional', blocks, domainAuthenticated: false,
    });
    expect(checklistBlocksSend(items)).toBe(true);
  });
});

describe('migration v1 → v2', () => {
  it('convertit chaque type v1 et jette l’inconnu', () => {
    const v1 = [
      { id: '1', type: 'header', venue_name: 'Club X', logo_shape: 'circle', logo_size: 'lg' },
      { id: '2', type: 'text', html: '<p>Bonjour {{prenom}}</p>' },
      { id: '3', type: 'image', url: 'https://x/i.jpg', alt: 'aff' },
      { id: '4', type: 'cta', label: 'Go', url: 'https://x' },
      { id: '5', type: 'event', event_id: 'ev-9', title: 'Soirée' },
      { id: '6', type: 'divider' },
      { id: '7', type: 'spacer', size: 'xl' },
      { id: '8', type: 'martien' },
    ];
    const out = migrateV1Blocks(v1, 'Le Silo');
    expect(out.map((b) => b.type)).toEqual(['header', 'text', 'image', 'cta', 'event', 'divider', 'spacer']);
    const header = out[0];
    if (header.type === 'header') {
      expect(header.venueName).toBe('Club X');
      expect(header.logoShape).toBe('circle');
    }
    const ev = out[4];
    if (ev.type === 'event') expect(ev.eventId).toBe('ev-9');
  });

  it('rapproche le thème v1 du preset le plus proche', () => {
    const gold = migrateV1Theme({ bg: '#0a0a0a', accent: '#d4af37', header_bg: '#0f0f0f' });
    expect(gold.name).toBe('gold_night');
    expect(gold.dark).toBe(true);
    const custom = migrateV1Theme({ bg: '#123456', accent: '#654321', body_text: '#222222' });
    expect(custom.text).toBe('#222222');
    expect(custom.accent).toBe('#654321');
  });

  it('audience v1 → sélection v2', () => {
    expect(migrateV1Audience('all_subscribers', null)).toEqual([{ kind: 'all_subscribers' }]);
    expect(migrateV1Audience('custom_segment', 'seg-1')).toEqual([{ kind: 'segment', segmentId: 'seg-1' }]);
    expect(migrateV1Audience('custom_segment', null)).toEqual([]);
    expect(migrateV1Audience(null, null)).toEqual([]);
  });

  it('presets : 4 thèmes complets', () => {
    expect(THEME_PRESETS).toHaveLength(4);
    for (const p of THEME_PRESETS) {
      expect(p.bg && p.card && p.accent && p.footerBg).toBeTruthy();
    }
  });
});
