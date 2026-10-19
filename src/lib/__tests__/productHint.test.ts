import { describe, expect, it } from 'vitest';
import { hasCrmProductHint, productHintCookie, PRODUCT_HINT_COOKIE } from '../productHint';

describe('productHint', () => {
  it('se pose sur le domaine parent, seulement en production', () => {
    expect(productHintCookie('crm.yunoapp.eu')).toBe(`${PRODUCT_HINT_COOKIE}=crm; Domain=yunoapp.eu; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
    expect(productHintCookie('yunoapp.eu')).toContain('Domain=yunoapp.eu');
    expect(productHintCookie('crm.localhost')).toBeNull();
    expect(productHintCookie('localhost')).toBeNull();
    expect(productHintCookie('evil-yunoapp.eu')).toBeNull();
  });
  it('se lit dans un en-tête Cookie ou document.cookie, à la valeur exacte', () => {
    expect(hasCrmProductHint('a=1; yuno_product=crm; b=2')).toBe(true);
    expect(hasCrmProductHint('yuno_product=crm')).toBe(true);
    expect(hasCrmProductHint('yuno_product=suite')).toBe(false);
    expect(hasCrmProductHint('xyuno_product=crm')).toBe(false);
    expect(hasCrmProductHint('')).toBe(false);
    expect(hasCrmProductHint(null)).toBe(false);
  });
});
