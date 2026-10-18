// Comptes de référence du banc. Chaque compte est une portée organisateur
// branchée sur une billetterie « shotgun » synthétique.
//
// Les effets (artist, concept, genre…) sont des poids de la VÉRITÉ cachée du
// générateur : une personne qui a vu un artiste invité a exp(artist) fois plus
// de chances de revenir quand il rejoue. Le banc vérifie que le moteur
// d'hypothèses et le score retrouvent ce qui a été planté, et rien d'autre.

const base = {
  seed: 1,
  months: 13,             // historique (les soirées passées s'étalent dessus)
  nightsUpcoming: 4,      // soirées à venir, dans les 60 jours
  series: 6,              // concepts récurrents (+ soirées uniques)
  oneOffShare: 0.25,      // part des soirées hors série
  residents: 2,           // artistes résidents (jouent presque partout)
  guestPool: 40,          // artistes invités
  newPerNight: 90,        // nouveaux venus par soirée (moyenne)
  loyalShare: 0.18,       // part de fidèles parmi les nouveaux
  loyalBase: -1.6,        // propension d'un fidèle à venir à une soirée
  casualBase: -4.2,       // propension d'un occasionnel
  churnMonths: 7,         // durée de vie moyenne d'un client (géométrique)
  recency: 0.55,          // pénalité par log(1 + jours / 30) depuis la dernière venue
  artist: 1.4,            // a déjà vu un invité de l'affiche
  concept: 1.0,           // a déjà fait une édition de la série
  genre: 0.5,             // genre préféré à l'affiche
  weekday: 0.2,           // son jour habituel
  headlinerPull: 1.8,     // multiplicateur de nouveaux venus quand un invité populaire joue
  earlyShare: 0.25,       // achète tôt (14 j et plus avant)
  lateShare: 0.25,        // achète la veille ou le jour même
  groupShare: 0.35,       // vient à plusieurs (commande de 2 à 4 billets)
  namedTickets: 0.6,      // part des commandes à plusieurs avec des détenteurs différents
  inviteShare: 0.06,      // part des nouveaux venus entrés par invitation
  abroadShare: 0.05,      // résidents étrangers
  farShare: 0.08,         // Français à plus de 80 km
  sgDiscovery: 0.3,       // 1er billet pris depuis l'appli Shotgun
  scanRate: 0.92,
};

export const PROFILES = {
  // Ordre de grandeur de crm@womber.fr (≈ 2 650 contacts, 8 000 billets, 29 soirées).
  demo: { ...base, seed: 11, nights: 29, months: 12, newPerNight: 42, loyalBase: -0.9, casualBase: -3.1 },
  // Un gros organisateur : 12 000 contacts, 30 000 billets, 60 soirées.
  grand: { ...base, seed: 23, nights: 60, months: 14, series: 8, guestPool: 70, newPerNight: 95, loyalBase: -2.2, casualBase: -4.6 },
  // Un petit compte : 300 contacts, 10 soirées (doit rester « à tester »).
  petit: { ...base, seed: 37, nights: 10, months: 6, series: 2, guestPool: 10, newPerNight: 13, loyalBase: -1.2, casualBase: -3.4 },
  // Contrôle : aucun effet planté, le moteur ne doit rien confirmer.
  hasard: { ...base, seed: 41, nights: 40, newPerNight: 50, loyalBase: -1.1, casualBase: -3.3,
            artist: 0, concept: 0, genre: 0, weekday: 0, headlinerPull: 1 },
};

export function profile(name, overrides = {}) {
  const p = PROFILES[name];
  if (!p) throw new Error(`profil inconnu « ${name} » (${Object.keys(PROFILES).join(', ')})`);
  return { name, ...p, ...overrides };
}
