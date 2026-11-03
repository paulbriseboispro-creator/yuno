import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Ce que les règles d'envoi Yuno ont fait d'une campagne (migration
 * 20261127110000) : la partie froide envoyée par vagues de test, et les
 * adresses gardées de côté, par motif. Lu par le rapport de la Billetterie et
 * par celui de la Console CRM.
 */
export interface CampaignSendRules {
  wave_state: 'testing' | 'done' | 'halted' | null;
  wave_released: number | null;
  wave_total: number | null;
  cold: number | null;
  cold_sent: number | null;
  halt_reason: 'bounces' | 'complaints' | 'no_opens' | 'gmail_spam' | 'sender_frozen' | null;
  next_check_at: string | null;
  /** Motif (sans le préfixe « policy: ») → nombre d'adresses. */
  skipped: Record<string, number>;
  gmail_recovery: boolean;
}

/** Les motifs propres à la délivrabilité, dans l'ordre où on les montre. */
export const DELIVERABILITY_SKIPS = ['gmail_cold', 'cold_wave_halted', 'cold_frozen', 'cold_wave_late', 'event_started'] as const;

export function hasSendRulesToShow(r: CampaignSendRules | null): boolean {
  if (!r) return false;
  if (r.wave_state) return true;
  return DELIVERABILITY_SKIPS.some((k) => (r.skipped?.[k] ?? 0) > 0);
}

/** Relit l'état toutes les 30 s tant que la campagne teste encore sa partie froide. */
export function useCampaignSendRules(campaignId: string | null | undefined, enabled = true) {
  const [data, setData] = useState<CampaignSendRules | null>(null);
  useEffect(() => {
    if (!campaignId || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const { data: d, error } = await supabase.rpc('email_campaign_send_rules' as never, { p_campaign_id: campaignId } as never);
      if (cancelled) return;
      if (!error) setData((d as unknown as CampaignSendRules) ?? null);
      if (!error && (d as unknown as CampaignSendRules | null)?.wave_state === 'testing') timer = setTimeout(load, 30_000);
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [campaignId, enabled]);
  return data;
}

/** Ce que l'écran de planification doit savoir de l'envoi réparti du compte. */
export interface SenderSendMode {
  /** Vrai : l'envoi « tout d'un coup » est fermé à ce compte (la règle par défaut). */
  force_spread: boolean;
  burst_allowed: boolean;
  /** En dessous de ce nombre de destinataires, rien n'est imposé. */
  min_audience: number;
  /** Rythme imposé quand le pro n'a rien choisi. */
  per_hour: number;
  /** Rythme maximal d'une répartition choisie. */
  max_per_hour: number;
  cold_frozen_until: string | null;
}

export function useSenderSendMode(venueId: string | null | undefined, organizerUserId: string | null | undefined) {
  const [data, setData] = useState<SenderSendMode | null>(null);
  useEffect(() => {
    if (!venueId && !organizerUserId) return;
    let cancelled = false;
    void supabase.rpc('email_sender_send_mode' as never, { p_venue_id: venueId ?? null, p_organizer_user_id: organizerUserId ?? null } as never)
      .then(({ data: d, error }) => { if (!cancelled && !error) setData(d as unknown as SenderSendMode); });
    return () => { cancelled = true; };
  }, [venueId, organizerUserId]);
  return data;
}

/**
 * Durée réelle de l'envoi, en minutes, telle que le serveur la fera
 * (_email_enforce_spread) : `chosen` = durée choisie par le pro (null = tout
 * d'un coup). Miroir exact : rien imposé sous `min_audience` ni pour un compte
 * autorisé ; sinon 600 / h par défaut, et jamais plus vite que `max_per_hour`.
 */
export function spreadMinutes(mode: SenderSendMode | null, net: number, chosen: number | null): number | null {
  if (!mode || !mode.force_spread || net < mode.min_audience) return chosen;
  const atMax = Math.ceil((net / mode.max_per_hour) * 60);
  if (chosen == null) return Math.ceil((net / mode.per_hour) * 60);
  return Math.max(chosen, atMax);
}
