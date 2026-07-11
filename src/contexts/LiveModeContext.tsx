// Mode Live — le client scanné à l'entrée d'une soirée voit son app basculer
// en takeover plein écran sur le menu du club (/live) pour la durée de
// l'événement.
//
// Détection à trois étages (le push n'est jamais requis) :
//   1. RPC `get_live_session()` (SECURITY DEFINER) au mount, au retour
//      foreground et toutes les 5 min — la vérité vient toujours du serveur.
//   2. Realtime : si le client possède une entrée (billet / résa table /
//      guest list) pour un événement dont la fenêtre est ouverte, on écoute
//      les UPDATE de SES lignes ; chaque payload déclenche un re-appel du RPC
//      (on ne fait jamais confiance au payload lui-même). Les canaux restent
//      ouverts pendant le live : un refund/staff-cancel fait retomber le RPC
//      sur « rien » → sortie douce.
//   3. Push de bienvenue (trigger DB → send-push-notification) avec deep-link
//      /live — simple accélérateur.
//
// Takeover : `LiveModeRedirect` (monté par le provider, sous le Router)
// redirige vers /live UNIQUEMENT depuis les surfaces de flânerie (onglets de
// la BottomNav, home d'un club, page événement). Jamais depuis un tunnel
// transactionnel (/cart, /order, checkout tables/billets…) ni une surface
// staff/pro. Sortie manuelle : flag sessionStorage par événement — plus de
// redirect pour CETTE session d'app ; chaque réouverture de l'app pendant la
// soirée ré-atterrit sur le Live (décision produit).
//
// Limite acceptée : les invités guest-list sans compte (user_id null) n'ont
// pas de Mode Live — realtime et push exigent un utilisateur connecté.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { LiveModeBanner } from '@/components/livemode/LiveModeBanner';
import { isDemoEmail } from '@/lib/demoPlan';
import { isDemoLiveForced, DEMO_LIVE_EVENT } from '@/lib/demoLive';
import { celebrateOnce } from '@/lib/celebrate';

export interface LiveSession {
  state: 'live' | 'pending_scan';
  source: 'table' | 'ticket' | 'guest_list';
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  venueId: string;
  venueName: string;
  entryScannedAt: string | null;
  tableReservationId: string | null;
  menuEnabled: boolean;
  liveModeEnabled: boolean;
  soloBottleSaleEnabled: boolean;
  clientRank: number | null;
  clientTier: 'platinum' | 'gold' | 'silver' | 'bronze' | null;
}

interface LiveModeValue {
  /** Session courante (live ou pending_scan), null si rien ce soir. */
  session: LiveSession | null;
  /** Vrai quand le client est scanné dans une soirée en cours. */
  isLive: boolean;
  /** Vrai quand le client a quitté manuellement le takeover (cette session d'app). */
  exited: boolean;
  /** Chargement initial du RPC (évite un flash de redirect). */
  loading: boolean;
  exitLive: () => void;
  enterLive: () => void;
  refresh: () => Promise<void>;
}

const NOOP_VALUE: LiveModeValue = {
  session: null,
  isLive: false,
  exited: false,
  loading: false,
  exitLive: () => {},
  enterLive: () => {},
  refresh: async () => {},
};

const LiveModeContext = createContext<LiveModeValue>(NOOP_VALUE);

/** Sûr sans provider (retourne un état inerte) — permet aux composants
 *  partagés (BottomNav…) de consommer le contexte avant son montage. */
export function useLiveMode(): LiveModeValue {
  return useContext(LiveModeContext);
}

const EXIT_FLAG_PREFIX = 'yuno_live_exited:';
const POLL_MS = 5 * 60 * 1000;
/** Marge après end_at — miroir du token de retrait bar et des crédits conso. */
export const LIVE_GRACE_MS = 2 * 60 * 60 * 1000;

function readExitFlag(eventId: string | undefined): boolean {
  if (!eventId) return false;
  try {
    return sessionStorage.getItem(EXIT_FLAG_PREFIX + eventId) === '1';
  } catch {
    return false;
  }
}

interface LiveSessionRow {
  state: string;
  source: string;
  event_id: string;
  event_title: string;
  event_start_at: string;
  event_end_at: string;
  venue_id: string;
  venue_name: string;
  entry_scanned_at: string | null;
  table_reservation_id: string | null;
  menu_enabled: boolean;
  live_mode_enabled: boolean;
  solo_bottle_sale_enabled: boolean;
  client_rank: number | null;
  client_tier: LiveSession['clientTier'];
}

function mapRow(row: LiveSessionRow): LiveSession {
  return {
    state: row.state as LiveSession['state'],
    source: row.source as LiveSession['source'],
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventStartAt: row.event_start_at,
    eventEndAt: row.event_end_at,
    venueId: row.venue_id,
    venueName: row.venue_name,
    entryScannedAt: row.entry_scanned_at,
    tableReservationId: row.table_reservation_id,
    menuEnabled: row.menu_enabled,
    liveModeEnabled: row.live_mode_enabled,
    soloBottleSaleEnabled: row.solo_bottle_sale_enabled,
    clientRank: row.client_rank,
    clientTier: row.client_tier,
  };
}

// Surfaces de flânerie depuis lesquelles le takeover redirige vers /live.
// Volontairement une ALLOWLIST étroite : tout le reste (tunnels de paiement,
// pages staff/pro, auth, QR de commande…) ne doit jamais être interrompu.
function isTakeoverSurface(pathname: string): boolean {
  if (
    pathname === '/' ||
    pathname === '/favorites' ||
    pathname === '/my-orders' ||
    pathname === '/profile' ||
    pathname === '/map'
  ) {
    return true;
  }
  // Home d'un club (pas ses sous-pages menu/commande) et page événement
  // (pas ses tunnels billets/table/guestlist).
  if (/^\/club\/[^/]+$/.test(pathname)) return true;
  if (/^\/events\/[^/]+\/[^/]+$/.test(pathname)) return true;
  return false;
}

function LiveModeRedirect({ value }: { value: LiveModeValue }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (value.loading || !value.isLive || value.exited) return;
    if (location.pathname === '/live') return;
    if (isTakeoverSurface(location.pathname)) {
      navigate('/live', { replace: true });
    }
  }, [value.loading, value.isLive, value.exited, location.pathname, navigate]);

  return null;
}

export function LiveModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [exited, setExited] = useState(false);
  const sessionRef = useRef<LiveSession | null>(null);
  sessionRef.current = session;

  const refresh = useCallback(async () => {
    if (!user) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      // Mode Live forcé pour la démo (DemoSwitcher, comptes @womber.fr) :
      // session fabriquée sur le club démo, sans scan. Le RPC lui-même
      // rejette les non-démos (SECURITY DEFINER + gate email).
      const demoForced = isDemoEmail(user.email) && isDemoLiveForced();
      const { data, error } = await (supabase.rpc as (fn: string) => ReturnType<typeof supabase.rpc>)(
        demoForced ? 'demo_live_session' : 'get_live_session'
      );
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as LiveSessionRow | undefined;
      const next = row ? mapRow(row) : null;
      setSession(next);
      setExited(readExitFlag(next?.state === 'live' ? next.eventId : undefined));
    } catch {
      // RPC absent (migration pas encore poussée) ou réseau club pourri :
      // on garde l'état courant, le prochain poll réessaiera.
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Check à l'ouverture + retour foreground + poll de sécurité.
  // Le switch Explore ↔ Live du DemoSwitcher notifie via DEMO_LIVE_EVENT.
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onDemoLiveChange = () => refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(DEMO_LIVE_EVENT, onDemoLiveChange);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(DEMO_LIVE_EVENT, onDemoLiveChange);
      clearInterval(interval);
    };
  }, [refresh]);

  // Realtime : UPDATE de MES lignes scannables → re-appel du RPC.
  // Actif dès qu'une session existe (pending_scan : détecter le scan en
  // direct ; live : détecter refund/staff-cancel → sortie douce).
  useEffect(() => {
    if (!user || !session) return;
    const uid = user.id;
    const channels = [
      supabase
        .channel(`live-scan-tickets-${uid}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `user_id=eq.${uid}` },
          () => refresh()
        )
        .subscribe(),
      supabase
        .channel(`live-scan-tables-${uid}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'table_reservations', filter: `user_id=eq.${uid}` },
          () => refresh()
        )
        .subscribe(),
      supabase
        .channel(`live-scan-gl-${uid}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'guest_list_entries', filter: `user_id=eq.${uid}` },
          () => refresh()
        )
        .subscribe(),
    ];
    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [user, session?.eventId, session?.state, refresh]);

  // Célébration d'entrée — LE moment signature de la soirée. Se joue quand
  // la session passe « scannée » (state 'live'), que la transition ait été
  // observée en direct (realtime pendant pending_scan) ou que l'app soit
  // ouverte APRÈS le scan (push de bienvenue → cold start). celebrateOnce
  // garantit 1×/événement (flag localStorage), soirée entière comprise.
  useEffect(() => {
    if (session?.state !== 'live') return;
    celebrateOnce(`entry:${session.eventId}`, 'entry', { subtitle: session.venueName });
  }, [session?.state, session?.eventId, session?.venueName]);

  // Fin de soirée : timer absolu sur end_at + 2h → le RPC retombera sur rien.
  useEffect(() => {
    if (session?.state !== 'live') return;
    const deadline = new Date(session.eventEndAt).getTime() + LIVE_GRACE_MS - Date.now();
    if (deadline <= 0) return;
    const timer = setTimeout(() => refresh(), Math.min(deadline + 1000, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [session?.state, session?.eventEndAt, refresh]);

  const exitLive = useCallback(() => {
    const current = sessionRef.current;
    if (current?.state === 'live') {
      try {
        sessionStorage.setItem(EXIT_FLAG_PREFIX + current.eventId, '1');
      } catch {
        // storage indispo : la sortie ne vaudra que pour ce rendu
      }
    }
    setExited(true);
  }, []);

  const enterLive = useCallback(() => {
    const current = sessionRef.current;
    if (current?.state === 'live') {
      try {
        sessionStorage.removeItem(EXIT_FLAG_PREFIX + current.eventId);
      } catch {
        // ignore
      }
    }
    setExited(false);
  }, []);

  const value = useMemo<LiveModeValue>(
    () => ({
      session,
      isLive: session?.state === 'live' && session.liveModeEnabled,
      exited,
      loading,
      exitLive,
      enterLive,
      refresh,
    }),
    [session, exited, loading, exitLive, enterLive, refresh]
  );

  return (
    <LiveModeContext.Provider value={value}>
      <LiveModeRedirect value={value} />
      {children}
      <LiveModeBanner />
    </LiveModeContext.Provider>
  );
}
