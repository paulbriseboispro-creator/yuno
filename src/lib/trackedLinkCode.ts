/**
 * L'adresse d'un lien suivi se LIT : `yunoapp.eu/l/house-of-masquerade-insta`,
 * jamais `yunoapp.eu/l/y1etp142` (décision de Paul du 19/10 : un code au hasard
 * dans une bio Instagram ressemble à un lien douteux).
 *
 * C'est la BASE qui fabrique le code (`tracked_link_readable_code`, migration
 * 20261103100000) : elle seule voit les codes déjà pris. Ce module en est le
 * miroir EXACT pour ce que la Console montre avant l'enregistrement (le code
 * proposé d'un lien partenaire). Mêmes cas testés des deux côtés :
 * `src/lib/__tests__/fixtures/tracked-link-codes.json`.
 *
 * Forme : soirée + réseau (`house-of-masquerade-insta`), la date quand deux
 * soirées portent le même nom (`goya-thursday-23-10-insta`), le nom de qui
 * partage quand ce n'est pas l'hôte (`house-of-masquerade-telos-insta`).
 */

/** Longueur maximale d'un code (la base refuse au-delà). */
export const LINK_CODE_MAX = 60;
/** Le nom de la soirée ne prend jamais plus que ça : la fin de l'adresse dit le réseau. */
export const LINK_BASE_MAX = 28;
/** Un nom de partenaire, de DJ ou un réseau personnalisé. */
export const LINK_PART_MAX = 20;

/**
 * « Nuit Amoris : Édition #3 » → « nuit-amoris-edition-3 », coupé au MOT
 * (jamais « house-of-masquer »). Miroir de `tracked_link_slug`.
 */
export function linkSlug(raw: string | null | undefined, max: number = LINK_BASE_MAX): string {
  // Ligatures, puis accents retirés, puis minuscules : le même ordre que la base.
  let v = (raw ?? '').replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/[ßẞ]/g, 'ss');
  v = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  v = v.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!v || max < 1) return '';
  if (v.length <= max) return v;
  // Trop long : les « x » des collabs (« Club Sonore x Exclusive x WOH ») sautent
  // avant de couper, sinon la coupe finit sur « …-exclusive-x ».
  let t = `-${v}-`;
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(/-x-/g, '-'); }
  v = t.replace(/^-+|-+$/g, '');
  if (v.length <= max) return v;
  let out = '';
  for (const w of v.split('-')) {
    if (out.length + (out ? 1 : 0) + w.length > max) break;
    out = out ? `${out}-${w}` : w;
  }
  return out || v.slice(0, max).replace(/-+$/, '');
}

/** Le réseau tel qu'il s'écrit à la fin de l'adresse. Miroir de `tracked_link_channel_tag`. */
export function linkChannelTag(word: string | null | undefined): string {
  const w = (word ?? '').trim().toLowerCase();
  if (w === 'instagram') return 'insta';
  if (w === 'meta' || w === 'meta_ads') return 'ads';
  return linkSlug(w, LINK_PART_MAX);
}

/**
 * Assemble `[préfixe]-soirée-[parties…]` en 60 caractères au plus : c'est le
 * nom de la soirée qui raccourcit, jamais la fin (le réseau, le partenaire).
 * Miroir de `tracked_link_compose`.
 */
export function composeLinkCode(prefix: string | null, baseRaw: string, tail: ReadonlyArray<string | null | undefined>): string {
  const tailStr = tail.filter((p): p is string => !!p).join('-');
  const rest = (prefix ? prefix.length + 1 : 0) + (tailStr ? tailStr.length + 1 : 0);
  const base = linkSlug(baseRaw, Math.max(8, Math.min(LINK_BASE_MAX, LINK_CODE_MAX - rest)));
  let out = [prefix, base, tailStr].filter((p): p is string => !!p).join('-');
  out = out.slice(0, LINK_CODE_MAX).replace(/^-+|-+$/g, '');
  // « m- », « s- », « d- » en tête sont des familles de source du CRM
  // (`yuno-m-…` = un e-mail) : un code ne commence jamais ainsi.
  return out.replace(/^([msd])-/, '$1');
}

/** Ce que la Console propose pour un lien partenaire : `house-of-masquerade-telos`. */
export function suggestPartnerLinkCode(partnerName: string, eventTitle: string): string {
  return composeLinkCode(null, eventTitle || 'yuno', [linkSlug(partnerName, LINK_PART_MAX) || 'partner']);
}
