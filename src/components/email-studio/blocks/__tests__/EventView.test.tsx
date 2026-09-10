import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_STUDIO_THEME, makeBlock } from '@/lib/email';
import type { EventBlock, LiveData } from '@/lib/email';
import EventView from '../EventView';
import type { CanvasCtx } from '../common';

// ─────────────────────────────────────────────────────────────────────────────
// Le canvas est un MIROIR React du rendu email : deux implémentations de la
// même carte. Elles ont déjà divergé une fois — l'inspecteur réglait la mise
// en page et l'aperçu ne bougeait pas. Ces cas gardent le miroir honnête :
// chaque réglage du bloc doit se VOIR dans l'aperçu.
// ─────────────────────────────────────────────────────────────────────────────

const theme = DEFAULT_STUDIO_THEME;

const live: LiveData = {
  'ev-1': {
    title: 'Nuit Blanche', startAt: '2026-09-12T21:30:00Z',
    dateLabel: 'Vendredi 12 sept', venueLabel: 'WOH — Paris 11e',
    coverUrl: 'https://cdn.example.com/affiche.jpg',
    url: 'https://yunoapp.eu/event/ev-1', priceFromLabel: 'À partir de 18 €',
  },
};

const ctx: CanvasCtx = {
  venueName: 'WOH', socialLinks: {}, live, baseUrl: 'https://yunoapp.eu',
};

function view(patch: Partial<EventBlock> = {}): string {
  const base = makeBlock('event', { eventId: 'ev-1', venueName: 'WOH' }) as EventBlock;
  return renderToStaticMarkup(
    React.createElement(EventView, { block: { ...base, ...patch }, theme, ctx }),
  );
}

describe('aperçu canvas du bloc Soirée', () => {
  it('la fiche en tableau montre les libellés, la fiche en lignes non', () => {
    expect(view({ metaDisplay: 'rows' })).toContain('Date');
    expect(view({ metaDisplay: 'rows' })).toContain('Tarif');
    expect(view({ metaDisplay: 'stack' })).not.toContain('Tarif');
  });

  it('la fiche sur une ligne joint tout par un point médian', () => {
    expect(view({ metaDisplay: 'inline' })).toContain('Vendredi 12 sept · WOH — Paris 11e');
  });

  it('l’alignement choisi arrive VRAIMENT dans l’aperçu', () => {
    expect(view({ align: 'center' })).toContain('text-align:center');
    expect(view({ align: 'right' })).toContain('text-align:right');
  });

  it('chaque mise en page se distingue dans l’aperçu', () => {
    // Épuré : aucun cadre de carte.
    expect(view({ layout: 'minimal' })).not.toContain('border-radius:14px');
    expect(view({ layout: 'showcase' })).toContain('border-radius:14px');
    // Côte à côte : deux colonnes, l'affiche à 40 %.
    expect(view({ layout: 'split' })).toContain('flex:0 0 40%');
    expect(view({ layout: 'showcase' })).not.toContain('flex:0 0 40%');
    // Sur l'aperçu téléphone, le côte à côte s'empile.
    const mobile = renderToStaticMarkup(React.createElement(EventView, {
      block: { ...(makeBlock('event', { eventId: 'ev-1' }) as EventBlock), layout: 'split' },
      theme, ctx, mobile: true,
    }));
    expect(mobile).toContain('flex-direction:column');
  });

  it('l’interrupteur de l’affiche la retire, sa place la déplace', () => {
    expect(view({ cover: true })).toContain('cdn.example.com/affiche.jpg');
    expect(view({ cover: false })).not.toContain('cdn.example.com/affiche.jpg');
    // En haut l'affiche touche les bords de la carte ; en bas elle vit dans la
    // cellule de contenu, donc APRÈS le titre.
    const bottom = view({ coverPos: 'bottom' });
    expect(bottom.indexOf('Nuit Blanche')).toBeLessThan(bottom.indexOf('affiche.jpg'));
    const top = view({ coverPos: 'top' });
    expect(top.indexOf('affiche.jpg')).toBeLessThan(top.indexOf('Nuit Blanche'));
  });

  it('le lieu et le tarif suivent leurs interrupteurs', () => {
    expect(view({ metaDisplay: 'stack', venue: false })).not.toContain('WOH — Paris 11e');
    expect(view({ metaDisplay: 'stack', price: false })).not.toContain('À partir de 18 €');
  });
});
