// La « nuit » en cours, au format 'yyyy-mm-dd' : la date locale d'il y a
// NIGHT_ROLLOVER_HOURS heures. Une soirée du 25 reste donc « ce soir » jusqu'à
// 6 h du matin le 26, heure de l'appareil.
//
// Les pages publiques d'agence coupaient sur la date UTC
// (`new Date().toISOString()`) : à 2 h du matin à Madrid (minuit UTC), la
// soirée en cours disparaissait du linktree et sa page renvoyait vers
// l'accueil — en pleine nuit, quand les gens achètent encore.
export const NIGHT_ROLLOVER_HOURS = 6;

export function currentNightDate(now: Date = new Date()): string {
  const d = new Date(now.getTime() - NIGHT_ROLLOVER_HOURS * 3_600_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
