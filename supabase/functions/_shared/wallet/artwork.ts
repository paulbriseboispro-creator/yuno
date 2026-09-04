// Affiche de la soirée sur le pass Wallet — la seule image du pass qui change
// d'un billet à l'autre. Deux tailles, deux usages (HIG › Wallet › Pass images) :
//   - thumbnail 90x90pt   : la vignette carrée du eventTicket CLASSIQUE, à
//     droite du titre. C'est ce que voient iOS 17 et antérieurs.
//   - artwork  358x448pt  : l'affiche plein cadre du POSTER event ticket
//     (iOS 18+). Ratio 4:5, PAS 3:4 — 358/448 = 0,799.
//
// Trois contraintes pilotent ce module, ne pas les défaire :
//
//  1. PassKit n'accepte QUE du PNG (« Create pass images in PNG format »,
//     HIG › Wallet). Les affiches sont stockées en JPEG/WebP →
//     il faut décoder puis ré-encoder. `imagescript` le fait en WASM pur, donc
//     dans l'edge runtime (sharp/canvas sont exclus : binaires natifs).
//  2. L'import d'imagescript est DYNAMIQUE. Ce module est atteint depuis
//     send-ticket-confirmation, qui est d'abord une fonction d'emails : un
//     import statique de ~1 Mo de WASM pénaliserait chaque envoi d'email
//     alors qu'aucun email n'a besoin d'images de pass.
//  3. Le recadrage se fait côté Supabase (transform `render/image`) quand
//     l'affiche vit dans notre Storage : c'est gratuit, mis en cache, et ça
//     évite de décoder une image de 4000px pour en garder 270. Le transform ne
//     SUR-ÉCHANTILLONNE jamais : demander plus grand que la source renvoie une
//     image plus petite au ratio d'origine — d'où le recadrage de secours en
//     local, qui reste le seul chemin pour les URLs hors Storage (démos).
//
// Tout échec est silencieux et renvoie `null` : un pass sans affiche reste un
// billet valide, un pass qui n'est pas émis est un client à la porte sans QR.

/** Cadres Apple, en points. */
export const THUMB_PT = 90;
export const ARTWORK_PT = { w: 358, h: 448 } as const;

// Apple ne demande QUE @2x et @3x pour les passes modernes (« Create pass
// images in PNG format in @2x and @3x format »). Ajouter le @1x ne servirait
// aucun appareil vendu depuis 2014.
//
// Poids mesurés sur une affiche réelle (1080x1080 d'origine) : vignette ~210 Ko
// les deux échelles, artwork ~1,1 Mo en @2x et ~2,2 Mo en @3x. Le PNG ne
// compresse pas le bruit d'un flyer et PassKit n'accepte rien d'autre : un pass
// CLASSIQUE pèse donc ~250 Ko, un pass POSTER ~3,5 Mo. C'est au-dessus des
// ~3 Mo que recommandent les intégrateurs — à re-mesurer sur un vrai iPhone
// avant d'allumer WALLET_POSTER_LAYOUT, quitte à ne garder que le @3x (les
// appareils @2x le redescendent sans perte visible).
const SCALES = [['@2x', 2], ['@3x', 3]] as const;

const FETCH_TIMEOUT_MS = 6000;

function isSupabaseStorageUrl(url: string): boolean {
  return url.includes('/storage/v1/object/public/');
}

/** URL de transform Supabase — recadrage `cover` au ratio demandé. */
function transformUrl(url: string, w: number, h: number): string {
  const base = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const [path, query] = base.split('?');
  const params = new URLSearchParams(query || '');
  params.set('width', String(w));
  params.set('height', String(h));
  params.set('resize', 'cover');
  params.set('quality', '82');
  return `${path}?${params.toString()}`;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Recadre au centre au ratio demandé puis redimensionne, et encode en PNG.
 * Le recadrage est un no-op quand le transform Supabase a déjà livré le bon
 * ratio — on garde le chemin pour les affiches hors Storage.
 */
async function toPng(bytes: Uint8Array, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const { Image } = await import('https://deno.land/x/imagescript@1.3.0/mod.ts');
    const img = await Image.decode(bytes);
    const targetRatio = w / h;
    const ratio = img.width / img.height;
    if (Math.abs(ratio - targetRatio) > 0.01) {
      const cropW = ratio > targetRatio ? Math.round(img.height * targetRatio) : img.width;
      const cropH = ratio > targetRatio ? img.height : Math.round(img.width / targetRatio);
      img.crop(
        Math.round((img.width - cropW) / 2),
        Math.round((img.height - cropH) / 2),
        cropW,
        cropH,
      );
    }
    if (img.width !== w) img.resize(w, h);
    // Niveau 3 : ~15 % de plus que le niveau 9 en taille, 3x plus rapide. Le
    // pass est ré-encodé à chaque téléchargement, la latence compte plus que
    // les kilo-octets.
    return await img.encode(3);
  } catch {
    return null;
  }
}

/** Une taille d'image du pass : le fichier `name` et ses variantes @2x/@3x. */
async function renderScales(
  posterUrl: string,
  name: string,
  ptW: number,
  ptH: number,
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const supa = isSupabaseStorageUrl(posterUrl);
  // Une seule source réseau : la plus grande taille utile (@3x), redescendue
  // localement pour @2x et @1x.
  const src = await fetchBytes(supa ? transformUrl(posterUrl, ptW * 3, ptH * 3) : posterUrl);
  if (!src) return out;
  for (const [suffix, scale] of SCALES) {
    const png = await toPng(src, ptW * scale, ptH * scale);
    if (png) out[`${name}${suffix}.png`] = png;
  }
  return out;
}

/**
 * Images d'affiche d'un pass. `poster` = events.poster_url (ou image_url).
 * Renvoie un objet vide si l'affiche manque ou si le décodage échoue.
 *
 * `poster` (l'option) ajoute l'artwork 4:5 du layout iOS 18. La vignette
 * classique part TOUJOURS : les deux layouts vivent dans le même .pkpass, et
 * c'est l'appareil qui choisit lequel il sait rendre.
 */
export async function passArtwork(
  posterUrl: string | null | undefined,
  opts: { poster: boolean },
): Promise<Record<string, Uint8Array>> {
  if (!posterUrl) return {};
  const thumb = await renderScales(posterUrl, 'thumbnail', THUMB_PT, THUMB_PT);
  if (!opts.poster) return thumb;
  const art = await renderScales(posterUrl, 'artwork', ARTWORK_PT.w, ARTWORK_PT.h);
  return { ...thumb, ...art };
}
