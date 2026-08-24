// Liste de porte consultable — tous les noms de la soirée, cherchables par le
// videur, avec leur QR.
//
// Pourquoi ce hook existe : le scanner ne sert à rien quand le téléphone du
// client est mort, quand l'invité n'a jamais ouvert son mail, ou quand la
// personne à l'entrée est sur la liste d'un promoteur qui l'a ajoutée cinq
// minutes plus tôt. Il faut alors chercher un nom et faire entrer la personne
// à la main. Sans ça, la porte se bloque et quelqu'un sort une feuille A4.
//
// Choix d'architecture : on ne réimplémente RIEN. La recherche renvoie le QR de
// la personne trouvée, et l'appelant le passe au pipeline de scan existant —
// mêmes règles de validation (deadline, doublon, mauvais club), même écriture,
// même conversion promoteur, même file offline. Taper sur un nom EST un scan.
//
// Source : la RPC `get_event_scan_manifest` (une seule requête autorisée pour le
// staff de porte et les owners des deux clubs d'une co-soirée). Hors ligne, on
// retombe sur le manifeste déjà stocké en IndexedDB par le scan offline.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getStoredManifest } from '@/lib/offline/manifest';

export type DoorRosterKind = 'guest_list' | 'ticket' | 'table';

export interface DoorRosterPerson {
  id: string;
  qr: string;
  name: string;
  kind: DoorRosterKind;
  status: string | null;
  scanned: boolean;
  scannedAt: string | null;
  /** Complément affiché sous le nom : tarif, zone/table, type d'entrée. */
  detail: string | null;
}

interface ManifestShape {
  attendees?: RawEntry[];
  tickets?: RawEntry[];
  guest_list?: RawEntry[];
  tables?: RawEntry[];
}

interface RawEntry {
  id: string;
  qr: string;
  name: string | null;
  status?: string | null;
  scanned?: boolean;
  scanned_at?: string | null;
  round?: string | null;
  entry_type?: string | null;
  zone?: string | null;
  pack?: string | null;
  guests?: number | null;
  /** Présent sur les porteurs nominatifs : le billet parent qui les couvre. */
  ticket_id?: string | null;
}

/**
 * Statuts qui ne doivent PAS apparaître à la porte. Le scan les refuserait de
 * toute façon, mais afficher un nom remboursé au videur crée une dispute à
 * l'entrée : il annonce « je vous fais entrer », puis un écran rouge le dément.
 */
const NOT_AT_THE_DOOR = new Set(['cancelled', 'refunded', 'pending']);

function normalize(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function flatten(m: ManifestShape): DoorRosterPerson[] {
  const out: DoorRosterPerson[] = [];
  const seen = new Set<string>();

  const push = (e: RawEntry, kind: DoorRosterKind, detail: string | null) => {
    if (!e?.qr || seen.has(e.qr)) return;
    if (e.status && NOT_AT_THE_DOOR.has(e.status)) return;
    seen.add(e.qr);
    out.push({
      id: e.id,
      qr: e.qr,
      name: (e.name || '').trim() || '—',
      kind,
      status: e.status ?? null,
      scanned: !!e.scanned,
      scannedAt: e.scanned_at ?? null,
      detail,
    });
  };

  // Les porteurs nominatifs priment sur le billet parent — et la déduplication
  // ne peut PAS se faire sur le QR : un billet 4 places porte `TK-<uuid>` et
  // chacun de ses porteurs `TK-<uuid>-<n>`, donc des QR tous différents. Sans
  // ce filtre par ticket_id, la commande apparaissait 5 fois, et taper sur la
  // ligne « parent » scannait le billet global : les 4 porteurs nommés
  // restaient non pointés et continuaient d'apparaître comme attendus.
  const coveredTickets = new Set(
    (m.attendees ?? []).map((e) => e.ticket_id).filter(Boolean) as string[],
  );
  (m.attendees ?? []).forEach((e) => push(e, 'ticket', e.round ?? null));
  (m.tickets ?? []).forEach((e) => {
    if (coveredTickets.has(e.id)) return;
    push(e, 'ticket', e.round ?? null);
  });
  (m.guest_list ?? []).forEach((e) => push(e, 'guest_list', e.entry_type ?? null));
  (m.tables ?? []).forEach((e) => push(e, 'table',
    [e.zone, e.pack, e.guests ? `${e.guests} pers.` : null].filter(Boolean).join(' · ') || null));

  return out;
}

export function useDoorRoster(eventId: string | null) {
  const [people, setPeople] = useState<DoorRosterPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) { setPeople([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_event_scan_manifest', { p_event_id: eventId });
      if (rpcErr) throw rpcErr;
      setPeople(flatten((data ?? {}) as ManifestShape));
      setFromCache(false);
    } catch {
      // Hors ligne (ou RPC refusée) : le manifeste déjà téléchargé fait le job.
      const local = await getStoredManifest(eventId).catch(() => null);
      if (local?.manifest) {
        setPeople(flatten(local.manifest as ManifestShape));
        setFromCache(true);
      } else {
        setPeople([]);
        setError('unavailable');
      }
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Marque une personne comme entrée dans l'état local, sans attendre un
   * rechargement : à la porte, la ligne doit basculer sous le doigt.
   */
  const markScannedLocally = useCallback((qr: string) => {
    setPeople((prev) => prev.map((p) =>
      p.qr === qr ? { ...p, scanned: true, scannedAt: new Date().toISOString() } : p));
  }, []);

  const search = useCallback((query: string, limit = 40): DoorRosterPerson[] => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    // Tous les mots doivent matcher : « kev du » trouve « Kevin Dupont »
    // sans remonter tous les Kevin de la soirée.
    const hits = people.filter((p) => {
      const n = normalize(p.name);
      return terms.every((term) => n.includes(term));
    });
    hits.sort((a, b) => {
      // Ceux qui ne sont pas encore entrés d'abord : c'est eux qu'on cherche.
      if (a.scanned !== b.scanned) return a.scanned ? 1 : -1;
      const an = normalize(a.name);
      const bn = normalize(b.name);
      const aStarts = an.startsWith(terms[0]);
      const bStarts = bn.startsWith(terms[0]);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return an.localeCompare(bn, 'fr');
    });
    return hits.slice(0, limit);
  }, [people]);

  const stats = useMemo(() => ({
    total: people.length,
    scanned: people.filter((p) => p.scanned).length,
  }), [people]);

  return { people, loading, error, fromCache, stats, search, reload: load, markScannedLocally };
}
