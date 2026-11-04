// Nom d'un billet hors de la page de choix : « Pack · Billet » quand le billet
// est rangé dans un pack (billetterie libre, table ticket_groups ; le nom du
// pack est recopié sur le billet par la base dans ticket_rounds.group_label).
// Deux packs peuvent avoir chacun un « First Release » : le client, Stripe,
// l'e-mail, le pass Wallet et la porte doivent dire lequel.
// Source unique : le front la ré-exporte (src/lib/ticketGroups.ts).
export function ticketDisplayName(name: string | null | undefined, groupLabel?: string | null): string {
  const n = (name ?? "").trim();
  const g = (groupLabel ?? "").trim();
  if (!g) return n;
  if (!n) return g;
  return `${g} · ${n}`;
}
