// Textes des notifications de vente de billets envoyées aux pros (cloche de la
// Console : `staff_notifications` côté club, `organizer_notifications` côté
// organisateur). La cloche affiche `title` / `message` tels qu'enregistrés : ils
// s'écrivent donc ICI, dans la langue du destinataire, au moment de la vente.
//
// Le montant d'une vente est le CA club (prix payé − frais de service Yuno −
// assurance, `clubRevenue.ticket` ⇄ `ticketRevenue` de src/utils/fees.ts) :
// ce que le pro touche, jamais le total payé par le client, frais compris.
//
// Module PUR (aucune I/O) : testé par src/lib/__tests__/saleNotificationText.test.ts.

export type SaleNotifLang = "fr" | "en" | "es";

/** Langue d'un pro (`profiles.preferred_language`), français par défaut comme les push pros. */
export function saleNotifLang(v: unknown): SaleNotifLang {
  return v === "en" || v === "es" ? v : "fr";
}

const LOCALE: Record<SaleNotifLang, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };

/** Montant en euros au format de la langue (« 6,00 € », « €6.00 »). */
export function formatSaleAmount(amount: number, lang: SaleNotifLang): string {
  const v = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "EUR" }).format(v);
}

const TICKET_FALLBACK: Record<SaleNotifLang, string> = { fr: "Billet", en: "Ticket", es: "Entrada" };

function roundLabel(roundName: string | null | undefined, lang: SaleNotifLang): string {
  const n = (roundName ?? "").trim();
  return n || TICKET_FALLBACK[lang];
}

export interface NotifText {
  title: string;
  message: string;
}

/** « Nouveau billet vendu » : quantité, tarif réel, CA club, acheteur. */
export function ticketSaleNotif(
  lang: SaleNotifLang,
  p: { quantity: number; roundName: string | null | undefined; clubRevenue: number; buyerName?: string | null },
): NotifText {
  const title = { fr: "Nouveau billet vendu", en: "New ticket sold", es: "Nueva entrada vendida" }[lang];
  const buyer = p.buyerName?.trim() ? ` · ${p.buyerName.trim()}` : "";
  return {
    title,
    message: `${p.quantity}x ${roundLabel(p.roundName, lang)} — ${formatSaleAmount(p.clubRevenue, lang)}${buyer}`,
  };
}

/** « Vente via promoteur » : même ligne, avec le code utilisé. */
export function promoterSaleNotif(
  lang: SaleNotifLang,
  p: { quantity: number; roundName: string | null | undefined; clubRevenue: number; promoCode?: string | null },
): NotifText {
  const title = { fr: "Vente via promoteur", en: "Sale via promoter", es: "Venta vía promotor" }[lang];
  const codeWord = { fr: "code", en: "code", es: "código" }[lang];
  const code = p.promoCode?.trim() ? ` · ${codeWord} "${p.promoCode.trim()}"` : "";
  return {
    title,
    message: `${p.quantity}x ${roundLabel(p.roundName, lang)} — ${formatSaleAmount(p.clubRevenue, lang)}${code}`,
  };
}

/** Un round (tarif) est complet. Le français reste celui d'avant, mot pour mot. */
export function roundSoldOutNotif(lang: SaleNotifLang, p: { roundName: string | null | undefined; max: number }): NotifText {
  const name = roundLabel(p.roundName, lang);
  const title = { fr: "Round de billets épuisé 🎟️", en: "Ticket round sold out 🎟️", es: "Tanda de entradas agotada 🎟️" }[lang];
  const message = {
    fr: `"${name}" — complet (${p.max}/${p.max} billets vendus)`,
    en: `"${name}" — sold out (${p.max}/${p.max} tickets sold)`,
    es: `"${name}" — agotada (${p.max}/${p.max} entradas vendidas)`,
  }[lang];
  return { title, message };
}

/** Un tarif approche de sa limite (80 % et plus). */
export function roundWarningNotif(
  lang: SaleNotifLang,
  p: { roundName: string | null | undefined; sold: number; max: number; pct: number },
): NotifText {
  const name = roundLabel(p.roundName, lang);
  const title = { fr: "Billets presque épuisés", en: "Tickets almost sold out", es: "Entradas casi agotadas" }[lang];
  const message = {
    fr: `"${name}" — ${p.sold}/${p.max} vendus (${p.pct}%)`,
    en: `"${name}" — ${p.sold}/${p.max} sold (${p.pct}%)`,
    es: `"${name}" — ${p.sold}/${p.max} vendidas (${p.pct} %)`,
  }[lang];
  return { title, message };
}
