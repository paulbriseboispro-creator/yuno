// Relances ciblées après clic — le pendant « email » des automations client.
//
// Tout le ciblage vit dans la RPC collect_campaign_followups (registre
// email_campaign_followups : une relance par personne et par soirée, raisons
// d'exclusion écrites, évaluées au moment où la relance est due). Ce module ne
// fait que l'appeler depuis le cron et journaliser ; l'envoi lui-même passe
// par la campagne enfant que le balayage sweepSendingCampaigns relance juste
// après, comme n'importe quel envoi en vol.

export interface FollowupRun {
  parents: number;
  queued: number;
  skipped: number;
  enqueued: number;
  children: string[];
  error?: string;
}

// deno-lint-ignore no-explicit-any
export async function dispatchCampaignFollowups(admin: any): Promise<FollowupRun> {
  const { data, error } = await admin.rpc('collect_campaign_followups');
  if (error) {
    console.error('collect_campaign_followups error:', error.message);
    return { parents: 0, queued: 0, skipped: 0, enqueued: 0, children: [], error: error.message };
  }
  const run = (data || {}) as Partial<FollowupRun>;
  const out: FollowupRun = {
    parents: Number(run.parents || 0), queued: Number(run.queued || 0),
    skipped: Number(run.skipped || 0), enqueued: Number(run.enqueued || 0),
    children: Array.isArray(run.children) ? run.children : [],
  };
  if (out.enqueued > 0) console.log(`followups: ${out.enqueued} relance(s) en file sur ${out.children.length} campagne(s) enfant(s)`);
  return out;
}
