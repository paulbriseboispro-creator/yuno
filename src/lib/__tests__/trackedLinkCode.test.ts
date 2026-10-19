import { describe, expect, it } from 'vitest';
import cases from './fixtures/tracked-link-codes.json';
import { composeLinkCode, LINK_CODE_MAX, linkChannelTag, linkSlug, suggestPartnerLinkCode } from '../trackedLinkCode';

// Mêmes cas que la base (tracked_link_slug / _channel_tag / _compose) : un écart
// ici, c'est la Console qui annonce un autre lien que celui que la base crée.
describe('adresse lisible des liens suivis', () => {
  it.each(cases.slug)('slug « $in » ($max) → « $out »', ({ in: raw, max, out }) => {
    expect(linkSlug(raw, max)).toBe(out);
  });

  it.each(cases.tag)('réseau « $in » → « $out »', ({ in: raw, out }) => {
    expect(linkChannelTag(raw)).toBe(out);
  });

  it.each(cases.compose)('compose → « $out »', ({ prefix, base, tail, out }) => {
    const code = composeLinkCode(prefix, base, tail);
    expect(code).toBe(out);
    expect(code.length).toBeLessThanOrEqual(LINK_CODE_MAX);
    expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it.each(cases.partner)('partenaire $name → « $out »', ({ name, event, out }) => {
    expect(suggestPartnerLinkCode(name, event)).toBe(out);
  });

  it('ne commence jamais par une famille de source du CRM', () => {
    for (const t of ['M Night', 'S Club', 'D Day']) {
      expect(composeLinkCode(null, t, ['insta'])).not.toMatch(/^[msd]-/);
    }
  });
});
