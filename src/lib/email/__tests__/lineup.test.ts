// Blocs Yuno branchés sur une billetterie connectée (Shotgun) et bloc Line-up.
// Le rendu d'envoi (port Deno) est un miroir : ces cas sont la référence.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDIO_THEME, makeBlock, renderBlock, stripEventBindings,
  artistInitials, artistKey, externalActivePrices, externalTicketRows, joinVenueLabel,
  lineupArtists, lineupPhoto, lineupUsesPhotos, priceFromLabel, LINEUP_KICKER, LIVE_BLOCK_TYPES,
  YUNO_BLOCK_TYPES, blocksWithoutLive, normalizeV2Blocks,
} from '../index';
import type { LineupBlock, RenderCtx } from '../types';

const theme = DEFAULT_STUDIO_THEME;
const PHOTO = 'https://cdn.shotgun.live/artists/maya.jpg';

function ctxWith(lineup: { name: string; photo?: string | null }[] | undefined): RenderCtx {
  return {
    venueName: 'Le Silo', emailType: 'promotional', subject: 's', preheader: '',
    recipient: { email: 'camille@example.com' },
    unsubscribeUrl: 'https://yunoapp.eu/u', socialLinks: {}, baseUrl: 'https://yunoapp.eu',
    live: {
      ev: {
        title: 'Minimal Room', startAt: '2026-10-08T21:00:00Z', dateLabel: 'Jeudi', venueLabel: 'Paris',
        url: 'https://shotgun.live/events/x', lineup,
      },
    },
  };
}

function lineupBlock(patch: Partial<LineupBlock> = {}): LineupBlock {
  return { ...(makeBlock('lineup') as LineupBlock), eventId: 'ev', ...patch };
}

describe('tarifs d’une soirée Shotgun', () => {
  const deals = [
    { id: '11', name: 'Guest list (avant 1h)', price: 0, out: false },
    { id: '12', name: 'Early bird', price: 14, out: true },
    { id: null, name: 'Regular', price: 18, out: false },
  ];
  it('un tarif vendu se lit « épuisé », un tarif à 0 € se lit « Gratuit »', () => {
    const rows = externalTicketRows(deals, false);
    expect(rows.map((r) => [r.n, r.p, r.out])).toEqual([
      ['Guest list (avant 1h)', 'Gratuit', false],
      ['Early bird', '14 €', true],
      ['Regular', '18 €', false],
    ]);
  });
  it('chaque tarif a un id stable pour être décroché du bloc', () => {
    const rows = externalTicketRows(deals, false);
    expect(rows.map((r) => r.id)).toEqual(['ext:11', 'ext:12', 'ext:n:regular']);
  });
  it('soirée complète : tout est épuisé, aucun prix d’appel', () => {
    expect(externalTicketRows(deals, true).every((r) => r.out)).toBe(true);
    expect(externalActivePrices(deals, true)).toEqual([]);
  });
  it('le prix d’appel ignore un tarif épuisé', () => {
    expect(priceFromLabel(externalActivePrices(deals, false), false)).toBe('À partir de 18 €');
  });
  it('le lieu d’une soirée sans nom de lieu n’écrit jamais « — Paris »', () => {
    expect(joinVenueLabel('', 'Paris')).toBe('Paris');
    expect(joinVenueLabel('Le Rex', 'Paris')).toBe('Le Rex — Paris');
    expect(joinVenueLabel('Le Rex', '')).toBe('Le Rex');
  });
});

describe('bloc Line-up — qui il montre', () => {
  const night = [{ name: 'DJ Maya', photo: PHOTO }, { name: 'Francois b2b Bernard', photo: null }];
  it('les artistes de la soirée, puis ceux ajoutés à la main, sans doublon', () => {
    const list = lineupArtists(night, { extra: [{ name: 'dj maya' }, { name: 'Invité surprise', photo: PHOTO }] });
    expect(list.map((a) => a.name)).toEqual(['DJ Maya', 'Francois b2b Bernard', 'Invité surprise']);
  });
  it('un artiste décroché sort, casse et accents ignorés', () => {
    const list = lineupArtists([{ name: 'Élodie' }, { name: 'Tom' }], { hidden: ['ELODIE'] });
    expect(list.map((a) => a.name)).toEqual(['Tom']);
  });
  it('une photo connue l’emporte sur l’absence de photo', () => {
    const list = lineupArtists([{ name: 'Tom', photo: null }], { extra: [{ name: 'tom', photo: PHOTO }] });
    expect(list).toEqual([{ name: 'Tom', photo: PHOTO }]);
  });
  it('seules les photos https passent', () => {
    expect(lineupPhoto('http://x.fr/a.jpg')).toBeNull();
    expect(lineupPhoto('https://x.fr/a b.jpg')).toBeNull();
    expect(lineupPhoto('javascript:alert(1)')).toBeNull();
    expect(lineupPhoto(PHOTO)).toBe(PHOTO);
  });
  it('initiales sans les liants de line-up', () => {
    expect(artistInitials('Francois b2b Bernard')).toBe('FB');
    expect(artistInitials('DJ Maya')).toBe('DM');
    expect(artistInitials('Ghoul')).toBe('G');
    expect(artistKey('  Ébène  Club ')).toBe('ebene club');
  });
  it('la grille ne s’allume qu’avec au moins une photo', () => {
    expect(lineupUsesPhotos(true, [{ name: 'A' }])).toBe(false);
    expect(lineupUsesPhotos(true, [{ name: 'A', photo: PHOTO }])).toBe(true);
    expect(lineupUsesPhotos(false, [{ name: 'A', photo: PHOTO }])).toBe(false);
  });
});

describe('bloc Line-up — rendu', () => {
  it('sans artiste connu ni ajouté, le bloc s’efface (jamais de noms d’exemple)', () => {
    expect(renderBlock(lineupBlock(), theme, ctxWith([]))).toBe('');
    expect(renderBlock(lineupBlock(), theme, ctxWith(undefined))).toBe('');
  });
  it('photos : grille de pastilles rondes, initiales pour qui n’en a pas', () => {
    const html = renderBlock(lineupBlock(), theme, ctxWith([{ name: 'DJ Maya', photo: PHOTO }, { name: 'Ghoul Collective' }]));
    expect(html).toContain(`src="${PHOTO}"`);
    expect(html).toContain('alt="DJ Maya"');
    expect(html).toContain('border-radius:44px');
    expect(html).toContain('>GC</td>');
    expect(html).toContain(LINEUP_KICKER);
  });
  it('photos éteintes (ou aucune connue) : une liste de noms', () => {
    const html = renderBlock(lineupBlock({ photos: false, kicker: 'Au programme' }), theme, ctxWith([{ name: 'DJ Maya', photo: PHOTO }]));
    expect(html).not.toContain('<img');
    expect(html).toContain('DJ Maya');
    expect(html).toContain('Au programme');
  });
  it('échappe les noms venus de la billetterie', () => {
    const html = renderBlock(lineupBlock({ photos: false }), theme, ctxWith([{ name: '<b>DJ</b> & co' }]));
    expect(html).toContain('&lt;b&gt;DJ&lt;/b&gt; &amp; co');
  });
  it('les artistes ajoutés à la main partent même sans line-up annoncé', () => {
    const html = renderBlock(lineupBlock({ extra: [{ name: 'Invité surprise' }] }), theme, ctxWith([]));
    expect(html).toContain('Invité surprise');
  });
});

describe('bloc Line-up — un bloc Yuno comme les autres', () => {
  it('il se relie à la soirée et part d’un e-mail sans soirée', () => {
    expect(YUNO_BLOCK_TYPES).toContain('lineup');
    expect(LIVE_BLOCK_TYPES).toContain('lineup');
    expect(blocksWithoutLive([makeBlock('lineup'), makeBlock('text')]).map((b) => b.type)).toEqual(['text']);
  });
  it('un modèle oublie les artistes décrochés ou ajoutés pour UNE soirée', () => {
    const [b] = stripEventBindings([lineupBlock({ hidden: ['Tom'], extra: [{ name: 'X' }] })]) as LineupBlock[];
    expect(b.eventId).toBeUndefined();
    expect(b.hidden).toBeUndefined();
    expect(b.extra).toBeUndefined();
  });
});

describe('ouverture d’une campagne enregistrée', () => {
  it('garde les règles complémentaires (no_vip_table, no_buyers) au lieu de les effacer', () => {
    const blocks = normalizeV2Blocks([
      { ...makeBlock('text'), cond: 'no_vip_table' },
      { ...makeBlock('text'), cond: 'no_buyers' },
      { ...makeBlock('text'), cond: 'VIP · Table' },
      { ...makeBlock('text'), cond: 'inconnue' },
    ]);
    expect(blocks.map((b) => b.cond)).toEqual(['no_vip_table', 'no_buyers', 'vip_table', null]);
  });
});
