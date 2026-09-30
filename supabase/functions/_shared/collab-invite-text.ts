// Résumé humain des conditions d'une collab, pour les emails d'invitation
// (organisateur → club et club → organisateur). Miroir de readSettlement.
//
// Les règles arrivent telles que le pro les a envoyées (corps de requête) :
// on les lit en `unknown`, champ par champ.

type Obj = Record<string, unknown>;
type Tier = { from?: unknown; pct?: unknown };

const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);

/** « Billets 100 % orga · tables 100 % club » ou « barème sur le CA : 0 % < 3 500 €, 7 % … ». */
export function summarizeTerms(rules: unknown, lang: "fr" | "en" | "es"): string | null {
  const base = summarizeSplit(rules, lang);
  const r = obj(rules);
  if (!base || !r) return null;
  // Le club lit dès l'email s'il lui faut Stripe : « Non » = une partie encaisse
  // et vire la part de l'autre après la soirée (miroir de readSettlement).
  const st = obj(r.settlement);
  if (!st || st.mode !== "transfer") return base;
  const tiered = obj(r.remuneration)?.mode === "tiered_total" || obj(r.tables)?.basis === "total_spend";
  const byOrg = !tiered && st.collector === "organizer";
  const days = [7, 15, 30].includes(Number(st.payment_terms_days)) ? Number(st.payment_terms_days) : 15;
  const tail = lang === "en"
    ? (byOrg ? `the organizer collects the sales and transfers the club's share within ${days} days of the night` : `the club collects the sales and transfers the organizer's share within ${days} days of the night`)
    : lang === "es"
      ? (byOrg ? `el organizador cobra las ventas y transfiere la parte del club en ${days} días tras la noche` : `el club cobra las ventas y transfiere la parte del organizador en ${days} días tras la noche`)
      : (byOrg ? `l'organisateur encaisse les ventes et vire la part du club sous ${days} jours après la soirée` : `le club encaisse les ventes et vire la part de l'organisateur sous ${days} jours après la soirée`);
  const lead = lang === "en" ? "No Stripe split" : lang === "es" ? "Sin reparto con Stripe" : "Sans partage Stripe";
  return `${base}. ${lead} : ${tail}.`;
}

export function summarizeSplit(rules: unknown, lang: "fr" | "en" | "es"): string | null {
  const r = obj(rules);
  if (!r) return null;
  const orga = lang === "en" ? "organizer" : lang === "es" ? "orga" : "orga";
  const rem = obj(r.remuneration);
  if (rem && rem.mode === "tiered_total" && Array.isArray(rem.tiers) && rem.tiers.length) {
    const tiers = ([...rem.tiers] as Tier[]).sort((a, b) => Number(a.from) - Number(b.from));
    const parts = tiers.map((t, i) => {
      const next = tiers[i + 1];
      const range = next ? `${Number(t.from).toLocaleString("fr-FR")}–${Number(next.from).toLocaleString("fr-FR")} €` : `≥ ${Number(t.from).toLocaleString("fr-FR")} €`;
      return `${range} : ${t.pct} %`;
    });
    const head = lang === "en" ? "Tiers on the night's total revenue" : lang === "es" ? "Escala sobre la facturación de la noche" : "Barème sur le CA de la soirée";
    return `${head} (${orga}) — ${parts.join(" · ")}`;
  }
  const pct = (b: unknown) => Number(obj(b)?.organizer_pct ?? 0);
  const tk = lang === "en" ? "Tickets" : lang === "es" ? "Entradas" : "Billets";
  const tb = lang === "en" ? "tables" : lang === "es" ? "mesas" : "tables";
  const dr = lang === "en" ? "drinks" : lang === "es" ? "bebidas" : "boissons";
  return `${tk} ${pct(r.tickets)} % ${orga} · ${tb} ${pct(r.tables)} % ${orga} · ${dr} ${pct(r.drinks)} % ${orga}`;
}


/**
 * La partie `side` aura-t-elle besoin d'un compte Stripe ? Non seulement si le
 * contrat est réglé par virement ET que c'est l'AUTRE partie qui encaisse.
 * Barème ou tables au total dépensé : encaisseur forcé au club.
 */
export function needsStripe(rules: unknown, side: "venue" | "organizer"): boolean {
  const r = obj(rules);
  const st = obj(r?.settlement);
  if (!st || st.mode !== "transfer") return true;
  const tiered = obj(r?.remuneration)?.mode === "tiered_total" || obj(r?.tables)?.basis === "total_spend";
  const collector = tiered ? "venue" : (st.collector === "organizer" ? "organizer" : "venue");
  return collector === side;
}
