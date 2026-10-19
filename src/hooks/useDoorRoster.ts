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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getStoredManifest } from '@/lib/offline/manifest';
import { tableGuestName } from '@/lib/tableGuests';

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
  /** Un ticket par personne d'une table (titulaire n° 0, puis Invité 1, 2…). */
  table_guests?: RawEntry[];
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
  /** Tickets d'une table : la réservation qui les couvre, le numéro, le titulaire. */
  reservation_id?: string | null;
  number?: number | null;
  holder?: string | null;
}

/** « Invité k » dans la langue de l'écran (titulaire = n° 0, sous son nom). */
export type GuestWord = (k: number) => string;

/**
 * Statuts qui ne doivent PAS apparaître à la porte. Le scan les refuserait de
 * toute façon, mais afficher un nom remboursé au videur crée une dispute à
 * l'entrée : il annonce « je vous fais entrer », puis un écran rouge le dément.
 */
const NOT_AT_THE_DOOR = new Set(['cancelled', 'refunded', 'pending']);

function normalize(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function flatten(m: ManifestShape, guestWord: GuestWord): DoorRosterPerson[] {
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
  // Même règle pour une table : chaque personne a son ticket, la réservation
  // entière disparaît de la liste. Le nom commence par le titulaire, pour que
  // « Marie » trouve toute sa table et que l'ordre A→Z la garde groupée.
  const coveredTables = new Set(
    (m.table_guests ?? []).map((e) => e.reservation_id).filter(Boolean) as string[],
  );
  (m.table_guests ?? []).forEach((e) => {
    const holder = (e.holder || '').trim();
    const ticket = { guest_number: e.number ?? 0, full_name: e.name };
    const name = ticket.guest_number > 0 && holder
      ? `${holder} · ${tableGuestName(ticket, holder, guestWord)}`
      : tableGuestName(ticket, holder, guestWord);
    push({ ...e, name }, 'table', [e.zone, e.pack].filter(Boolean).join(' · ') || null);
  });
  (m.tables ?? []).forEach((e) => {
    if (coveredTables.has(e.id)) return;
    push(e, 'table',
      [e.zone, e.pack, e.guests ? `${e.guests} pers.` : null].filter(Boolean).join(' · ') || null);
  });

  return out;
}

export function useDoorRoster(eventId: string | null, guestWord: GuestWord = (k) => `Guest ${k}`) {
  const [people, setPeople] = useState<DoorRosterPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  // Lu par la ref : changer de langue ne relance pas une lecture du manifeste.
  const guestWordRef = useRef(guestWord);
  guestWordRef.current = guestWord;

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!eventId) { setPeople([]); return; }
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_event_scan_manifest', { p_event_id: eventId });
      if (rpcErr) throw rpcErr;
      setPeople(flatten((data ?? {}) as ManifestShape, guestWordRef.current));
      setFromCache(false);
    } catch {
      // Hors ligne (ou RPC refusée) : le manifeste déjà téléchargé fait le job.
      const local = await getStoredManifest(eventId).catch(() => null);
      if (local?.manifest) {
        setPeople(flatten(local.manifest as ManifestShape, guestWordRef.current));
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

  // Plusieurs videurs à la porte : qui est entré par un AUTRE téléphone, et
  // les invités ajoutés entre-temps par un promoteur, doivent apparaître sans
  // qu'on pense à « Actualiser ». Relecture discrète toutes les 45 s tant que
  // l'écran est visible, et au retour au premier plan.
  useEffect(() => {
    if (!eventId) return;
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) load({ silent: true });
    };
    const id = setInterval(tick, 45_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [eventId, load]);

  /**
   * Marque une personne comme entrée dans l'état local, sans attendre un
   * rechargement : à la porte, la ligne doit basculer sous le doigt.
   */
  const markScannedLocally = useCallback((qr: string) => {
    setPeople((prev) => prev.map((p) =>
      p.qr === qr ? { ...p, scanned: true, scannedAt: new Date().toISOString() } : p));
  }, []);

  /**
   * Liste complète, STRICTEMENT alphabétique. C'est la vue par défaut de
   * l'onglet Liste — un videur qui l'ouvre doit VOIR la soirée, pas un champ
   * de recherche vide.
   *
   * L'ordre est purement alphabétique et rien d'autre : c'est lui qui rend
   * l'index A→Z honnête. Faire remonter les non-pointés (tentant) ferait
   * mentir chaque lettre de la colonne dès la première entrée validée, et
   * déplacerait sous le doigt le nom qu'on cherche. Qui est déjà entré se lit
   * à la coche verte, pas à sa position.
   */
  const all = useMemo(
    () => [...people].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name), 'fr')),
    [people],
  );

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

  return { people, all, loading, error, fromCache, stats, search, reload: load, markScannedLocally };
}
