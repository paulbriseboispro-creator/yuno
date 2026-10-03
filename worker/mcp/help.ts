// Outil search_yuno_help : la base de connaissances de l'Assistant Console,
// la même (supabase/functions/_shared/console-help-articles.ts), cherchée par
// mots-clés comme le fait owner-assistant. Rien n'est inventé ici : l'IA lit
// l'article et en tire les étapes.

import { CONSOLE_HELP_ARTICLES, DRINKS_HELP_ARTICLE_IDS } from '../../supabase/functions/_shared/console-help-articles';
import { DRINKS_PILLAR_LIVE } from './config';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface HelpHit {
  id: string;
  title: string;
  answer: string;
  console_url: string;
}

export function searchHelp(query: string, origin: string, kind: 'venue' | 'organizer'): HelpHit[] {
  const q = fold(query);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const scored = Object.entries(CONSOLE_HELP_ARTICLES)
    .filter(([id]) => DRINKS_PILLAR_LIVE || !DRINKS_HELP_ARTICLE_IDS.has(id))
    .map(([id, a]) => {
      let score = 0;
      for (const kw of a.keywords) {
        const k = fold(kw);
        if (q.includes(k)) score += 4 + k.length / 10;
        else if (words.some((w) => k.includes(w))) score += 1;
      }
      const title = fold(a.title);
      for (const w of words) if (title.includes(w)) score += 2;
      const snippet = fold(a.snippet);
      for (const w of words) if (snippet.includes(w)) score += 0.3;
      return { id, a, score };
    })
    .filter((x) => x.score >= 2)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  return scored.map(({ id, a }) => ({
    id,
    title: a.title,
    answer: a.snippet,
    // Les chemins de la base de connaissances sont ceux de la Console Club ;
    // un organisateur a son propre centre d'aide.
    console_url: kind === 'venue' ? `${origin}${a.path}` : `${origin}/organizer-app/help`,
  }));
}
