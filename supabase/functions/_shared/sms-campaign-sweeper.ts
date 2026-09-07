// Filet de sécurité des envois SMS de masse — même rôle que
// campaign-drain-sweeper.ts pour l'email.
//
// L'auto-chaînage de `send-sms-campaign` couvre le cas normal : une tranche
// finie lance la suivante. Mais une edge function peut mourir (redéploiement,
// coupure réseau au moment du chaînage) et laisser une campagne à mi-course,
// avec des numéros réservés que plus personne ne traite. Ce balayage, appelé
// par le cron `process-scheduled-campaigns` toutes les 5 minutes :
//   1. libère les réservations mortes (worker interrompu) ;
//   2. relance une tranche sur chaque campagne encore en vol ;
//   3. clôture une campagne dont la file est vide mais le statut resté
//      « sending » (worker tué juste avant la clôture).
// Il relance aussi les campagnes arrêtées par les heures calmes : le créneau
// rouvre, la campagne repart d'elle-même.

const STALE_CLAIM_MINUTES = 10;
const MAX_CAMPAIGNS_PER_RUN = 10;

interface SweepResult {
  requeued: number;
  resumed: string[];
  closed: string[];
  errors: string[];
}

// deno-lint-ignore no-explicit-any
export async function sweepSendingSmsCampaigns(admin: any, supabaseUrl: string, serviceKey: string): Promise<SweepResult> {
  const out: SweepResult = { requeued: 0, resumed: [], closed: [], errors: [] };

  try {
    const { data } = await admin.rpc('requeue_stale_sms_claims', {
      p_stale_minutes: STALE_CLAIM_MINUTES,
      p_max_attempts: 3,
    });
    out.requeued = Number(data || 0);
  } catch (e) {
    out.errors.push(`requeue: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { data: campaigns, error } = await admin
    .from('sms_campaigns')
    .select('id, last_slice_at, send_started_at')
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
    const last = new Date(c.last_slice_at || c.send_started_at || 0).getTime();
    if (last && Date.now() - last < 120_000) continue;

    const { count } = await admin
      .from('sms_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', ['pending', 'sending']);

    if (!count) {
      const { data: totals } = await admin
        .from('sms_campaigns').select('sent_count').eq('id', c.id).single();
      await admin.from('sms_campaigns').update({
        status: Number(totals?.sent_count || 0) > 0 ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        error_message: Number(totals?.sent_count || 0) > 0 ? null : "Aucun envoi n'a abouti",
      }).eq('id', c.id).eq('status', 'sending');
      out.closed.push(c.id);
      continue;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-sms-campaign`, {
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
