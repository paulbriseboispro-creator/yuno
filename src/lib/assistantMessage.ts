/**
 * Découpe une réponse de l'assistant en segments : de la prose (Markdown) et
 * des CARTES soirée.
 *
 * L'assistant colle un jeton `[[event:<uuid>]]` pour chaque soirée qu'il
 * recommande (voir la section « CARTES SOIRÉE » du prompt de l'edge function
 * `yuno-assistant`). Le front le remplace par une vraie carte Yuno, cliquable —
 * l'IA n'écrit donc jamais l'affiche ni le lien d'une soirée en Markdown.
 *
 * Deux jetons qui se suivent (au plus une ligne vide entre eux) forment UN
 * segment : ils se rendent alors en rail horizontal plutôt qu'empilés.
 */

export type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'events'; ids: string[] };

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Le jeton est toléré avec des espaces ou un `:` en trop : le modèle n'écrit
// pas toujours au caractère près, et un jeton raté s'afficherait en clair.
const TOKEN = new RegExp(`\\[\\[\\s*event\\s*:\\s*(${UUID})\\s*\\]\\]`, 'g');

/** Vrai dès qu'un jeton (même partiel, en cours de streaming) est présent. */
export function hasEventToken(content: string): boolean {
  return content.includes('[[event:') || content.includes('[[ event');
}

/**
 * Nettoie ce que le modèle ajoute autour d'un jeton malgré la consigne.
 *
 * Quand il propose PLUSIEURS soirées, gpt-4o-mini retombe sur une puce par
 * soirée : « - **Titre** » suivi de la carte, qui réaffiche ce même titre. On
 * efface la puce quand elle ne porte QUE le titre en gras et qu'un jeton suit
 * immédiatement — une puce qui dit autre chose est conservée telle quelle.
 */
function normalize(content: string): string {
  return content
    // Décoration collée devant le jeton (« 🔗 [[event:…]] »).
    .replace(/^[ \t]*[-*]?[ \t]*(?:\u{1F517}|\u{1F449}|\u{27A1}\u{FE0F}?|\u{25B6}\u{FE0F}?)+[ \t]*(?=\[\[\s*event)/gmu, '')
    // Puce qui ne porte que le titre, immédiatement suivie de la carte.
    .replace(
      /^[ \t]*[-*][ \t]*\*\*[^\n*]+\*\*[ \t]*:?[ \t]*\n+(?=[ \t]*\[\[\s*event)/gm,
      '',
    );
}

export function parseAssistantMessage(rawContent: string): AssistantSegment[] {
  const content = normalize(rawContent);
  const segments: AssistantSegment[] = [];
  let cursor = 0;
  let pendingText = '';

  const flushText = () => {
    const cleaned = pendingText
      // Un jeton mal formé (slug au lieu d'uuid, id inventé) ne doit jamais
      // s'afficher en clair : on l'efface plutôt que de montrer « [[event:… ] ».
      .replace(/\[\[\s*event\s*:[^\]]*\]\]/gi, '')
      // « CARTE= » est une étiquette de nos notes internes. Le modèle la recopie
      // parfois avant le jeton : elle ne doit jamais atteindre l'écran.
      .replace(/(?:^|\n)[ \t]*[-*]?[ \t]*(?:CARTE\s*=|Carte à coller\s*:)[ \t]*$/gi, '')
      .replace(/(?:CARTE\s*=|Carte à coller\s*:)\s*$/i, '')
      // Une puce dont le contenu ÉTAIT le jeton ne doit pas rester en tiret nu.
      .replace(/^[ \t]*[-*][ \t]*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (cleaned) segments.push({ kind: 'text', text: cleaned });
    pendingText = '';
  };

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(content)) !== null) {
    pendingText += content.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    // Rattacher au segment précédent quand seuls des blancs les séparent :
    // « carte, carte » devient un rail, pas deux cartes empilées.
    const last = segments[segments.length - 1];
    if (last?.kind === 'events' && !pendingText.trim()) {
      pendingText = '';
      if (!last.ids.includes(match[1])) last.ids.push(match[1]);
      continue;
    }
    flushText();
    segments.push({ kind: 'events', ids: [match[1]] });
  }

  pendingText += content.slice(cursor);
  // Pendant le streaming, un jeton arrive caractère par caractère : ne pas
  // laisser « [[event:cb62 » clignoter en clair dans la bulle.
  const partial = pendingText.lastIndexOf('[[');
  if (partial !== -1 && !pendingText.slice(partial).includes(']]')) {
    pendingText = pendingText.slice(0, partial);
  }
  flushText();

  return segments;
}
