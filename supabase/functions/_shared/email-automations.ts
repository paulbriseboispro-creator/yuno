// Automatisations email (recettes) + renvoi aux non-ouvreurs — le pendant
// « moteur » de la relance après clic (campaign-followups.ts).
//
// Tout le ciblage vit en SQL :
//   · collect_email_automations() — une ligne de registre par (recette,
//     déclencheur, email) avec sa raison d'exclusion, puis une campagne ENFANT
//     par (recette, soirée) remplie contact par contact ;
//   · collect_campaign_resends()  — N h après la fin d'une campagne, un enfant
//     « Renvoi » aux destinataires qui n'ont pas ouvert.
// Ce module appelle les deux depuis le cron et journalise. L'envoi passe par
// le balayage sweepSendingCampaigns qui suit, comme n'importe quel envoi.

export interface AutomationRun {
  automations: number;
  queued: number;
  skipped: number;
  enqueued: number;
  children: string[];
  error?: string;
}

export interface ResendRun {
  parents: number;
  enqueued: number;
  children: string[];
  error?: string;
}

// deno-lint-ignore no-explicit-any
export async function dispatchEmailAutomations(admin: any): Promise<AutomationRun> {
  const { data, error } = await admin.rpc('collect_email_automations');
  if (error) {
    console.error('collect_email_automations error:', error.message);
    return { automations: 0, queued: 0, skipped: 0, enqueued: 0, children: [], error: error.message };
  }
  const run = (data || {}) as Partial<AutomationRun>;
  const out: AutomationRun = {
    automations: Number(run.automations || 0), queued: Number(run.queued || 0),
    skipped: Number(run.skipped || 0), enqueued: Number(run.enqueued || 0),
    children: Array.isArray(run.children) ? run.children : [],
  };
  if (out.enqueued > 0) console.log(`automations: ${out.enqueued} email(s) en file sur ${out.children.length} campagne(s) enfant(s)`);
  return out;
}

// deno-lint-ignore no-explicit-any
export async function dispatchCampaignResends(admin: any): Promise<ResendRun> {
  const { data, error } = await admin.rpc('collect_campaign_resends');
  if (error) {
    console.error('collect_campaign_resends error:', error.message);
    return { parents: 0, enqueued: 0, children: [], error: error.message };
  }
  const run = (data || {}) as Partial<ResendRun>;
  const out: ResendRun = {
    parents: Number(run.parents || 0), enqueued: Number(run.enqueued || 0),
    children: Array.isArray(run.children) ? run.children : [],
  };
  if (out.enqueued > 0) console.log(`resends: ${out.enqueued} renvoi(s) en file sur ${out.children.length} campagne(s)`);
  return out;
}
