/**
 * La provenance d'une vente, lisible : un CANAL et un NOM figés sur la vente par
 * la base (`attribution_channel`, `attribution_label`, migration 20261212100000,
 * règle unique `sale_source_resolve`). Ce module ne décide rien : il nomme.
 *
 * Les mots vivent ici en triplets [EN, FR, ES] (comme `partnerLinkWords.ts`) :
 * les commandes (dictionnaire principal) et la fiche client (section `tixana`)
 * lisent la même source, sans dupliquer de clés.
 */

export const SALE_CHANNELS = [
  'promoter', 'dj', 'partner', 'instagram', 'tiktok', 'facebook', 'whatsapp', 'social', 'ads',
  'email', 'sms', 'link', 'qr', 'promo_code', 'yuno', 'search', 'web', 'door', 'direct',
] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

/** Le type de clientèle : les canaux regroupés en familles qu'un pro reconnaît. */
export const SALE_FAMILIES = ['people', 'social', 'messages', 'yuno', 'other', 'unknown'] as const;
export type SaleFamily = (typeof SALE_FAMILIES)[number];

export type SaleLanguage = 'en' | 'fr' | 'es';
type Triple = readonly [string, string, string];

const CHANNEL_WORDS: Record<SaleChannel, { name: Triple; plural: Triple }> = {
  promoter: { name: ['Promoter', 'Promoteur', 'Promotor'], plural: ['Promoters', 'Promoteurs', 'Promotores'] },
  dj: { name: ['DJ / artist', 'DJ / artiste', 'DJ / artista'], plural: ['DJs / artists', 'DJ / artistes', 'DJ / artistas'] },
  partner: { name: ['Partner', 'Partenaire', 'Socio'], plural: ['Partners', 'Partenaires', 'Socios'] },
  instagram: { name: ['Instagram', 'Instagram', 'Instagram'], plural: ['Instagram', 'Instagram', 'Instagram'] },
  tiktok: { name: ['TikTok', 'TikTok', 'TikTok'], plural: ['TikTok', 'TikTok', 'TikTok'] },
  facebook: { name: ['Facebook', 'Facebook', 'Facebook'], plural: ['Facebook', 'Facebook', 'Facebook'] },
  whatsapp: { name: ['WhatsApp', 'WhatsApp', 'WhatsApp'], plural: ['WhatsApp', 'WhatsApp', 'WhatsApp'] },
  social: { name: ['Other social network', 'Autre réseau social', 'Otra red social'], plural: ['Other social networks', 'Autres réseaux', 'Otras redes'] },
  ads: { name: ['Meta ad', 'Pub Meta', 'Anuncio Meta'], plural: ['Meta ads', 'Pubs Meta', 'Anuncios Meta'] },
  email: { name: ['Email', 'E-mail', 'Email'], plural: ['Emails', 'E-mails', 'Emails'] },
  sms: { name: ['SMS', 'SMS', 'SMS'], plural: ['SMS', 'SMS', 'SMS'] },
  link: { name: ['Tracked link', 'Lien suivi', 'Enlace rastreado'], plural: ['Tracked links', 'Liens suivis', 'Enlaces rastreados'] },
  qr: { name: ['QR code / flyer', 'QR code / flyer', 'Código QR / flyer'], plural: ['QR codes / flyers', 'QR codes / flyers', 'Códigos QR / flyers'] },
  promo_code: { name: ['Promo code', 'Code promo', 'Código promocional'], plural: ['Promo codes', 'Codes promo', 'Códigos promocionales'] },
  yuno: { name: ['Found on Yuno', 'Trouvé sur Yuno', 'Encontrado en Yuno'], plural: ['Yuno discovery', 'Découverte Yuno', 'Descubrimiento Yuno'] },
  search: { name: ['Google / search', 'Google / recherche', 'Google / búsqueda'], plural: ['Search', 'Recherche', 'Búsqueda'] },
  web: { name: ['Another website', 'Autre site', 'Otro sitio'], plural: ['Other websites', 'Autres sites', 'Otros sitios'] },
  door: { name: ['Added at the door', 'Ajouté sur place', 'Añadido en la puerta'], plural: ['Added at the door', 'Ajoutés sur place', 'Añadidos en la puerta'] },
  direct: { name: ['Unknown (direct)', 'Inconnue (direct)', 'Desconocido (directo)'], plural: ['Unknown (direct)', 'Inconnue (direct)', 'Desconocido (directo)'] },
};

const FAMILY_OF: Record<SaleChannel, SaleFamily> = {
  promoter: 'people', dj: 'people', partner: 'people',
  instagram: 'social', tiktok: 'social', facebook: 'social', whatsapp: 'social', social: 'social', ads: 'social',
  email: 'messages', sms: 'messages',
  yuno: 'yuno', search: 'yuno',
  link: 'other', qr: 'other', promo_code: 'other', web: 'other',
  door: 'unknown', direct: 'unknown',
};

/** Ce que la base met dans `attribution_label` pour une vente trouvée sur Yuno. */
const YUNO_PAGES: Record<string, Triple> = {
  explore: ['Explore page', 'Page Explorer', 'Página Explorar'],
  venue_profile: ["Club's Yuno page", 'Page Yuno du club', 'Página Yuno del club'],
  organizer_profile: ["Organizer's Yuno page", "Page Yuno de l'organisateur", 'Página Yuno del organizador'],
  dj_profile: ["DJ's Yuno page", 'Page Yuno du DJ', 'Página Yuno del DJ'],
};

const WORDS = {
  source: ['Source', 'Provenance', 'Origen'],
  sourceHint: ['How this order reached you', 'Comment cette commande est arrivée', 'Cómo llegó este pedido'],
  unknownHint: [
    'No link, promoter or campaign was recognised: the buyer typed the address or shared it privately.',
    "Aucun lien, promoteur ni campagne reconnu : l'acheteur a tapé l'adresse ou l'a reçue en privé.",
    'Ningún enlace, promotor ni campaña reconocido: el comprador escribió la dirección o la recibió en privado.',
  ],
  clientTitle: ['How this customer comes', 'Comment ce client vient', 'Cómo viene este cliente'],
  clientOrders: ['{n} orders', '{n} commandes', '{n} pedidos'],
  clientOrder: ['1 order', '1 commande', '1 pedido'],
  firstTime: ['First time via {x}', 'La première fois via {x}', 'La primera vez vía {x}'],
  onceRest: ['Once via {x}, the rest unknown', 'Une fois via {x}, le reste inconnu', 'Una vez vía {x}, el resto desconocido'],
  loyalTo: ['Always via {x}', 'Toujours via {x}', 'Siempre vía {x}'],
  sameChannelMany: [
    'Every order via a {x}, never the same one twice',
    'Chaque commande via un {x}, jamais le même',
    'Cada pedido vía un {x}, nunca el mismo',
  ],
  sameChannelSome: [
    'Every order via a {x}, not always the same one',
    'Chaque commande via un {x}, pas toujours le même',
    'Cada pedido vía un {x}, no siempre el mismo',
  ],
  thisCustomer: ['This customer', 'Ce client', 'Este cliente'],
  mostly: ['Mostly via {x}', 'Surtout via {x}', 'Sobre todo vía {x}'],
  mixed: ['Comes through several channels', 'Vient par plusieurs canaux', 'Viene por varios canales'],
  onlyUnknown: ['No known source yet', 'Aucune provenance connue pour l’instant', 'Ningún origen conocido por ahora'],
  mixTitle: ['Where your customers come from', "D'où viennent vos clients", 'De dónde vienen tus clientes'],
  mixSub: [
    'Each customer counted once, under the channel of most of their orders.',
    'Chaque client compté une fois, sous le canal de la plupart de ses commandes.',
    'Cada cliente contado una vez, bajo el canal de la mayoría de sus pedidos.',
  ],
  mixKnown: ['{p} of customers have a known source', '{p} des clients ont une provenance connue', '{p} de los clientes tienen un origen conocido'],
  mixMulti: ['{n} come through several channels', '{n} viennent par plusieurs canaux', '{n} vienen por varios canales'],
  mixMultiOne: ['1 comes through several channels', '1 vient par plusieurs canaux', '1 viene por varios canales'],
  mixClients: ['{n} customers', '{n} clients', '{n} clientes'],
  mixClient: ['1 customer', '1 client', '1 cliente'],
  mixTop: ['Who brings the most', 'Qui fait venir le plus', 'Quién trae más'],
  mixEmpty: ['No sales yet', 'Pas encore de vente', 'Todavía no hay ventas'],
  period: ['Period', 'Période', 'Periodo'],
  all: ['All time', 'Depuis le début', 'Desde el inicio'],
  last30: ['30 days', '30 jours', '30 días'],
  last90: ['90 days', '90 jours', '90 días'],
  families: {
    people: ['People who bring others', 'Les gens qui font venir', 'Las personas que traen gente'],
    social: ['Social networks', 'Réseaux sociaux', 'Redes sociales'],
    messages: ['Your messages', 'Vos messages', 'Tus mensajes'],
    yuno: ['Discovery', 'Découverte', 'Descubrimiento'],
    other: ['Links, QR and codes', 'Liens, QR et codes', 'Enlaces, QR y códigos'],
    unknown: ['Unknown', 'Inconnue', 'Desconocido'],
  },
} as const;

const IDX: Record<SaleLanguage, 0 | 1 | 2> = { en: 0, fr: 1, es: 2 };

export function toSaleLanguage(lang: string | null | undefined): SaleLanguage {
  return lang === 'fr' || lang === 'es' ? lang : 'en';
}

export function isSaleChannel(v: unknown): v is SaleChannel {
  return typeof v === 'string' && (SALE_CHANNELS as readonly string[]).includes(v);
}

/** Un canal inconnu (version plus récente de la base) se lit comme « direct ». */
export function toSaleChannel(v: unknown): SaleChannel {
  return isSaleChannel(v) ? v : 'direct';
}

/** Canal qui dit vraiment d'où vient la vente (ni « direct », ni ajout à la porte). */
export function isKnownChannel(ch: SaleChannel): boolean {
  return ch !== 'direct' && ch !== 'door';
}

export function channelFamily(ch: SaleChannel): SaleFamily {
  return FAMILY_OF[ch];
}

export function channelName(ch: SaleChannel, lang: SaleLanguage, plural = false): string {
  const w = CHANNEL_WORDS[ch];
  return (plural ? w.plural : w.name)[IDX[lang]];
}

export function familyName(f: SaleFamily, lang: SaleLanguage): string {
  return WORDS.families[f][IDX[lang]];
}

type WordKey = Exclude<keyof typeof WORDS, 'families'>;
export function saleWord(key: WordKey, lang: SaleLanguage, vars: Record<string, string | number> = {}): string {
  let s: string = WORDS[key][IDX[lang]];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Le « qui / quoi » d'une vente : le nom figé, ou la page Yuno traduite. */
export function sourceDetail(ch: SaleChannel, label: string | null | undefined, lang: SaleLanguage): string | null {
  const l = label?.trim();
  if (!l) return null;
  if (ch === 'yuno' || ch === 'dj') {
    const page = YUNO_PAGES[l];
    if (page) return page[IDX[lang]];
  }
  return l;
}

/** « Promoteur · Jimena Albert », « Instagram · Story 3 · J-7 », « Inconnue (direct) ». */
export function saleSourceLine(channel: unknown, label: string | null | undefined, lang: SaleLanguage): string {
  const ch = toSaleChannel(channel);
  const d = sourceDetail(ch, label, lang);
  return d ? `${channelName(ch, lang)} · ${d}` : channelName(ch, lang);
}

export interface ChannelCount { channel: SaleChannel; n: number; names?: { label: string; n: number }[] }

/**
 * Le résumé d'un client en une phrase, à partir du nombre de ses commandes par
 * canal (miroir de la règle du « canal principal » de `tix_clients_source_mix` :
 * « direct » et la porte ne comptent pas dès qu'un canal connu existe).
 */
/** Les canaux qui sont des PERSONNES, et leur nom commun dans une phrase (« via un promoteur »). */
const PERSON_NOUN: Partial<Record<SaleChannel, Triple>> = {
  promoter: ['promoter', 'promoteur', 'promotor'],
  dj: ['DJ', 'DJ', 'DJ'],
  partner: ['partner', 'partenaire', 'socio'],
};

export function clientSourceSummary(counts: ChannelCount[], lang: SaleLanguage): string {
  const known = counts.filter((c) => isKnownChannel(c.channel) && c.n > 0).sort((a, b) => b.n - a.n);
  if (!known.length) return saleWord('onlyUnknown', lang);
  const total = known.reduce((s, c) => s + c.n, 0);
  const top = known[0];
  // Une seule personne derrière le canal : on la nomme (« Jimena Albert · Promoteur »).
  const who = top.names?.length === 1 && top.names[0].n === top.n ? sourceDetail(top.channel, top.names[0].label, lang) : null;
  const name = who ? `${who} · ${channelName(top.channel, lang)}` : channelName(top.channel, lang);
  const unknown = counts.reduce((s, c) => s + (isKnownChannel(c.channel) ? 0 : c.n), 0);
  if (total === 1) return saleWord(unknown > 0 ? 'onceRest' : 'firstTime', lang, { x: name });
  if (known.length === 1) {
    // Un seul canal mais plusieurs personnes (Gaspard puis Chrysoula) : jamais « toujours via »,
    // qui se lirait comme « toujours via cette personne ».
    const people = top.names?.length ?? 0;
    const noun = PERSON_NOUN[top.channel];
    if (people >= 2 && noun) {
      return saleWord(people === top.n ? 'sameChannelMany' : 'sameChannelSome', lang, { x: noun[IDX[lang]] });
    }
    return saleWord('loyalTo', lang, { x: name });
  }
  if (top.n / total >= 0.6 && (known[1]?.n ?? 0) < top.n) return saleWord('mostly', lang, { x: name });
  return saleWord('mixed', lang);
}

/**
 * Les pastilles d'un client : une par personne nommée (« Gaspard ×1 », « Chrysoula Fotaki ×1 »),
 * puis une par canal pour les commandes sans nom. Jamais le nombre d'un canal posé sur un nom.
 */
export function clientSourceChips(counts: ChannelCount[], lang: SaleLanguage): { key: string; channel: SaleChannel; label: string; n: number }[] {
  const out: { key: string; channel: SaleChannel; label: string; n: number }[] = [];
  for (const c of counts) {
    let named = 0;
    for (const nm of c.names ?? []) {
      named += nm.n;
      out.push({ key: `${c.channel}:${nm.label}`, channel: c.channel, label: sourceDetail(c.channel, nm.label, lang) ?? nm.label, n: nm.n });
    }
    if (c.n - named > 0) out.push({ key: c.channel, channel: c.channel, label: channelName(c.channel, lang), n: c.n - named });
  }
  return out;
}

/** Couleur d'un canal (marque du réseau quand elle existe, sinon une teinte par famille). */
export function channelColor(ch: SaleChannel): string {
  switch (ch) {
    case 'instagram': return '#E1306C';
    case 'tiktok': return '#25F4EE';
    case 'facebook': return '#1877F2';
    case 'whatsapp': return '#25D366';
    case 'ads': return '#0866FF';
    case 'promoter': return '#F59E0B';
    case 'dj': return '#A855F7';
    case 'partner': return '#EC4899';
    case 'email': return '#3B82F6';
    case 'sms': return '#06B6D4';
    case 'yuno': return '#E8192C';
    case 'search': return '#10B981';
    default: return '#9CA3AF';
  }
}
