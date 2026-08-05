// Lancement à la demande du quiz de goûts (Taste Engine) depuis le bouton démo.
// Le quiz est un modal client rendu par OnboardingGate ; ce petit event permet
// de le rouvrir quand on veut (démo, ou compte qui n'a pas encore eu le quiz),
// en réinitialisant au passage le flag « déjà répondu ».

export const LAUNCH_TASTE_QUIZ_EVENT = 'yuno:launch-taste-quiz';
const TASTE_ANSWERED_KEY = 'onboarding_taste_answered';

export function launchTasteQuiz() {
  try { localStorage.removeItem(TASTE_ANSWERED_KEY); } catch { /* stockage indispo : on force quand même l'ouverture */ }
  window.dispatchEvent(new Event(LAUNCH_TASTE_QUIZ_EVENT));
}
