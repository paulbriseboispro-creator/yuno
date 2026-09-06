// Coffre de session — la session Supabase ne doit JAMAIS se perdre dans l'app.
//
// Dans la WebView Capacitor, auth-js range la session dans `localStorage`, qui
// appartient au moteur WebKit : il peut être purgé sous pression disque, et il
// ne survit pas à certaines réinstallations. Résultat vécu : un client
// « déconnecté » après une mise à jour, donc plus de token push rattaché à son
// compte, donc plus aucune notification.
//
// Ici, `localStorage` reste la lecture rapide (synchrone), mais chaque écriture
// est MIROIRÉE dans un fichier du conteneur de l'app (Library/, hors iCloud
// Files, conservé à travers les mises à jour) via @capacitor/filesystem, déjà
// embarqué dans le binaire — aucun nouveau plugin natif, l'OTA suffit. Au
// démarrage, si le WebView a perdu la session mais que le fichier l'a encore,
// on la restaure AVANT que auth-js ne conclue « déconnecté ».
//
// Sur le web (et l'app Pro hors natif), c'est un simple passe-plat localStorage.
import type { SupportedStorage } from '@supabase/supabase-js';
import { isNative } from '@/lib/native';

const VAULT_FILE = 'yuno-session-vault.json';

type Vault = Record<string, string>;

let vaultCache: Vault | null = null;
let vaultLoad: Promise<Vault> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function fs() {
  const mod = await import('@capacitor/filesystem');
  return { Filesystem: mod.Filesystem, Directory: mod.Directory, Encoding: mod.Encoding };
}

async function loadVault(): Promise<Vault> {
  if (vaultCache) return vaultCache;
  if (!vaultLoad) {
    vaultLoad = (async () => {
      try {
        const { Filesystem, Directory, Encoding } = await fs();
        const res = await Filesystem.readFile({ path: VAULT_FILE, directory: Directory.Library, encoding: Encoding.UTF8 });
        const raw = typeof res.data === 'string' ? res.data : '';
        const parsed = raw ? (JSON.parse(raw) as Vault) : {};
        vaultCache = parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        // Fichier absent (première ouverture) ou illisible : coffre vide.
        vaultCache = {};
      }
      return vaultCache;
    })();
  }
  return vaultLoad;
}

function persistVault(): void {
  // Écritures sérialisées : deux setItem rapprochés ne doivent pas se croiser.
  writeChain = writeChain
    .then(async () => {
      const { Filesystem, Directory, Encoding } = await fs();
      await Filesystem.writeFile({
        path: VAULT_FILE,
        directory: Directory.Library,
        encoding: Encoding.UTF8,
        data: JSON.stringify(vaultCache ?? {}),
        recursive: true,
      });
    })
    .catch(() => {
      // Best-effort : un miroir qui échoue ne doit jamais casser la session
      // vivante en localStorage.
    });
}

async function vaultSet(key: string, value: string | null): Promise<void> {
  const vault = await loadVault();
  if (value === null) delete vault[key];
  else vault[key] = value;
  persistVault();
}

/**
 * Restaure depuis le coffre une clé absente de localStorage. Appelé par auth-js
 * via `getItem` : le retour est une promesse, auth-js sait l'attendre.
 */
async function restore(key: string): Promise<string | null> {
  const vault = await loadVault();
  const value = vault[key];
  if (typeof value !== 'string') return null;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage indisponible : la valeur sert quand même pour cet appel */
  }
  return value;
}

/** Stockage auth : localStorage en lecture rapide + coffre natif en miroir. */
export const sessionVaultStorage: SupportedStorage = {
  getItem(key: string) {
    let local: string | null = null;
    try {
      local = localStorage.getItem(key);
    } catch {
      local = null;
    }
    if (local !== null) {
      // On profite du passage pour garder le coffre à jour (session restaurée
      // par une voie qui n'est pas passée par setItem, ancien bundle…).
      if (isNative()) void loadVault().then((v) => { if (v[key] !== local) void vaultSet(key, local); });
      return local;
    }
    if (!isNative()) return null;
    return restore(key);
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota / privé : le coffre prend le relais */
    }
    if (isNative()) void vaultSet(key, value);
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    if (isNative()) void vaultSet(key, null);
  },
};

type StoredSession = { user?: { id?: string } | null; access_token?: string; refresh_token?: string } & Record<string, unknown>;

/**
 * Lecture SYNCHRONE de la session telle qu'auth-js l'a rangée
 * (`sb-<ref>-auth-token`). Sert au filet de démarrage de useAuth : quand le
 * réseau traîne, on préfère montrer le compte connu plutôt qu'un écran
 * « déconnecté » qui renvoie vers la page de connexion.
 */
export function readStoredSessionSync(): StoredSession | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && typeof parsed === 'object' && parsed.user && typeof parsed.user.id === 'string') return parsed;
    }
  } catch {
    /* JSON corrompu ou stockage bloqué : pas de session connue */
  }
  return null;
}
