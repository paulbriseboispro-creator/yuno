import { describe, expect, it } from 'vitest';
import { inlinePlainText, parseHelpBody, readingMinutes } from '../helpText';

describe('parseHelpBody', () => {
  it('turns numbered lines into an ordered list and keeps the intro paragraph', () => {
    const blocks = parseHelpBody('Pour configurer :\n1. Allez dans Événements\n2. Ouvrez la soirée\n\nEnsuite, publiez.');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ol', 'p']);
    const ol = blocks[1];
    if (ol.kind !== 'ol') throw new Error('expected ol');
    expect(ol.items).toHaveLength(2);
    expect(inlinePlainText(ol.items[1].inlines)).toBe('Ouvrez la soirée');
  });

  it('reads bullets, and maps ✅ / ❌ to a tone instead of an emoji', () => {
    const blocks = parseHelpBody('• ✅ Vert = billet valide\n• ❌ Rouge = déjà scanné\n- Neutre');
    expect(blocks).toHaveLength(1);
    const ul = blocks[0];
    if (ul.kind !== 'ul') throw new Error('expected ul');
    expect(ul.items.map((i) => i.tone)).toEqual(['ok', 'no', undefined]);
    expect(inlinePlainText(ul.items[0].inlines)).toBe('Vert = billet valide');
  });

  it('isolates a navigation path from the words around it', () => {
    const [p] = parseHelpBody('Allez dans Dashboard → Événements → Billetterie et activez la vente.');
    if (p.kind !== 'p') throw new Error('expected p');
    const path = p.inlines.find((i) => i.kind === 'path');
    expect(path && path.kind === 'path' ? path.steps : null).toEqual(['Dashboard', 'Événements', 'Billetterie']);
    expect(inlinePlainText(p.inlines)).toBe('Allez dans Dashboard → Événements → Billetterie et activez la vente.');
  });

  it('handles a path inside parentheses', () => {
    const [p] = parseHelpBody('Depuis la page Remboursements (Dashboard → Ventes & finances → Commandes → Remboursements). Les règles :');
    if (p.kind !== 'p') throw new Error('expected p');
    const path = p.inlines.find((i) => i.kind === 'path');
    expect(path && path.kind === 'path' ? path.steps : null).toEqual(['Dashboard', 'Ventes & finances', 'Commandes', 'Remboursements']);
  });

  it('starts the path at the first capitalized word', () => {
    const [p] = parseHelpBody('Billetterie (groupe Événements → Billetterie, intitulée "Gestion") est la page.');
    if (p.kind !== 'p') throw new Error('expected p');
    const path = p.inlines.find((i) => i.kind === 'path');
    expect(path && path.kind === 'path' ? path.steps : null).toEqual(['Événements', 'Billetterie']);
  });

  it('never swallows a bold marker into a path chip', () => {
    const [p] = parseHelpBody('• **Santé de la connexion** → "Vérifier maintenant" : relit le jeton.');
    if (p.kind !== 'ul') throw new Error('expected ul');
    const kinds = p.items[0].inlines.map((i) => i.kind);
    expect(kinds).not.toContain('path');
    expect(kinds).toContain('strong');
  });

  it('keeps bold and quoted labels', () => {
    const [p] = parseHelpBody('Cliquez sur "Créer un événement" puis **enregistrez**.');
    if (p.kind !== 'p') throw new Error('expected p');
    expect(p.inlines).toEqual([
      { kind: 'text', text: 'Cliquez sur ' },
      { kind: 'label', text: 'Créer un événement' },
      { kind: 'text', text: ' puis ' },
      { kind: 'strong', text: 'enregistrez' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves a lone arrow that is not a path as plain text', () => {
    const [p] = parseHelpBody('Early Bird → Normal → Dernière minute : les paliers s’enchaînent.');
    if (p.kind !== 'p') throw new Error('expected p');
    expect(inlinePlainText(p.inlines)).toContain('Early Bird → Normal → Dernière minute');
  });
});

describe('readingMinutes', () => {
  it('never returns less than one minute', () => {
    expect(readingMinutes(['court'])).toBe(1);
    expect(readingMinutes([Array.from({ length: 450 }, () => 'mot').join(' ')])).toBe(2);
  });
});
