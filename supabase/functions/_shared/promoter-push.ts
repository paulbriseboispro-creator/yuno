import { sendAutoPush, AUTO_PUSH, type AutoPushVar } from "./auto-push.ts";

/**
 * Vidange de la file de notifications promoteur (app Yuno Pro).
 *
 * La file (`promoter_push_queue`) est alimentee par des triggers, dans la meme
 * transaction que l'ecriture metier : une vente ne peut pas echouer ni ralentir
 * parce qu'un push a mal tourne. C'est ici, de facon asynchrone, qu'on envoie.
 *
 * La COALESCENCE a deja eu lieu a l'insertion (index unique sur `dedup_key`
 * tant que la ligne n'est pas partie, compteurs additionnes) : trente ventes
 * d'equipe dans la soiree sont arrivees ici sous la forme d'une seule ligne
 * « count: 30, amount: 240 ». On n'a donc rien a regrouper, juste a envoyer.
 *
 * Branche sur `process-scheduled-campaigns` (cron toutes les 5 min) plutot que
 * dans une fonction edge dediee : le cap de fonctions Supabase renvoie 402 sur
 * tout nouveau deploiement. C'est le meme choix que live-ops-alerts, pour la
 * meme raison.
 */

const BATCH = 200;

/** Ligne de file telle que stockee. */
type QueueRow = {
  id: number;
  user_id: string;
  push_key: string;
  variant: string | null;
  vars: Record<string, unknown> | null;
  url: string | null;
};

/**
 * Met les variables au format attendu par les gabarits.
 *
 * Les montants arrivent en numerique depuis Postgres ; sans arrondi, une
 * commission de 12.870000000000001 s'afficherait telle quelle sur l'ecran de
 * verrouillage. Les entiers restent sans decimale (« 30 ventes », pas
 * « 30.00 ventes »).
 */
function formatVars(vars: Record<string, unknown> | null): Record<string, AutoPushVar> {
  const out: Record<string, AutoPushVar> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (typeof v === "number") {
      out[k] = Number.isInteger(v) ? String(v) : v.toFixed(2);
    } else if (v !== null && v !== undefined) {
      out[k] = String(v);
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function dispatchPromoterPushes(admin: any): Promise<{ processed: number; sent: number }> {
  const { data: rows, error } = await admin
    .from("promoter_push_queue")
    .select("id, user_id, push_key, variant, vars, url")
    .is("sent_at", null)
    .lte("not_before", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("[PROMOTER-PUSH] read queue failed:", error.message);
    return { processed: 0, sent: 0 };
  }
  if (!rows || rows.length === 0) return { processed: 0, sent: 0 };

  let sent = 0;
  const done: number[] = [];

  for (const row of rows as QueueRow[]) {
    // Une cle inconnue du registre ne doit pas bloquer la file derriere elle :
    // on la marque traitee et on passe. Sans ca, une cle retiree du code
    // laisserait la file croitre indefiniment.
    if (!AUTO_PUSH[row.push_key]) {
      console.error(`[PROMOTER-PUSH] cle inconnue, ligne abandonnee: ${row.push_key}`);
      done.push(row.id);
      continue;
    }

    try {
      const res = await sendAutoPush(admin, {
        key: row.push_key,
        userId: row.user_id,
        url: row.url ?? "/promoter",
        vars: formatVars(row.vars),
        variant: row.variant ?? "default",
      });
      sent += res.sent;
      done.push(row.id);
    } catch (e) {
      // Erreur reseau : on laisse la ligne en file, le prochain passage
      // reessaiera. Le garde-fou de 30 jours de purge_promoter_push_queue()
      // evite qu'une ligne definitivement cassee reste la pour toujours.
      console.error(`[PROMOTER-PUSH] envoi echoue (${row.push_key}):`, String(e));
    }
  }

  if (done.length > 0) {
    const { error: markErr } = await admin
      .from("promoter_push_queue")
      .update({ sent_at: new Date().toISOString() })
      .in("id", done);
    if (markErr) {
      // Grave : sans marquage, le prochain passage renverrait les memes push.
      console.error("[PROMOTER-PUSH] marquage sent_at echoue:", markErr.message);
    }
  }

  return { processed: done.length, sent };
}
