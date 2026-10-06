// Pages d'inscription — le design sur mesure (src/crm/signup/custom.ts) : le
// nettoyage, les balises, le contrôle et les jetons partagés par la Console et
// le Worker MCP.
import { describe, expect, it } from 'vitest';
import {
  buildPageTagData, contrastRatio, customFontFamilies, customTokens, googleFontHref, isAllowedAssetUrl, lintCustomDesign, normalizeCustomDesign,
  normalizeTheme, pageSectionText, renderPageSection, sanitizePageCss, sanitizePageHtml, sectionVisible,
} from '@/crm/signup/custom';

const STORAGE = 'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/email-assets/mcp/abc/image.png';

describe('sanitizePageHtml', () => {
  it('removes what executes, imitates a field or loads from another site, and says so', () => {
    const r = sanitizePageHtml('<div onclick="x()"><script>alert(1)</script><style>.a{}</style><form><input name="e"><button>Go</button></form>'
      + '<a href="javascript:alert(1)">x</a><img src="https://evil.example/t.gif" alt=""><iframe src="https://x"></iframe></div>');
    expect(r.text).not.toMatch(/script|onclick|<style|<input|<form|<button|javascript:|evil\.example|iframe/i);
    expect(r.text).toContain('Go');
    expect(r.removed).toEqual(expect.arrayContaining(['script', 'on* attribute', 'input', 'form', 'button', 'unsafe link', 'image not hosted on Yuno', 'iframe']));
  });

  it('keeps layout, inline SVG, Yuno images and tags, and cleans style attributes', () => {
    const r = sanitizePageHtml(`<section class="h"><svg viewBox="0 0 10 10"><circle r="4"/><use href="#x"/></svg><img src="${STORAGE}" alt="Logo">`
      + '<img src="{{page.poster}}" alt="Affiche"><div style="background:url(https://evil.example/a.png);color:red"></div><a href="{{event.tickets_url}}">Billets</a></section>');
    expect(r.text).toContain('<circle r="4"/>');
    expect(r.text).not.toContain('<use');
    expect(r.text).toContain(STORAGE);
    expect(r.text).toContain('src="{{page.poster}}"');
    expect(r.text).toContain('background:none;color:red');
    expect(r.text).toContain('href="{{event.tickets_url}}"');
  });

  it('decodes encoded javascript: links before judging them', () => {
    expect(sanitizePageHtml('<a href="jav&#x61;script:alert(1)">x</a>').text).toContain('href="#"');
    expect(sanitizePageHtml('<a href="java&#9;script:alert(1)">x</a>').text).toContain('href="#"');
    expect(sanitizePageHtml('<a href="java\u0001script:alert(1)">x</a>').text).toContain('href="#"');
    expect(sanitizePageHtml('<a href="https://shotgun.live/x">x</a>').text).toContain('href="https://shotgun.live/x"');
  });
});

describe('sanitizePageCss', () => {
  it('drops @import, @font-face and foreign url(), keeps Yuno assets and animations', () => {
    const r = sanitizePageCss(`@import url(https://evil.example/x.css); @font-face{font-family:X;src:url(https://f.example/x.woff)}
      .a{background:url("${STORAGE}")} .b{background-image:url(https://evil.example/b.png)} @keyframes up{from{opacity:0}}</style><script>`);
    expect(r.text).not.toMatch(/@import|@font-face|evil\.example/);
    expect(r.text).toContain(STORAGE);
    expect(r.text).toContain('@keyframes up');
    expect(r.text).not.toContain('</');
    expect(r.removed).toEqual(expect.arrayContaining(['@import', '@font-face', 'external url']));
  });

  it('knows which images a page can show', () => {
    expect(isAllowedAssetUrl(STORAGE)).toBe(true);
    expect(isAllowedAssetUrl('https://yunoapp.eu/email-social/instagram-w.png')).toBe(true);
    expect(isAllowedAssetUrl('https://images.shotgun.live/x.jpg')).toBe(false);
    expect(isAllowedAssetUrl('http://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/x.png')).toBe(false);
    // Un autre projet Supabase verrait l'IP des fans ; une route de yunoapp.eu n'est pas une image.
    expect(isAllowedAssetUrl('https://otherproject.supabase.co/storage/v1/object/public/x.png')).toBe(false);
    expect(isAllowedAssetUrl('https://yunoapp.eu/go/abc123')).toBe(false);
    expect(isAllowedAssetUrl('https://crm.yunoapp.eu/j/ma-page')).toBe(false);
    expect(isAllowedAssetUrl('https://crm.yunoapp.eu/yuno-wordmark.png?v=2')).toBe(true);
  });
});

describe('normalizeCustomDesign', () => {
  it('keeps exactly one form block, unique ids, and a bounded theme', () => {
    const d = normalizeCustomDesign({
      v: 1,
      theme: { bg: '#000000', text: '#ffffff', accent: 'red', font_heading: 'Anton', font_body: 'Bad;Font', card_radius: 300, heading_weight: 650 },
      sections: [
        { id: 'hero', type: 'html', html: '<h1>{{page.title}}</h1>' },
        { id: 'hero', type: 'html', html: '<p>Deux</p>' },
        { id: 'f1', type: 'yuno', block: 'form', show_on: 'after_signup' },
        { id: 'f2', type: 'yuno', block: 'form' },
        { id: 'x', type: 'html', html: '<script>x</script>' },
      ],
    })!;
    expect(d.sections.filter((s) => s.type === 'yuno')).toHaveLength(1);
    expect(new Set(d.sections.map((s) => s.id)).size).toBe(d.sections.length);
    expect(d.sections.find((s) => s.type === 'yuno')!.show_on).toBeUndefined();
    expect(d.sections.some((s) => s.type === 'html' && !s.html)).toBe(false);
    expect(d.theme).toMatchObject({ bg: '#000000', accent: '#E3141B', font_heading: 'Anton', font_body: 'Geist', card_radius: 40, heading_weight: 700 });
  });

  it('adds the form at the end when a design forgets it', () => {
    const d = normalizeCustomDesign({ v: 1, theme: {}, sections: [{ id: 'a', type: 'html', html: '<p>x</p>' }] })!;
    expect(d.sections.at(-1)).toMatchObject({ type: 'yuno', block: 'form' });
    expect(normalizeCustomDesign(null)).toBeNull();
  });

  it('shows a section in the right scenes', () => {
    expect(sectionVisible({ id: 'a', type: 'html', html: 'x', show_on: 'after_signup' }, 'noted')).toBe(true);
    expect(sectionVisible({ id: 'a', type: 'html', html: 'x', show_on: 'after_signup' }, 'form')).toBe(false);
    expect(sectionVisible({ id: 'a', type: 'html', html: 'x', show_on: 'before_signup' }, 'noted')).toBe(false);
    expect(sectionVisible({ id: 'a', type: 'html', html: 'x' }, 'closed')).toBe(true);
  });
});

describe('page tags', () => {
  const base = {
    locale: 'fr-FR', lang: 'fr' as const, kind: 'prevente' as const, title: 'Halloween <Rave>', tagline: 'Prévente', button: 'Je veux ma place',
    poster: null, pageUrl: 'https://crm.yunoapp.eu/j/halloween', host: { name: 'Le Bunker', city: 'Paris' },
    event: { title: 'HALLOWEEN', start_at: '2026-10-31T22:00:00Z', tz: 'Europe/Paris', venue: 'Le Bunker', city: 'Paris', poster: STORAGE, ticket_url: 'https://shotgun.live/e/h' },
    count: 1284, saleAt: '2026-10-20T16:00:00Z', saleOpen: false, reward: { on: true, label: 'Shot offert', how: '' }, scene: 'form',
  };

  it('writes the night in its own timezone, the counter and the scene', () => {
    const d = buildPageTagData(base) as Record<string, Record<string, unknown>>;
    expect(d.event.time).toBe('23:00');
    expect(d.event.day).toBe('31');
    expect(String(d.event.date)).toMatch(/^Sam\. 31 oct\. · 23:00$/);
    expect(d.page.count).toBe('1 284');
    expect(d.page.poster).toBe(STORAGE);
    expect(d.host.initials).toBe('LB');
    expect(d.scene.form).toBe(true);
    expect(d.fan.first_name).toBe('');
  });

  it('a community page has empty event tags, a hidden counter is empty', () => {
    const d = buildPageTagData({ ...base, kind: 'communaute', event: null, count: null }) as Record<string, Record<string, unknown>>;
    expect(d.event.title).toBe('');
    expect(d.event.has_date).toBe(false);
    expect(d.page.count).toBe('');
    expect(d.page.show_count).toBe(false);
  });

  it('escapes every value and resolves French aliases', () => {
    const html = renderPageSection('<h1>{{page.title}}</h1><p>{{club}} · {{soirée}}</p>{{#if scene.noted}}<b>Merci {{fan.first_name}}</b>{{/if}}', buildPageTagData(base));
    expect(html).toBe('<h1>Halloween &lt;Rave&gt;</h1><p>Le Bunker · HALLOWEEN</p>');
    const noted = renderPageSection('{{#if scene.noted}}Merci {{fan.first_name}}{{/if}}', buildPageTagData({ ...base, scene: 'noted', firstName: 'Léa' }));
    expect(noted).toBe('Merci Léa');
  });

  it('reads the visible text of a section without logic tags', () => {
    expect(pageSectionText('<h1>{{page.title}}</h1>{{#if reward.on}}<p>Bonus</p>{{/if}}')).toBe('{{page.title}} Bonus');
  });
});

describe('lintCustomDesign', () => {
  const ok = normalizeCustomDesign({ v: 1, theme: { bg: '#0B0B0C', text: '#F5EFE6', accent: '#E3141B' }, sections: [
    { id: 'h', type: 'html', html: '<h1>{{page.title}}</h1>' }, { id: 'f', type: 'yuno', block: 'form' },
  ] })!;

  it('passes a clean design', () => {
    expect(lintCustomDesign(ok, { hasEvent: true }).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('refuses unknown tags and unclosed blocks, warns on contrast, a missing title and empty event tags', () => {
    const d = normalizeCustomDesign({ v: 1, theme: { bg: '#777777', text: '#888888' }, sections: [
      { id: 'a', type: 'html', html: '<p>{{event.price}}</p>{{#if page.open}}x<img src="https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/a.png">' },
      { id: 'b', type: 'html', html: '<p>{{event.date}}</p>' },
    ] })!;
    const issues = lintCustomDesign(d, { hasEvent: false });
    const codes = issues.map((i) => `${i.level}:${i.code}`);
    expect(codes).toEqual(expect.arrayContaining(['error:unknown_tag', 'error:unclosed_block', 'warning:low_contrast_text', 'warning:no_title', 'warning:event_tag_without_event', 'warning:img_alt']));
  });
});

describe('customTokens', () => {
  it('maps a theme to the same tokens as a template (form, button, fonts)', () => {
    const k = customTokens(normalizeTheme({
      bg: '#0B0B0C', text: '#F5EFE6', accent: '#E3141B', accent2: '#FF6B35', font_heading: 'Anton', font_body: 'Inter', heading_weight: 400,
      card_bg: 'glass', button_style: 'gradient', button_case: 'uppercase', input_style: 'underline', bg_css: 'radial-gradient(#000,#111)',
    }));
    expect(k).toMatchObject({ id: 'custom', lay: 'custom', dark: true, a: '#E3141B', b: '#FF6B35' });
    expect(k.F).toMatchObject({ f: "'Anton'", w: 400 });
    expect(k.s).toMatchObject({ grad: true, bUp: 'uppercase', inBw: '0 0 1.5px', wBlur: 'blur(20px)', bodyF: "'Inter'" });
    expect(k.s.rootBg).toBe('radial-gradient(#000,#111),linear-gradient(#0B0B0C,#0B0B0C)');
    // Ombre décalée : l'accent sur une page sombre, la couleur choisie sinon.
    expect(customTokens(normalizeTheme({ bg: '#0B0B0C', accent: '#FF6A00', card_shadow: 'hard' })).s.wSh).toBe('6px 6px 0 #FF6A00');
    expect(customTokens(normalizeTheme({ bg: '#FFFFFF', accent: '#FF6A00', card_shadow: 'hard', shadow_color: '#2B2BFF' })).s.wSh).toBe('6px 6px 0 #2B2BFF');
    const light = customTokens(normalizeTheme({ bg: '#FFFFFF', text: '#111111', card_bg: '#111111' }));
    expect(light.dark).toBe(false);
    expect(light.k).toBe('#F7F2F1');
    expect(light.kDark).toBe(true);
  });

  it('loads the Google fonts of a design', () => {
    const fams = customFontFamilies(normalizeTheme({ font_heading: 'Playfair Display', font_body: 'Inter', heading_weight: 800, extra_fonts: ['Space Mono'] }));
    expect(fams.map((f) => f.family)).toEqual(['Playfair Display', 'Inter', 'Space Mono']);
    expect(googleFontHref('Playfair Display', [800])).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@800&display=swap');
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });
});
