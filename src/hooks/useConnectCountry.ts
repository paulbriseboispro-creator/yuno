import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  deviceTimezone,
  isSupportedConnectCountry,
  suggestConnectCountry,
  type ConnectCountrySignals,
  type ConnectCountrySource,
} from '@/lib/stripeConnectCountry';

/** Qui ouvre le compte Stripe : le pays se préremplit depuis ce que Yuno sait de lui. */
export type ConnectCountryOwner =
  | { kind: 'venue'; venueId: string | null | undefined }
  | { kind: 'organizer'; userId: string | null | undefined }
  | { kind: 'dj'; userId: string | null | undefined };

export interface ConnectCountryChoice {
  /** Code ISO alpha-2, ou OTHER_CONNECT_COUNTRY. */
  country: string;
  setCountry: (code: string) => void;
  source: ConnectCountrySource;
  /** Le pro a choisi lui-même (la suggestion ne l'écrase plus). */
  touched: boolean;
  /** Les signaux (ville, adresse, fuseau) sont lus : le pays affiché est définitif. */
  ready: boolean;
  /** Le bouton « Activer les paiements » peut créer le compte avec ce pays. */
  canCreate: boolean;
}

async function loadSignals(owner: ConnectCountryOwner): Promise<ConnectCountrySignals> {
  if (owner.kind === 'venue') {
    if (!owner.venueId) return {};
    const { data } = await supabase
      .from('venues')
      .select('city, address, legal_address, timezone')
      .eq('id', owner.venueId)
      .maybeSingle();
    return data ? { city: data.city, addresses: [data.address, data.legal_address], timezone: data.timezone } : {};
  }
  if (owner.kind === 'dj') {
    if (!owner.userId) return {};
    const { data } = await supabase
      .from('djs')
      .select('country, city')
      .eq('user_id', owner.userId)
      .limit(1)
      .maybeSingle();
    return data ? { countryText: data.country, city: data.city } : {};
  }
  if (!owner.userId) return {};
  const [org, lastEvent] = await Promise.all([
    supabase.from('organizer_profiles').select('city').eq('user_id', owner.userId).maybeSingle(),
    supabase
      .from('events')
      .select('timezone, location_city')
      .eq('organizer_user_id', owner.userId)
      .order('start_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    city: org.data?.city || lastEvent.data?.location_city || null,
    timezone: lastEvent.data?.timezone ?? null,
  };
}

/**
 * Pays d'immatriculation choisi avant la création du compte Stripe. Prérempli
 * (profil DJ, ville ou adresse du club, fuseau de la dernière soirée, puis fuseau
 * de l'appareil), jamais imposé : le pro le corrige dans le sélecteur.
 *
 * `enabled` = false tant qu'un compte existe déjà : son pays est figé, rien à lire.
 */
export function useConnectCountry(owner: ConnectCountryOwner, enabled: boolean): ConnectCountryChoice {
  const ownerId = owner.kind === 'venue' ? owner.venueId : owner.userId;
  const [state, setState] = useState(() => {
    const first = suggestConnectCountry({ deviceTimezone: deviceTimezone() });
    return { country: first.code, source: first.source, touched: false, ready: false };
  });
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !ownerId) return;
    let cancelled = false;
    loadSignals(owner)
      .catch(() => ({}) as ConnectCountrySignals)
      .then((signals) => {
        if (cancelled) return;
        const suggestion = suggestConnectCountry({ ...signals, deviceTimezone: deviceTimezone() });
        setState((prev) => touchedRef.current
          ? { ...prev, ready: true }
          : { country: suggestion.code, source: suggestion.source, touched: false, ready: true });
      });
    return () => { cancelled = true; };
    // `owner` est un littéral recréé à chaque rendu : sa clé est (kind, id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, owner.kind, ownerId]);

  const setCountry = useCallback((code: string) => {
    touchedRef.current = true;
    setState((prev) => ({ ...prev, country: code, touched: true }));
  }, []);

  // Sans identifiant (club pas encore chargé), rien à attendre : la suggestion
  // de l'appareil vaut réponse.
  const ready = state.ready || !ownerId;
  return {
    country: state.country,
    setCountry,
    source: state.source,
    touched: state.touched,
    ready,
    canCreate: ready && isSupportedConnectCountry(state.country),
  };
}
