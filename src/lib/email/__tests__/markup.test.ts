import { describe, it, expect } from 'vitest';
import {
  parseMarkup, serializeMarkup, patchRange, rangeHas, clearRange,
  replaceRange, replaceRangeWithDoc, attrAt, normalizeAttr,
} from '../markup';
import { inlineMarkup, escapeHtml } from '../render';

const ACCENT = '#dc2626';
const html = (src: string) => inlineMarkup(escapeHtml(src), { accent: ACCENT });

/** Le texte tel que le lecteur de l'email le voit, balises retirées. */
const visible = (src: string) => html(src).replace(/<[^>]+>/g, '');

describe('parseMarkup — les signes disparaissent, leur sens reste', () => {
  it('lit les signes markdown', () => {
    expect(parseMarkup('**gras**').text).toBe('gras');
    expect(parseMarkup('**gras**').attrs[0]).toEqual({ b: true });
    expect(parseMarkup('*ita*').attrs[0]).toEqual({ i: true });
    expect(parseMarkup('~~barré~~').attrs[0]).toEqual({ s: true });
    expect(parseMarkup('__sous__').attrs[0]).toEqual({ u: true });
  });

  it('lit la forme à crochets', () => {
    expect(parseMarkup('[b]gras[/b]').text).toBe('gras');
    expect(parseMarkup('[b]gras[/b]').attrs[0]).toEqual({ b: true });
    expect(parseMarkup('[k]barré[/k]').attrs[0]).toEqual({ s: true });
    expect(parseMarkup('[u]sous[/u]').attrs[0]).toEqual({ u: true });
    expect(parseMarkup('[i]ita[/i]').attrs[0]).toEqual({ i: true });
  });

  it('lit couleur, taille et lien', () => {
    expect(parseMarkup('[c=#FF0000]rouge[/c]').attrs[0]).toEqual({ color: '#ff0000' });
    expect(parseMarkup('[c=accent]x[/c]').attrs[0]).toEqual({ color: 'accent' });
    expect(parseMarkup('[s=22]grand[/s]').attrs[0]).toEqual({ size: 22 });
    expect(parseMarkup('[s=99]borné[/s]').attrs[0]).toEqual({ size: 40 });
    expect(parseMarkup('[url=https://yunoapp.eu]lien[/url]').attrs[0]).toEqual({ href: 'https://yunoapp.eu' });
  });

  it('cumule les mises en forme imbriquées', () => {
    const doc = parseMarkup('[c=#ff0000][b]rouge gras[/b][/c]');
    expect(doc.text).toBe('rouge gras');
    expect(doc.attrs[0]).toEqual({ b: true, color: '#ff0000' });
  });

  it('laisse en clair ce qui ne ferme pas', () => {
    expect(parseMarkup('**pas fermé').text).toBe('**pas fermé');
    expect(parseMarkup('5 * 3 = 15').text).toBe('5 * 3 = 15');
    expect(parseMarkup('a_b_c').text).toBe('a_b_c');
  });

  it('garde les variables intactes', () => {
    const doc = parseMarkup('Salut {{prenom}}, **viens** !');
    expect(doc.text).toBe('Salut {{prenom}}, viens !');
  });
});

describe('parseMarkup — miroir exact des passes d’inlineMarkup', () => {
  // Ces trois cas sont ceux où une descente récursive naïve DIVERGE du rendu.
  it('***x*** = gras ET italique, comme le rendu', () => {
    const doc = parseMarkup('***x***');
    expect(doc.text).toBe('x');
    expect(doc.attrs[0]).toEqual({ b: true, i: true });
    expect(html('***x***')).toBe('<em><strong>x</strong></em>');
  });

  it('*a **b** c* = gras dans un passage italique, comme le rendu', () => {
    const doc = parseMarkup('*a **b** c*');
    expect(doc.text).toBe('a b c');
    expect(doc.attrs.every((a) => a.i)).toBe(true);
    expect(doc.attrs[2]).toEqual({ b: true, i: true });
    expect(html('*a **b** c*')).toBe('<em>a <strong>b</strong> c</em>');
  });

  it('le texte lu par l’éditeur est celui que l’email affiche', () => {
    for (const src of [
      '**gras** et *ita*',
      '[c=accent]**Ce soir**[/c] à [s=22]minuit[/s]',
      '***x***',
      '*a **b** c*',
      '[b]a [i]b[/i][/b]',
      'rien du tout',
      '[url=https://yunoapp.eu/event/x]billets[/url]',
    ]) {
      expect(parseMarkup(src).text).toBe(visible(src));
    }
  });
});

describe('serializeMarkup — aller-retour stable', () => {
  const roundTrip = (src: string) => serializeMarkup(parseMarkup(src));

  it('réécrit en crochets, sans rien perdre', () => {
    expect(roundTrip('**gras**')).toBe('[b]gras[/b]');
    expect(roundTrip('***x***')).toBe('[b][i]x[/i][/b]');
    expect(roundTrip('*a **b** c*')).toBe('[i]a [b]b[/b] c[/i]');
  });

  it('un deuxième aller-retour ne bouge plus (point fixe)', () => {
    for (const src of [
      '**gras** et *ita*',
      '***x***',
      '*a **b** c*',
      '[c=accent]Ce soir[/c] à [s=22]minuit[/s]',
      '[url=https://yunoapp.eu]lien **gras**[/url]',
      'ligne 1\n**ligne 2**\n\nligne 4',
      '5 * 3 = 15',
    ]) {
      const once = roundTrip(src);
      expect(roundTrip(once)).toBe(once);
      // et surtout : le lecteur voit exactement le même texte qu'avant.
      expect(visible(once)).toBe(visible(src));
    }
  });

  it('le rendu HTML survit à l’aller-retour', () => {
    const doc = parseMarkup('**Ce soir** à [c=accent]minuit[/c]');
    const out = html(serializeMarkup(doc));
    expect(out).toContain('<strong>Ce soir</strong>');
    expect(out).toContain(`color:${ACCENT}`);
  });

  it('ferme les balises à chaque saut de ligne', () => {
    const doc = patchRange(parseMarkup('a\nb'), 0, 3, { b: true });
    expect(serializeMarkup(doc)).toBe('[b]a[/b]\n[b]b[/b]');
    expect(parseMarkup(serializeMarkup(doc)).text).toBe('a\nb');
  });

  it('imbrique un chevauchement partiel au lieu de le casser', () => {
    // gras sur « a b », italique sur « b » seulement : markdown ne sait pas
    // l'écrire, les crochets si.
    let doc = parseMarkup('a b');
    doc = patchRange(doc, 0, 3, { b: true });
    doc = patchRange(doc, 2, 3, { i: true });
    const out = serializeMarkup(doc);
    expect(out).toBe('[b]a [i]b[/i][/b]');
    const back = parseMarkup(out);
    expect(back.text).toBe('a b');
    expect(back.attrs[0]).toEqual({ b: true });
    expect(back.attrs[2]).toEqual({ b: true, i: true });
  });

  it('renonce à une balise que le texte contient déjà', () => {
    const doc = patchRange(parseMarkup('dis [/b] voir'), 0, 12, { b: true });
    expect(serializeMarkup(doc)).toBe('dis [/b] voir');
  });

  it('ne sérialise pas un lien impossible à relire', () => {
    const doc = patchRange(parseMarkup('lien'), 0, 4, { href: 'https://x.eu/a]b' });
    expect(serializeMarkup(doc)).toBe('lien');
  });

  it('un texte sans mise en forme ressort identique', () => {
    expect(roundTrip('Salut {{prenom}} !\nÀ ce soir.')).toBe('Salut {{prenom}} !\nÀ ce soir.');
  });
});

describe('opérations de la barre de mise en forme', () => {
  it('patchRange pose et retire', () => {
    const doc = parseMarkup('abcdef');
    const bold = patchRange(doc, 2, 4, { b: true });
    expect(bold.attrs.map((a) => !!a.b)).toEqual([false, false, true, true, false, false]);
    const off = patchRange(bold, 2, 4, { b: false });
    expect(off.attrs.every((a) => !a.b)).toBe(true);
  });

  it('rangeHas dit si le clic allume ou éteint', () => {
    const doc = patchRange(parseMarkup('abcdef'), 0, 3, { b: true });
    expect(rangeHas(doc, 0, 3, 'b')).toBe(true);
    expect(rangeHas(doc, 0, 4, 'b')).toBe(false);
    expect(rangeHas(doc, 0, 0, 'b')).toBe(false);
    const red = patchRange(doc, 0, 3, { color: '#ff0000' });
    expect(rangeHas(red, 0, 3, 'color', '#ff0000')).toBe(true);
    expect(rangeHas(red, 0, 3, 'color', '#00ff00')).toBe(false);
  });

  it('clearRange nettoie tout d’un coup', () => {
    let doc = patchRange(parseMarkup('abcdef'), 0, 6, { b: true, color: '#ff0000', size: 22 });
    doc = clearRange(doc, 0, 6);
    expect(serializeMarkup(doc)).toBe('abcdef');
  });

  it('replaceRange insère du texte formaté', () => {
    const doc = replaceRange(parseMarkup('avant '), 6, 6, 'ici', { b: true });
    expect(doc.text).toBe('avant ici');
    expect(serializeMarkup(doc)).toBe('avant [b]ici[/b]');
  });

  it('replaceRangeWithDoc colle un texte déjà formaté', () => {
    const base = parseMarkup('a');
    const out = replaceRangeWithDoc(base, 1, 1, parseMarkup(' **b**'));
    expect(out.text).toBe('a b');
    expect(serializeMarkup(out)).toBe('a [b]b[/b]');
  });

  it('attrAt hérite du caractère qui précède', () => {
    const doc = patchRange(parseMarkup('ab'), 0, 2, { b: true });
    expect(attrAt(doc, 2)).toEqual({ b: true });
    expect(attrAt(parseMarkup(''), 0)).toEqual({});
  });

  it('normalizeAttr ne garde aucune clé fantôme', () => {
    expect(normalizeAttr({ b: false, color: '', size: 0, href: undefined })).toEqual({});
  });
});
