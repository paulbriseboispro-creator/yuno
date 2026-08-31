import { describe, expect, it } from 'vitest';
import {
  makeBlock, renderEmailHtml, renderBlock, countdownParts, looksLikeHtml,
  THEME_PRESETS, THEME_SWATCHES, DEFAULT_STUDIO_THEME,
  interpolateVariables, usesVariables, inlineMarkup, escapeHtml,
  contrastText, ctaColors,
  runChecklist, checklistBlocksSend,
  migrateV1Blocks, migrateV1Theme, migrateV1Audience, htmlToPlain, normalizeV2Blocks,
} from '../index';
import type { EmailBlock, RenderCtx } from '../types';

const theme = DEFAULT_STUDIO_THEME;

const ctx: RenderCtx = {
  venueName: 'Le Silo',
  city: 'Bordeaux',
  emailType: 'promotional',
  subject: 'Amélie Lens débarque au Silo',
  preheader: 'Vendredi 12 septembre · ouverture 23h30',
  recipient: {
    email: 'camille@example.com', firstName: 'Camille', lastName: 'Moreau',
    city: 'Bordeaux', lastEventTitle: 'NUIT ROUGE', loyaltyPoints: 240,
    conds: ['vip_table'],
  },
  unsubscribeUrl: 'https://yunoapp.eu/unsubscribe?token=t',
  socialLinks: { instagram: 'https://instagram.com/lesilo' },
  baseUrl: 'https://yunoapp.eu',
  campaignId: 'camp-1',
  now: new Date('2026-08-31T12:00:00Z'),
  live: {
    'ev-1': {
      title: 'Nuit Blanche — Amélie Lens', startAt: '2026-09-03T21:30:00Z',
      dateLabel: 'Jeudi 3 sept · 23:30', venueLabel: 'Le Silo — Bordeaux',
      coverUrl: 'https://cdn.example.com/cover.jpg',
      url: 'https://yunoapp.eu/event/ev-1', priceFromLabel: 'À partir de 18 €',
      tickets: [
        { n: 'Early bird', s: 'épuisé', p: '12 €', out: true },
        { n: 'Prévente 1', s: 'il reste 84 places', p: '18 €', out: false },
      ],
      tablesLeft: 3,
    },
  },
};

function renderOne(b: EmailBlock, overrides: Partial<RenderCtx> = {}): string {
  return renderBlock(b, theme, { ...ctx, ...overrides });
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
    expect(html).toContain('Vendredi 12 septembre');
    expect(html).toContain('&#8199;&#847;');
  });

  it('footer légal : désinscription en couleur accent pour le promotionnel', () => {
    expect(html).toContain('Se désabonner');
    expect(html).toContain(`color:${theme.accent};text-decoration:underline`);
    expect(html).toContain('camille@example.com');
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
    expect(html).toContain('border-radius:14px'); // rounded (prototype)
  });

  it('image sans url : rien dans l’email (placeholder = éditeur seulement)', () => {
    expect(renderOne(makeBlock('image'))).toBe('');
  });

  it('image avec url : alt obligatoire présent, pleine largeur', () => {
    const b = makeBlock('image');
    if (b.type === 'image') { b.url = 'https://cdn.x/a.jpg'; b.label = 'Affiche de la soirée'; }
    const html = renderOne(b);
    expect(html).toContain('alt="Affiche de la soirée"');
    expect(html).toContain('width="600"');
  });

  it('text : texte brut, \\n = paragraphe, variables interpolées avec repli', () => {
    const b = makeBlock('text');
    if (b.type === 'text') b.body = 'Salut {{prénom}},\nTu as {{points_fidélité}} points.';
    const html = renderOne(b);
    expect(html).toContain('Salut Camille,');
    expect(html).toContain('Tu as 240 points.');
    expect((html.match(/<p /g) || []).length).toBe(2);
  });

  it('text : un corps HTML migré du v1 passe tel quel', () => {
    const b = makeBlock('text');
    if (b.type === 'text') b.body = '<p>Bonjour <strong>{{prénom}}</strong></p>';
    const html = renderOne(b);
    expect(html).toContain('<strong>Camille</strong>');
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
    expect(html).toContain('Warm-up');
  });

  it('event : les données live priment sur les props figées', () => {
    const b = makeBlock('event', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('Nuit Blanche — Amélie Lens');
    expect(html).toContain('Jeudi 3 sept');
  });

  it('tickets : lignes live, épuisé = prix barré et nom éteint', () => {
    const b = makeBlock('tickets', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('Early bird');
    expect(html).toContain('text-decoration:line-through');
    expect(html).toContain(`color:${theme.accent}`); // prix actif en accent
    expect(html).toContain('18 €');
  });

  it('table : kicker + tables restantes live (destinataire VIP)', () => {
    const b = makeBlock('table', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('Bottle service');
    expect(html).toContain('3 tables encore libres');
  });

  it('table : bloc conditionnel effacé pour un destinataire hors règle', () => {
    const b = makeBlock('table', { eventId: 'ev-1' });
    const hidden = renderOne(b, { recipient: { ...ctx.recipient, conds: [] } });
    expect(hidden).toBe('');
    const editor = renderOne(b, { recipient: { ...ctx.recipient, conds: [] }, ignoreConds: true });
    expect(editor).toContain('Bottle service');
  });

  it('countdown : 3 cellules JOURS/HEURES/MIN calculées au rendu', () => {
    const b = makeBlock('countdown', { eventId: 'ev-1' });
    const html = renderOne(b);
    expect(html).toContain('JOURS');
    expect(html).toContain('HEURES');
    expect(html).toContain('MIN');
    expect(html).toContain('>03<'); // 3 jours et des poussières
  });

  it('countdown sans événement : le bloc s’efface', () => {
    expect(renderOne(makeBlock('countdown'))).toBe('');
  });

  it('social : pastilles avec les vrais logos, PNG servis par NOTRE domaine', () => {
    const html = renderOne(makeBlock('social'));
    expect(html).toContain('href="https://instagram.com/lesilo"');
    expect(html).toContain('https://yunoapp.eu/email-social/instagram-');
    expect(html).toContain('alt="Instagram"');
    expect(html).toContain('border-radius:50%');
    expect(html).not.toContain('simpleicons'); // plus jamais de CDN tiers
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

  it('marges et fond par bloc (px/py/bg du prototype)', () => {
    const b = makeBlock('text');
    if (b.type === 'text') { b.px = 40; b.py = 32; b.bg = 'tile'; }
    const html = renderOne(b);
    expect(html).toContain('padding:32px 40px');
    expect(html).toContain(`background:${theme.tile}`);
  });

  it('marge zéro : les blocs se collent réellement (py=0 respecté partout)', () => {
    const txt = makeBlock('text');
    if (txt.type === 'text') { txt.px = 0; txt.py = 0; }
    expect(renderOne(txt)).toContain('padding:0px 0px');
    const cta = makeBlock('cta');
    if (cta.type === 'cta') { cta.px = 0; cta.py = 0; }
    expect(renderOne(cta)).toContain('padding:0px 0px'); // plus de +6 caché
    const head = makeBlock('header');
    head.px = 0; head.py = 0;
    expect(renderOne(head)).toContain('padding:0px 0px');
    const div = makeBlock('divider');
    div.py = 0;
    expect(renderOne(div)).toContain('padding:0px 24px');
  });

  it('défauts de marge PAR TYPE : header 30/24, cta 24/24, divider 10/24', () => {
    expect(renderOne(makeBlock('header'))).toContain('padding:30px 24px');
    expect(renderOne(makeBlock('cta'))).toContain('padding:24px 24px');
    expect(renderOne(makeBlock('divider'))).toContain('padding:10px 24px');
  });

  it('tickets : événement live SANS billetterie → bloc effacé, jamais les placeholders', () => {
    const b = makeBlock('tickets', { eventId: 'ev-1' });
    const html = renderOne(b, {
      live: { 'ev-1': { ...ctx.live!['ev-1'], tickets: [] } },
    });
    expect(html).toBe('');
  });

  it('tickets : sans données live du tout, les lignes figées restent le repli', () => {
    const b = makeBlock('tickets', { eventId: 'ev-inconnu' });
    expect(renderOne(b, { live: {} })).toContain('Early bird');
  });
});

describe('personnalisation — couleur CTA, countdown manuel, image arrondie', () => {
  it('cta : couleur custom + texte auto-contrasté', () => {
    const light = makeBlock('cta');
    if (light.type === 'cta') light.color = '#f5e642'; // jaune clair → texte foncé
    const htmlLight = renderOne(light);
    expect(htmlLight).toContain('background:#f5e642');
    expect(htmlLight).toContain('color:#111111');
    const dark = makeBlock('cta');
    if (dark.type === 'cta') dark.color = '#1a1a2e'; // sombre → texte blanc
    const htmlDark = renderOne(dark);
    expect(htmlDark).toContain('background:#1a1a2e');
    expect(htmlDark).toContain('color:#ffffff');
  });

  it('cta : sans couleur custom, le thème garde la main', () => {
    const html = renderOne(makeBlock('cta'));
    expect(html).toContain(`background:${theme.accent}`);
    expect(html).toContain(`color:${theme.btnText}`);
  });

  it('ctaColors : couleur invalide ou égale à l\'accent → thème', () => {
    expect(ctaColors('nawak', theme)).toEqual({ bg: theme.accent, color: theme.btnText });
    expect(ctaColors(theme.accent.toUpperCase(), theme)).toEqual({ bg: theme.accent, color: theme.btnText });
    expect(contrastText('#ffffff')).toBe('#111111');
    expect(contrastText('#000000')).toBe('#ffffff');
  });

  it('countdown : date cible manuelle quand aucun événement n\'est relié', () => {
    const b = makeBlock('countdown');
    if (b.type === 'countdown') b.targetAt = '2026-09-02T23:48:00Z'; // ctx.now = 31/08 12:00 UTC
    const html = renderOne(b);
    expect(html).toContain('JOURS');
    expect(html).toContain('>02<');
    expect(html).toContain('>11<');
  });

  it('countdown : l\'événement live prime sur la date manuelle', () => {
    const b = makeBlock('countdown', { eventId: 'ev-1' });
    if (b.type === 'countdown') b.targetAt = '2030-01-01T00:00:00Z';
    const html = renderOne(b); // startAt live = 03/09 → 3 jours, pas des années
    expect(html).toContain('>03<');
  });

  it('couleurs par élément : texte, icônes sociales, trait du séparateur', () => {
    const txt = makeBlock('text');
    if (txt.type === 'text') { txt.body = 'coucou'; txt.color = '#ff8800'; }
    expect(renderOne(txt)).toContain('color:#ff8800');

    const soc = makeBlock('social');
    if (soc.type === 'social') soc.color = '#020448';
    const socHtml = renderOne(soc);
    expect(socHtml).toContain('background:#020448'); // pastille bleue foncée…
    expect(socHtml).toContain('instagram-w.png'); // …glyphe blanc auto-contrasté

    const div = makeBlock('divider');
    if (div.type === 'divider') div.color = '#333333';
    expect(renderOne(div)).toContain('border-top:1px solid #333333');
  });

  it('social : le libellé du site web est son domaine, pastille claire → glyphe foncé', () => {
    const soc = makeBlock('social');
    if (soc.type === 'social') soc.color = '#f5f5f5';
    const html = renderOne(soc, { socialLinks: { website: 'https://www.lesilo.fr/agenda' } });
    expect(html).toContain('alt="lesilo.fr"');
    expect(html).toContain('website-d.png');
  });

  it('footer : le trait clair disparaît sur un footer sombre', () => {
    const dark = renderEmailHtml([makeBlock('text')], { ...theme, footerBg: '#000000' }, ctx);
    expect(dark).not.toContain(`border-top:1px solid ${theme.divider};font-family`);
    const light = renderEmailHtml([makeBlock('text')], theme, ctx);
    expect(light).toContain(`border-top:1px solid ${theme.divider};font-family`);
  });

  it('fond personnalisé par bloc (bgc) : prime sur bg, appliqué au social/spacer/divider', () => {
    const txt = makeBlock('text');
    if (txt.type === 'text') { txt.bgc = '#0a0a0a'; txt.bg = 'tile'; }
    expect(renderOne(txt)).toContain('background:#0a0a0a');

    const soc = makeBlock('social');
    soc.bgc = '#111111';
    expect(renderOne(soc)).toContain('background:#111111');

    const sp = makeBlock('spacer');
    sp.bgc = '#222222';
    expect(renderOne(sp)).toContain('background:#222222');

    const div = makeBlock('divider');
    div.bgc = '#331111';
    expect(renderOne(div)).toContain('background:#331111');
  });

  it('accent par bloc Yuno : billets, countdown, table', () => {
    const tk = makeBlock('tickets', { eventId: 'ev-1' });
    if (tk.type === 'tickets') tk.accent = '#3b82f6';
    const tkHtml = renderOne(tk);
    expect(tkHtml).toContain('color:#3b82f6'); // prix actifs
    expect(tkHtml).toContain('background:#3b82f6'); // bouton

    const cd = makeBlock('countdown', { eventId: 'ev-1' });
    if (cd.type === 'countdown') cd.accent = '#d4af37';
    expect(renderOne(cd)).toContain('color:#d4af37');

    const tb = makeBlock('table', { eventId: 'ev-1' });
    if (tb.type === 'table') tb.accent = '#16a34a';
    const tbHtml = renderOne(tb);
    expect(tbHtml).toContain('color:#16a34a'); // kicker + compteur
    expect(tbHtml).toContain('background:#16a34a'); // bouton
  });

  it('image : coins arrondis optionnels, bornés', () => {
    const b = makeBlock('image');
    if (b.type === 'image') { b.url = 'https://cdn.x/a.jpg'; b.label = 'aff'; b.radius = 12; }
    expect(renderOne(b)).toContain('border-radius:12px');
    if (b.type === 'image') b.radius = 99;
    expect(renderOne(b)).toContain('border-radius:40px');
    if (b.type === 'image') b.radius = undefined;
    expect(renderOne(b)).not.toContain('border-radius');
  });
});

describe('inlineMarkup — mise en forme inline du texte', () => {
  const opts = { accent: '#dc2626' };

  it('gras, italique, barré, souligné', () => {
    expect(inlineMarkup('**gras**', opts)).toBe('<strong>gras</strong>');
    expect(inlineMarkup('*ita*', opts)).toBe('<em>ita</em>');
    expect(inlineMarkup('~~barré~~', opts)).toContain('line-through');
    expect(inlineMarkup('__sous__', opts)).toContain('text-decoration:underline');
  });

  it('couleur hex + couleur accent + taille bornée', () => {
    expect(inlineMarkup('[c=#ff0000]rouge[/c]', opts)).toContain('color:#ff0000');
    expect(inlineMarkup('[c=accent]thème[/c]', opts)).toContain('color:#dc2626');
    expect(inlineMarkup('[s=22]grand[/s]', opts)).toContain('font-size:22px');
    expect(inlineMarkup('[s=99]borné[/s]', opts)).toContain('font-size:40px');
  });

  it('lien : URL traquée + couleur accent', () => {
    const out = inlineMarkup('[url=https://yunoapp.eu/event/x]billets[/url]', {
      accent: '#dc2626', track: (u) => `${u}?yc=camp-1`,
    });
    expect(out).toContain('href="https://yunoapp.eu/event/x?yc=camp-1"');
    expect(out).toContain('>billets</a>');
  });

  it('imbrication : couleur DANS du gras', () => {
    const out = inlineMarkup('**[c=#ff0000]rouge gras[/c]**', opts);
    expect(out).toContain('<strong><span style="color:#ff0000;">rouge gras</span></strong>');
  });

  it('le HTML utilisateur reste échappé (markup appliqué après escapeHtml)', () => {
    const out = inlineMarkup(escapeHtml('**gras** <script>alert(1)</script>'), opts);
    expect(out).toContain('<strong>gras</strong>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('bout en bout : bloc texte avec markup + variables', () => {
    const b = makeBlock('text');
    if (b.type === 'text') b.body = 'Salut **{{prénom}}**, [c=accent]soirée[/c] à ~~25 €~~ [s=20]18 €[/s] !';
    const html = renderBlock(b, theme, ctx);
    expect(html).toContain('<strong>Camille</strong>');
    expect(html).toContain(`color:${theme.accent};">soirée</span>`);
    expect(html).toContain('line-through;">25 €</span>');
    expect(html).toContain('font-size:20px');
  });
});

describe('header — marque héritée du compte', () => {
  it("affiche le logo du compte quand le bloc n'en a pas", () => {
    const html = renderOne(makeBlock('header', { venueName: 'Le Silo' }), {
      logoUrl: 'https://cdn.example.com/logo-club.png',
    });
    expect(html).toContain('https://cdn.example.com/logo-club.png');
  });

  it('laisse le logo choisi à la main gagner sur celui du compte', () => {
    const html = renderOne(
      makeBlock('header', { venueName: 'Le Silo', logoUrl: 'https://cdn.example.com/custom.png' }),
      { logoUrl: 'https://cdn.example.com/logo-club.png' },
    );
    expect(html).toContain('https://cdn.example.com/custom.png');
    expect(html).not.toContain('logo-club.png');
  });

  it("n'affiche aucune image quand ni le bloc ni le compte n'ont de logo", () => {
    const html = renderOne(makeBlock('header', { venueName: 'Le Silo' }), { logoUrl: null });
    expect(html).not.toContain('<img');
  });

  it('hérite aussi du nom du compte quand le bloc ne le porte pas', () => {
    const b = { ...makeBlock('header', {}), venueName: '' } as EmailBlock;
    expect(renderOne(b)).toContain('Le Silo');
  });
});

describe('countdownParts / looksLikeHtml', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  it('décompose jours/heures/minutes, borné à zéro', () => {
    expect(countdownParts('2026-09-02T23:48:00Z', now)).toEqual({ days: 2, hours: 11, mins: 48 });
    expect(countdownParts('2026-08-31T11:00:00Z', now)).toEqual({ days: 0, hours: 0, mins: 0 });
    expect(countdownParts('invalide', now)).toBeNull();
  });
  it('détecte le HTML hérité', () => {
    expect(looksLikeHtml('<p>coucou</p>')).toBe(true);
    expect(looksLikeHtml('2 > 1 et un saut\nde ligne')).toBe(false);
  });
});

describe('variables', () => {
  it('accepte les alias sans accent et les héritées v1', () => {
    expect(interpolateVariables('{{prenom}} / {{points_fidelite}}', ctx)).toBe('Camille / 240');
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
  const blocks = [makeBlock('header'), makeBlock('cta'), makeBlock('text')];
  it('tout au vert sur une campagne saine (8 items)', () => {
    const items = runChecklist({
      subject: 'Court', preheader: 'ok', type: 'promotional', blocks, renderedBytes: 24_000,
    });
    expect(items).toHaveLength(8);
    expect(items.filter((i) => i.status === 'warn')).toHaveLength(0);
    expect(checklistBlocksSend(items)).toBe(false);
  });
  it('objet trop long, image sans alt, poids Gmail → warn non bloquant', () => {
    const img = makeBlock('image');
    if (img.type === 'image') { img.url = 'https://x/y.jpg'; img.label = ''; }
    const items = runChecklist({
      subject: 'x'.repeat(80), preheader: '', type: 'promotional', blocks: [img], renderedBytes: 150_000,
    });
    const warned = items.filter((i) => i.status === 'warn').map((i) => i.id);
    expect(warned).toEqual(expect.arrayContaining(['subject_length', 'img_alt', 'cta', 'weight', 'variables']));
    expect(checklistBlocksSend(items)).toBe(false);
  });
  it('domaine non authentifié → bloque l’envoi', () => {
    const items = runChecklist({
      subject: 's', preheader: 'p', type: 'promotional', blocks, domainAuthenticated: false,
    });
    expect(checklistBlocksSend(items)).toBe(true);
  });
});

describe('migration v1 → v2 + normalisation', () => {
  it('convertit chaque type v1, texte HTML → texte brut', () => {
    const v1 = [
      { id: '1', type: 'header', venue_name: 'Club X', logo_shape: 'circle', logo_size: 'lg' },
      { id: '2', type: 'text', html: '<p>Bonjour {{prenom}}</p><p>À vendredi&nbsp;!</p>' },
      { id: '3', type: 'image', url: 'https://x/i.jpg', alt: 'aff' },
      { id: '4', type: 'cta', label: 'Go', url: 'https://x' },
      { id: '5', type: 'event', event_id: 'ev-9', title: 'Soirée' },
      { id: '6', type: 'divider' },
      { id: '7', type: 'spacer', size: 'xl' },
      { id: '8', type: 'martien' },
    ];
    const out = migrateV1Blocks(v1, 'Le Silo');
    expect(out.map((b) => b.type)).toEqual(['header', 'text', 'image', 'cta', 'event', 'divider', 'spacer']);
    const text = out[1];
    if (text.type === 'text') expect(text.body).toBe('Bonjour {{prenom}}\nÀ vendredi !');
  });

  it('htmlToPlain : br, paragraphes, entités', () => {
    expect(htmlToPlain('l1<br>l2</p><p>l3 &amp; l4')).toBe('l1\nl2\nl3 & l4');
  });

  it('normalizeV2Blocks : kicker par défaut + cond héritée en clé', () => {
    const raw = [
      { id: 'a', type: 'table', title: 't', sub: 's', ctaLabel: 'c', cond: 'VIP · Table' },
      { id: 'b', type: 'text', body: 'x', size: 16, align: 'left', cond: 'nawak' },
    ];
    const out = normalizeV2Blocks(raw);
    const table = out[0];
    if (table.type === 'table') {
      expect(table.kicker).toBe('Bottle service');
      expect(table.cond).toBe('vip_table');
    }
    expect(out[1].cond).toBeNull();
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

  it('presets : 4 thèmes complets + pastilles', () => {
    expect(THEME_PRESETS).toHaveLength(4);
    for (const p of THEME_PRESETS) {
      expect(p.bg && p.card && p.accent && p.footerBg).toBeTruthy();
      expect(THEME_SWATCHES[p.name]).toHaveLength(3);
    }
  });
});
