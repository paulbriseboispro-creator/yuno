// Le pro discute de son e-mail avec son IA (serveur MCP Yuno) pendant que le
// Studio est ouvert. Chaque écriture de l'IA pose email_campaigns.ai_updated_at
// (mcp_write) ; le Studio la guette (retour sur l'onglet, puis toutes les 8 s
// tant que l'onglet est visible), ADOPTE la version de l'IA (⌘Z rend la
// sienne), et sa sauvegarde automatique n'écrit jamais par-dessus une version
// de l'IA qu'il n'a pas encore vue (garde sur ai_updated_at).
// Partagé par le Studio de la Billetterie (StudioShell) et celui du CRM.

import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import type { StudioCampaign } from '@/lib/email';
import type { CampaignRow } from './campaignRow';
import type { StudioState } from './store';

/** true = la base porte une version de l'IA plus récente que celle affichée. */
export function isNewerAiVersion(remote: string | null | undefined, local: string | null | undefined): boolean {
  if (!remote) return false;
  if (!local) return true;
  if (remote === local) return false;
  const r = Date.parse(remote);
  const l = Date.parse(local);
  return Number.isFinite(r) && Number.isFinite(l) ? r >= l : true;
}

export type AdoptResult = 'adopted' | 'same' | 'gone' | 'error';

/** Relit le brouillon et adopte la version de l'IA si elle est plus récente. */
export async function adoptAiVersion(
  store: StoreApi<StudioState>,
  fromRow: (row: CampaignRow) => StudioCampaign,
): Promise<AdoptResult> {
  const id = store.getState().campaign.id;
  const { data, error } = await supabase.from('email_campaigns').select('*').eq('id', id).maybeSingle();
  if (error) return 'error';
  if (!data) return 'gone';
  const row = data as unknown as CampaignRow;
  if (row.status !== 'draft' && row.status !== 'scheduled') return 'gone';
  if (!isNewerAiVersion(row.ai_updated_at, store.getState().campaign.aiUpdatedAt)) return 'same';
  store.getState().adoptExternal(fromRow(row));
  return 'adopted';
}

const POLL_MS = 8_000;

/**
 * Guette les modifications de l'IA sur le brouillon ouvert. Une lecture
 * légère (ai_updated_at) ; la ligne entière seulement quand elle a bougé.
 */
export function useAiDraftSync(
  store: StoreApi<StudioState> | null,
  opts: { enabled: boolean; fromRow: (row: CampaignRow) => StudioCampaign; onAdopted: (ai: string) => void },
): void {
  const fromRow = useRef(opts.fromRow);
  const onAdopted = useRef(opts.onAdopted);
  fromRow.current = opts.fromRow;
  onAdopted.current = opts.onAdopted;

  useEffect(() => {
    if (!store || !opts.enabled) return undefined;
    let busy = false;
    let stopped = false;
    const check = async () => {
      if (busy || stopped || document.visibilityState !== 'visible') return;
      const st = store.getState();
      if (st.campaign.status !== 'draft' || st.step === 'sending') return;
      busy = true;
      try {
        const { data } = await supabase.from('email_campaigns').select('ai_updated_at').eq('id', st.campaign.id).maybeSingle();
        const remote = (data as { ai_updated_at?: string | null } | null)?.ai_updated_at;
        if (stopped || !isNewerAiVersion(remote, store.getState().campaign.aiUpdatedAt)) return;
        const r = await adoptAiVersion(store, fromRow.current);
        if (!stopped && r === 'adopted') onAdopted.current(store.getState().campaign.aiAuthor || 'IA');
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => { void check(); }, POLL_MS);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [store, opts.enabled]);
}
