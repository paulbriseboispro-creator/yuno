import { describe, expect, it } from 'vitest';
import { coverFrameImg } from '../render';

describe('coverFrameImg', () => {
  it('cadre toute affiche en 16:9, recadrée au centre', () => {
    const html = coverFrameImg('https://x.test/a.jpg', 'Soirée', 560, 'border-radius:12px;');
    expect(html).toContain('width="560" height="315"');
    expect(html).toContain('aspect-ratio:16/9;object-fit:cover');
    expect(html).toContain('class="yn-img yn-cover"');
  });

  it("donne à Outlook l'image sans hauteur imposée", () => {
    const html = coverFrameImg('https://x.test/a.jpg', 'Soirée', 232, '');
    const mso = html.split('<![endif]-->')[0];
    expect(mso.startsWith('<!--[if mso]>')).toBe(true);
    expect(mso).toContain('height:auto');
    expect(mso).not.toContain('object-fit');
  });

  it("échappe l'adresse et le texte alternatif", () => {
    const html = coverFrameImg('https://x.test/a.jpg?a=1&b="2"', 'A "B" <C>', 560, '');
    expect(html).not.toContain('<C>');
    expect(html).toContain('&amp;');
  });
});
