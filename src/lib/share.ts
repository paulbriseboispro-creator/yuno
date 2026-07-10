import { isNative } from '@/lib/native';

/**
 * Partage unifié — feuille de partage NATIVE iOS via @capacitor/share dans
 * l'app (WKWebView n'expose pas navigator.share), Web Share API sur le web,
 * copie presse-papier en dernier recours.
 */

export interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
  /** Images (cartes de partage) — partagées en fichier quand la plateforme le permet. */
  files?: File[];
}

export type ShareOutcome = 'shared' | 'copied' | 'dismissed';

function isUserCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg) || (err as DOMException)?.name === 'AbortError';
}

async function blobToBase64(file: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return dataUrl.split(',')[1] || '';
}

/**
 * Ouvre la feuille de partage. Retourne :
 *  - 'shared'    : la feuille s'est ouverte (partage effectué ou non, iOS ne le dit pas toujours)
 *  - 'copied'    : pas de partage possible → lien copié dans le presse-papier
 *  - 'dismissed' : l'utilisateur a annulé — ne pas afficher de toast d'erreur
 */
export async function shareContent(payload: SharePayload): Promise<ShareOutcome> {
  const { title, text, url, files } = payload;

  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      if (files?.length) {
        try {
          const { Filesystem, Directory } = await import('@capacitor/filesystem');
          const fileUris: string[] = [];
          for (const [i, file] of files.entries()) {
            const written = await Filesystem.writeFile({
              path: `yuno-share-${Date.now()}-${i}-${file.name || 'image.png'}`,
              data: await blobToBase64(file),
              directory: Directory.Cache,
            });
            fileUris.push(written.uri);
          }
          await Share.share({ title, text, files: fileUris });
          return 'shared';
        } catch (err) {
          if (isUserCancel(err)) return 'dismissed';
          // Écriture/partage fichier impossible → retombe sur texte + lien.
        }
      }
      await Share.share({ title, text, url, dialogTitle: title });
      return 'shared';
    } catch (err) {
      if (isUserCancel(err)) return 'dismissed';
      // Plugin indisponible (vieux binaire sans le pod) → fallback web.
    }
  }

  try {
    if (navigator.share) {
      if (files?.length && navigator.canShare?.({ files })) {
        await navigator.share({ title, text, files });
      } else {
        await navigator.share({ title, text, url });
      }
      return 'shared';
    }
  } catch (err) {
    if (isUserCancel(err)) return 'dismissed';
    // Web Share refusé (permission, contexte) → copie.
  }

  await navigator.clipboard.writeText(url || text || '');
  return 'copied';
}
