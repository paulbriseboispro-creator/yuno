// Filet de sécurité de l'envoi de masse.
//
// L'auto-chaînage de `send-campaign` couvre le cas normal : une tranche finie
// lance la suivante. Mais une edge function peut mourir (redéploiement,
// OOM, coupure réseau au moment du chaînage) et laisser une campagne à
// mi-course, avec des destinataires réservés que plus personne ne traite.
//
// Ce balayage, appelé par le cron `process-scheduled-campaigns`, garantit
// qu'une campagne finit TOUJOURS par se terminer :
//   1. il libère les réservations mortes (worker interrompu) ;
//   2. il relance une tranche sur chaque campagne encore en vol.
//
// Il relance aussi les campagnes stoppées par le plafond journalier : le
// quota se remet à zéro à minuit, la campagne reprend d'elle-même le
// lendemain. C'est exactement le comportement voulu pour un warm-up.

const STALE_CLAIM_MINUTES = 10;
const MAX_CAMPAIGNS_PER_RUN = 10;

interface SweepResult {
  requeued: number;
  resumed: string[];
  errors: string[];
}

// deno-lint-ignore no-explicit-any
export async function sweepSendingCampaigns(admin: any, supabaseUrl: string, serviceKey: string): Promise<SweepResult> {
  const out: SweepResult = { requeued: 0, resumed: [], errors: [] };

  // 1. Réservations mortes → retour en file.
  try {
    const { data } = await admin.rpc('requeue_stale_campaign_claims', {
      p_stale_minutes: STALE_CLAIM_MINUTES,
      p_max_attempts: 3,
    });
    out.requeued = Number(data || 0);
  } catch (e) {
    out.errors.push(`requeue: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Campagnes encore en vol. On prend d'abord celles qu'on n'a pas touchées
  //    depuis le plus longtemps : une campagne qui avance toute seule par
  //    auto-chaînage n'a pas besoin qu'on la double.
  const { data: campaigns, error } = await admin
    .from('email_campaigns')
    .select('id, last_slice_at')
    .eq('status', 'sending')
    .order('last_slice_at', { ascending: true, nullsFirst: true })
    .limit(MAX_CAMPAIGNS_PER_RUN);

  if (error) {
    out.errors.push(`select: ${error.message}`);
    return out;
  }

  for (const c of campaigns || []) {
    // Une tranche fraîche (< 2 min) signifie qu'un worker est probablement
    // encore dessus. Le SKIP LOCKED empêcherait le doublon de toute façon,
    // mais inutile de brûler une invocation.
    const last = c.last_slice_at ? new Date(c.last_slice_at).getTime() : 0;
    if (last && Date.now() - last < 120_000) continue;

    // Reste-t-il vraiment du travail ?
    const { count } = await admin
      .from('email_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', ['pending', 'sending']);
    if (!count) {
      // File vide mais statut 'sending' : la clôture a été manquée (worker tué
      // juste avant). On la finalise ici plutôt que de laisser la campagne
      // afficher « envoi en cours » pour toujours.
      const { data: totals } = await admin
        .from('email_campaigns').select('recipients_count').eq('id', c.id).single();
      await admin.from('email_campaigns').update({
        status: Number(totals?.recipients_count || 0) > 0 ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
      }).eq('id', c.id).eq('status', 'sending');
      continue;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-campaign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ campaign_id: c.id, mode: 'drain' }),
      });
      if (res.ok) out.resumed.push(c.id);
      else out.errors.push(`drain ${c.id}: HTTP ${res.status}`);
    } catch (e) {
      out.errors.push(`drain ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return out;
}
