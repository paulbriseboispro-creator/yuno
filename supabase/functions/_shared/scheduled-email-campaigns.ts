// Campagnes e-mail programmées : le passage du cron (process-scheduled-campaigns)
// et la règle que send-campaign applique quand le cron l'appelle.
//
// La course à couvrir (audit du 18/10, MAIL-04) : le pro déprogramme sa
// campagne (retour en brouillon) PENDANT le passage du cron. Trois règles :
//   1. le cron PREND la campagne par une mise à jour conditionnelle
//      (scheduled → sending) et n'appelle l'envoi que s'il l'a prise ;
//   2. send-campaign, appelé par le cron, n'envoie que si elle est toujours
//      « sending » (`not_scheduled_anymore` sinon) ;
//   3. un échec n'écrit « failed » que sur une campagne encore « sending » :
//      jamais par-dessus un brouillon que le pro vient de reprendre.
// Testé par process-scheduled-campaigns/scheduled_test.ts (fausse base).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

/** Réponse de send-campaign quand le cron l'appelle sur une campagne qui n'est plus à lui. */
export const NOT_SCHEDULED_ANYMORE = 'not_scheduled_anymore';

/**
 * send-campaign, appel du cron (`scheduled: true`) : la campagne doit être
 * « sending » (le cron vient de l'y passer). Sinon le pro l'a déprogrammée,
 * mise en pause ou annulée entre-temps : rien ne part.
 */
export function scheduledSendRefusal(scheduled: unknown, status: unknown): string | null {
  return scheduled === true && status !== 'sending' ? NOT_SCHEDULED_ANYMORE : null;
}

/** Appel de send-campaign pour une campagne prise (injecté par les tests). */
export type InvokeSend = (campaignId: string) => Promise<Response>;

/** Le passage du cron sur les campagnes programmées échues. Rend le nombre d'appels à l'envoi. */
export async function dispatchScheduledEmailCampaigns(
  admin: SupabaseClient, invoke: InvokeSend, now: Date = new Date(),
): Promise<number> {
  const { data: campaigns } = await admin
    .from('email_campaigns')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString())
    .limit(20);

  let processed = 0;
  for (const c of (campaigns || []) as Array<{ id: string }>) {
    try {
      // Prise conditionnelle : rien de pris = le pro l'a déprogrammée (ou un
      // autre passage l'a déjà prise) ; on n'appelle pas l'envoi.
      const { data: took } = await admin.from('email_campaigns').update({ status: 'sending' })
        .eq('id', c.id).eq('status', 'scheduled').select('id');
      if (!took?.length) continue;
      const res = await invoke(c.id);
      // 402 : Yunits insuffisants, compte en pause ou identité incomplète
      // (Yuno CRM) : send-campaign a remis la campagne en brouillon.
      const refusal = !res.ok ? await res.json().catch(() => ({})) as { error?: string } : {};
      if (!res.ok && res.status !== 402 && refusal.error !== NOT_SCHEDULED_ANYMORE) {
        await admin.from('email_campaigns').update({ status: 'failed', error_message: `Cron send failed: ${res.status}` })
          .eq('id', c.id).eq('status', 'sending');
      } else if (res.ok) {
        await res.body?.cancel();
      }
      processed++;
    } catch (e) {
      // Réseau coupé pendant l'appel : seulement si elle est encore « sending ».
      await admin.from('email_campaigns').update({ status: 'failed', error_message: String(e) })
        .eq('id', c.id).eq('status', 'sending');
    }
  }
  return processed;
}
