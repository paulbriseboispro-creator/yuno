// Sections sur mesure : les balises Yuno rendent les données live, nettoient
// le HTML et gardent les liens suivis — la même fonction pour le Studio, le MCP
// et l'envoi.
import { describe, expect, it } from 'vitest';
import {
  buildSmartData, canonicalTag, hasSmartSalesLink, lintEmail, lintSmartSection, mapSectionLinks, parseSmart,
  mobileSafeHtml, renderSmartSection, renderSmartTemplate, safeEmailUrl, sanitizeSectionHtml, sectionText, smartNeeds, smartSelectionUrl,
  type SmartEvent,
} from '../smart';

const NOW = new Date('2026-10-06T12:00:00Z');

const yunoEvent: SmartEvent = {
  title: 'PORTALIS',
  startAt: '2026-10-09T21:00:00Z',
  timezone: 'Europe/Madrid',
  dateLabel: 'Vendredi 9 octobre · 23:00',
  venueLabel: 'Yuno Club — Madrid',
  coverUrl: 'https://cdn.example.com/portalis.jpg',
  url: 'https://yunoapp.eu/events/amoris/portalis',
  priceFromLabel: 'À partir de 18 €',
  tickets: [
    { n: 'Early', s: 'épuisé', p: '12 €', out: true },
    { n: 'Prévente', s: '', p: '18 €', out: false },
  ],
  guestList: { freeBefore: '00:30', includesDrink: true, remaining: 42, soldOut: false },
  tablesLeft: 2,
  tablesOpen: true,
  tablePacks: [
    { id: 'p1', n: 'Carré', s: '6 pers.', p: '300 €' },
    { id: 'p2', n: 'Loge', s: '10 pers.', p: '900 €' },
  ],
  tableZones: [{ id: 'z1', n: 'Mezzanine', s: '6 à 10 pers.', p: 'dès 300 €' }],
  lineup: [{ name: 'Telos', photo: 'https://cdn.example.com/telos.jpg' }, { name: 'Norten', photo: null }],
  trackedUrl: 'https://yunoapp.eu/l/AB12CD',
  entryTrackedUrl: 'https://yunoapp.eu/l/GL99ZZ',
};

const shotgunEvent: SmartEvent = {
  title: 'PORTALIS',
  startAt: '2026-10-09T21:00:00Z',
  timezone: 'Europe/Madrid',
  venueLabel: 'Madrid',
  coverUrl: null,
  url: 'https://shotgun.live/events/portalis?utm_source=yuno-m-1a2b3c4d&utm_medium=email',
  priceFromLabel: null,
  tickets: [{ n: 'Regular', s: '', p: '20 €', out: true }],
  guestList: null,
  tablesLeft: null,
  tablesOpen: false,
  lineup: [],
  external: true,
};

const data = (ev: SmartEvent | null, extra: Partial<Parameters<typeof buildSmartData>[0]> = {}) =>
  buildSmartData({ event: ev, language: 'fr', now: NOW, recipient: { firstName: 'Camille' }, brand: { name: 'Amoris', logoUrl: 'https://cdn.example.com/logo.png' }, ...extra });

describe('buildSmartData', () => {
  it('rend la soirée, ses liens suivis et son prix d’appel', () => {
    const d = data(yunoEvent);
    const ev = d.event as Record<string, unknown>;
    expect(ev.title).toBe('PORTALIS');
    expect(ev.date).toBe('Vendredi 9 octobre · 23:00');
    expect(ev.time).toBe('23:00');
    expect(ev.url).toBe('https://yunoapp.eu/l/AB12CD');
    expect(ev.tickets_url).toBe('https://yunoapp.eu/l/AB12CD?to=billets');
    expect(ev.guestlist_url).toBe('https://yunoapp.eu/l/GL99ZZ');
    expect(ev.price_from).toBe('À partir de 18 €');
    expect(ev.price).toBe('18 €');
    expect(ev.on_sale).toBe(true);
    expect(ev.sold_out).toBe(false);
    expect(ev.lineup).toBe('Telos · Norten');
  });

  it('suit la langue de l’e-mail (date, prix, rareté des tables)', () => {
    const es = buildSmartData({ event: yunoEvent, language: 'es', now: NOW });
    expect((es.event as Record<string, unknown>).price_from).toBe('Desde 18 €');
    expect(String((es.event as Record<string, unknown>).date).toLowerCase()).toContain('octubre');
    expect((es.tables as Record<string, unknown>).left_label).toBe('Solo quedan 2 mesas');
    const en = buildSmartData({ event: yunoEvent, language: 'en', now: NOW });
    expect((en.tables as Record<string, unknown>).price_from).toBe('from €300');
    expect((en.guestlist as Record<string, unknown>).summary).toBe('Free before 00:30 · free drink · 42 spots left');
  });

  it('une soirée Shotgun : bouton vers la billetterie, ni tables ni guest list, complet si tout est vendu', () => {
    const d = data(shotgunEvent);
    const ev = d.event as Record<string, unknown>;
    expect(ev.tickets_url).toBe(shotgunEvent.url);
    expect(ev.tables_url).toBe('');
    expect(ev.sold_out).toBe(true);
    expect(ev.price_from).toBe('');
    expect((d.tables as Record<string, unknown>).available).toBe(false);
    expect((d.guestlist as Record<string, unknown>).available).toBe(false);
  });

  it('sans lien suivi, mène à la page de sélection /billets', () => {
    const d = data({ ...yunoEvent, trackedUrl: null, entryTrackedUrl: null });
    expect((d.event as Record<string, unknown>).tickets_url).toBe('https://yunoapp.eu/events/amoris/portalis/billets');
    expect(smartSelectionUrl('https://yunoapp.eu/event/123', false)).toBe('https://yunoapp.eu/event/123');
  });

  it('compte à rebours calculé à l’envoi', () => {
    const c = data(yunoEvent).countdown as Record<string, unknown>;
    expect(c.days).toBe(3);
    expect(c.hours).toBe('09');
    expect(c.minutes).toBe('00');
  });
});

describe('renderSmartTemplate', () => {
  it('valeurs, sections, boucles et else (syntaxe Handlebars)', () => {
    const tpl = '{{#if first_name}}Salut {{first_name}}{{else}}Salut{{/if}} — {{event.title}} '
      + '{{#each tickets}}[{{name}} {{price}}{{#if sold_out}} ÉPUISÉ{{/if}}]{{/each}}';
    expect(renderSmartTemplate(tpl, data(yunoEvent))).toBe('Salut Camille — PORTALIS [Early 12 € ÉPUISÉ][Prévente 18 €]');
    expect(renderSmartTemplate(tpl, data(yunoEvent, { recipient: {} }))).toContain('Salut —');
  });

  it('formes Mustache et alias français', () => {
    expect(renderSmartTemplate('{{#lineup}}{{name}}{{^@last}}, {{/@last}}{{/lineup}}', data(yunoEvent))).toBe('Telos, Norten');
    expect(renderSmartTemplate('{{prénom}} / {{soirée}} / {{nom_club}}', data(yunoEvent))).toBe('Camille / PORTALIS / Amoris');
    expect(canonicalTag('Prénom')).toBe('first_name');
  });

  it('échappe toute valeur — un prénom ne peut pas injecter de HTML', () => {
    const d = data(yunoEvent, { recipient: { firstName: '<img src=x onerror=alert(1)>' } });
    expect(renderSmartTemplate('<p>{{first_name}}</p>', d)).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('une balise inconnue reste visible, un champ absent d’un objet connu se tait', () => {
    const d = data(yunoEvent);
    expect(renderSmartTemplate('{{promo_code}}|{{event.nope}}|', d)).toBe('{{promo_code}}||');
  });

  it('else d’une boucle vide, unless', () => {
    expect(renderSmartTemplate('{{#each lineup}}{{name}}{{else}}Line-up bientôt{{/each}}', data(shotgunEvent))).toBe('Line-up bientôt');
    expect(renderSmartTemplate('{{#unless event.sold_out}}Acheter{{else}}Complet{{/unless}}', data(shotgunEvent))).toBe('Complet');
  });

  it('ne lève jamais sur une section mal fermée', () => {
    expect(() => renderSmartTemplate('{{#if event.title}}<b>{{event.title}}', data(yunoEvent))).not.toThrow();
    expect(parseSmart('{{#if a}}x').issues[0].code).toBe('unclosed_block');
    expect(parseSmart('x{{/each}}').issues[0].code).toBe('unexpected_close');
  });
});

describe('sanitizeSectionHtml', () => {
  it('retire script, style, iframe, formulaire, attributs on* et URL javascript:', () => {
    const dirty = '<style>p{}</style><p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>'
      + '<iframe src="https://evil"></iframe><form action="https://x"><input name=a><button>Go</button></form>'
      + '<img src="data:image/png;base64,AAA"><a href="  java&#115;cript:alert(2)">y</a>';
    const { html, removed } = sanitizeSectionHtml(dirty);
    expect(html).not.toMatch(/script|onclick|<style|<iframe|<form|<input|data:image/i);
    expect(html).toContain('<a href="#">x</a>');
    expect(html).toContain('Go');
    expect(removed).toEqual(expect.arrayContaining(['style', 'script', 'iframe', 'on* attribute', 'unsafe url']));
  });

  it('garde un document complet par son corps, et les commentaires Outlook', () => {
    const doc = '<!DOCTYPE html><html><head><title>x</title><style>.a{}</style></head><body><table><tr><td><!--[if mso]><v:roundrect href="https://x"></v:roundrect><![endif]-->Hi</td></tr></table></body></html>';
    const { html } = sanitizeSectionHtml(doc);
    expect(html).toBe('<table><tr><td><!--[if mso]><v:roundrect href="https://x"></v:roundrect><![endif]-->Hi</td></tr></table>');
  });

  it('URL autorisées', () => {
    expect(safeEmailUrl('https://a.b')).toBe(true);
    expect(safeEmailUrl('mailto:a@b.c')).toBe(true);
    expect(safeEmailUrl('{{event.url}}')).toBe(true);
    expect(safeEmailUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(safeEmailUrl('data:text/html,x')).toBe(false);
  });
});

describe('renderSmartSection', () => {
  it('résout, nettoie, puis suit les liens (bouton VML Outlook compris)', () => {
    const code = '<a href="{{event.tickets_url}}">Go</a><!--[if mso]><v:roundrect href="{{event.tickets_url}}"></v:roundrect><![endif]--><a href="https://instagram.com/amoris">IG</a>';
    const track = (u: string) => (u.startsWith('https://yunoapp.eu') ? `${u}${u.includes('?') ? '&' : '?'}yc=CAMP` : u);
    const html = renderSmartSection(code, data(yunoEvent), track);
    expect(html).toContain('href="https://yunoapp.eu/l/AB12CD?to=billets&amp;yc=CAMP"');
    expect(html.match(/yc=CAMP/g)?.length).toBe(2);
    expect(html).toContain('href="https://instagram.com/amoris"');
  });
});

describe('smartNeeds', () => {
  it('dit quelles données live charger', () => {
    expect(smartNeeds('<p>Hello {{first_name}}</p>')).toEqual({ event: false, lineup: false, tables: false, guestlist: false });
    expect(smartNeeds('{{#each lineup}}{{name}}{{/each}}')).toMatchObject({ event: true, lineup: true });
    expect(smartNeeds('{{#if tables.available}}{{tables.left_label}}{{/if}}')).toMatchObject({ event: true, tables: true });
    expect(smartNeeds('{{soirée}}').event).toBe(true);
  });
  it('lien de vente suivi', () => {
    expect(hasSmartSalesLink('<a href="{{event.tickets_url}}">x</a>')).toBe(true);
    expect(hasSmartSalesLink('<a href="https://shotgun.live/x">x</a>')).toBe(false);
  });
});

describe('lintSmartSection', () => {
  const codes = (code: string, opt = {}) => lintSmartSection(code, { hasEvent: true, ...opt }).map((i) => i.code);

  it('balise inconnue, bloc mal fermé, soirée manquante', () => {
    expect(codes('{{event.headline}}')).toContain('unknown_tag');
    expect(codes('{{#if event.sold_out}}x')).toContain('unbalanced_tag');
    expect(lintSmartSection('{{event.title}}', { hasEvent: false }).map((i) => i.code)).toContain('event_tags_without_event');
  });

  it('accepte les champs d’un élément de liste dans sa boucle seulement', () => {
    expect(codes('{{#each tickets}}{{name}} {{price}}{{#if sold_out}}x{{/if}}{{/each}}')).not.toContain('unknown_tag');
    expect(codes('{{price}}')).toContain('unknown_tag');
  });

  it('e-mail : flex, images sans alt, lien écrit en dur, désinscription maison', () => {
    const c = codes('<div style="display:flex"><img src="https://a/b.png"><a href="https://yunoapp.eu/events/amoris/portalis">x</a> Se désinscrire</div>');
    expect(c).toEqual(expect.arrayContaining(['css_flex_grid', 'img_no_alt', 'img_no_width', 'hardcoded_event_link', 'own_unsubscribe']));
  });

  it('données : affiche absente, tables fermées', () => {
    const d = data(shotgunEvent);
    expect(codes('<img src="{{event.cover}}" alt="" width="600">', { data: d })).toContain('cover_missing');
    expect(codes('{{tables.left_label}}', { data: d })).toContain('tables_unavailable');
    expect(codes('{{#if tables.available}}{{tables.left_label}}{{/if}}', { data: d })).not.toContain('tables_unavailable');
  });
});

describe('lintEmail', () => {
  it('objet, pré-en-tête, lien de vente, poids', () => {
    const c = lintEmail({ subject: 'GROSSE SOIRÉE CE JEUDI!!!', preheader: '', hasTrackedLink: false, renderedChars: 120_000 }).map((i) => i.code);
    expect(c).toEqual(expect.arrayContaining(['subject_caps', 'subject_spammy', 'preheader_missing', 'no_sales_link', 'email_too_large']));
    expect(lintEmail({ subject: 'Portalis : on t’attend jeudi', preheader: 'Telos et Norten', hasTrackedLink: true })).toEqual([]);
  });
  it('texte visible d’une section', () => {
    expect(sectionText('<table><tr><td>Hello&nbsp;<b>you</b><!-- x --></td></tr></table>')).toBe('Hello you');
  });
  it('mapSectionLinks laisse mailto et ancres', () => {
    expect(mapSectionLinks('<a href="mailto:a@b.c">m</a><a href="#top">t</a>', () => 'X')).toBe('<a href="mailto:a@b.c">m</a><a href="#top">t</a>');
  });
});

describe('renderEmailHtml — sections sur mesure', () => {
  // Import paresseux : render.ts importe ce module, on teste l'assemblage complet.
  it('rend une section reliée à la soirée, suit ses liens, garde le pied de page légal', async () => {
    const { renderEmailHtml, bindBlocksToEvent, DEFAULT_STUDIO_THEME } = await import('../index');
    const blocks = bindBlocksToEvent([
      { id: 's1', type: 'html', code: '<h1>{{event.title}}</h1><a href="{{event.tickets_url}}">Je prends ma place</a>', px: 0, py: 0 },
    ], 'ev1');
    const html = renderEmailHtml(blocks, { ...DEFAULT_STUDIO_THEME, radius: 32 }, {
      venueName: 'Amoris', emailType: 'promotional', subject: 'Portalis', recipient: { email: 'a@b.c', firstName: 'Camille' },
      unsubscribeUrl: 'https://yunoapp.eu/unsubscribe?token=t', baseUrl: 'https://yunoapp.eu', campaignId: 'camp-1',
      live: { ev1: yunoEvent as never }, language: 'es', now: NOW,
    });
    expect(html).toContain('<h1>PORTALIS</h1>');
    expect(html).toContain('href="https://yunoapp.eu/l/AB12CD?to=billets&amp;yc=camp-1"');
    expect(html).toContain('lang="es"');
    expect(html).toContain('Darse de baja');
    expect(html).toContain('border-radius:32px');
  });

  it('une section sans soirée liée garde ses balises de personnalisation, échappées', async () => {
    const { renderEmailHtml, DEFAULT_STUDIO_THEME } = await import('../index');
    const html = renderEmailHtml([{ id: 's1', type: 'html', code: '<p>Salut {{prénom}}</p><script>x</script>' }], DEFAULT_STUDIO_THEME, {
      venueName: 'Amoris', emailType: 'promotional', subject: 's', recipient: { email: 'a@b.c', firstName: 'Léa & co' }, baseUrl: 'https://yunoapp.eu',
    });
    expect(html).toContain('<p>Salut Léa &amp; co</p>');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('lang="fr"');
  });
});

describe('mobileSafeHtml — débordement mobile', () => {
  it('ajoute box-sizing à un bloc en 100 % qui porte un padding', () => {
    const out = mobileSafeHtml('<div style="width:100%;padding:28px;background:#eb5">x</div>');
    expect(out).toContain('box-sizing:border-box');
  });
  it('plafonne une largeur fixe de plus de 320 px, jamais une image', () => {
    expect(mobileSafeHtml('<table style="width:520px"><tr><td>x</td></tr></table>')).toContain('max-width:100%');
    expect(mobileSafeHtml('<img src="https://a.b/c.png" style="width:520px">')).not.toContain('max-width');
    expect(mobileSafeHtml('<td style="width:200px">x</td>')).not.toContain('max-width');
  });
  it('laisse intact un style déjà sûr', () => {
    const ok = '<div style="width:100%;padding:8px;box-sizing:border-box">x</div>';
    expect(mobileSafeHtml(ok)).toBe(ok);
  });
  it('renderSmartSection applique le filet, le lint prévient', () => {
    const code = '<div style="width:100%;padding:28px">x</div><table style="width:480px"></table>';
    expect(renderSmartSection(code, {})).toContain('box-sizing:border-box');
    const codes = lintSmartSection(code).map((i) => i.code);
    expect(codes).toContain('fixed_width_mobile');
    expect(codes).toContain('width_100_padding');
  });
});
