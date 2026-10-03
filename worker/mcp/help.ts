// Outil search_yuno_help : la base de connaissances de l'Assistant Console,
// la même (supabase/functions/_shared/console-help-articles.ts), cherchée par
// mots-clés comme le fait owner-assistant. Rien n'est inventé ici : l'IA lit
// l'article et en tire les étapes.
//
// Deux adaptations à une IA, mesurées sur la démo le 2026-10-03 :
//   • les articles sont en français et l'IA cherche souvent en anglais
//     (« turn on abandoned cart email » ne trouvait pas l'article des
//     automatisations) : la requête est enrichie de son équivalent français ;
//   • un article peut dépasser 13 000 caractères : au-delà d'un budget, l'IA
//     reçoit l'ouverture de l'article et les phrases qui parlent de sa question,
//     plus le lien de l'article entier.

import { CONSOLE_HELP_ARTICLES, DRINKS_HELP_ARTICLE_IDS } from '../../supabase/functions/_shared/console-help-articles';
import { DRINKS_PILLAR_LIVE } from './config';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Termes anglais (pliés) → mots des articles. Seulement ce qu'un pro demande
// vraiment à son IA ; l'ordre ne compte pas.
const EN_TO_FR: [string, string][] = [
  ['abandoned cart', 'panier abandonne'],
  ['abandoned checkout', 'panier abandonne'],
  ['cart', 'panier'],
  ['automation', 'automatisation'],
  ['recipe', 'recette'],
  ['win back', 'reconquete'],
  ['win-back', 'reconquete'],
  ['welcome', 'bienvenue'],
  ['last call', 'dernier appel'],
  ['thank you', 'merci'],
  ['regular', 'habitue'],
  ['tier', 'palier'],
  ['resend', 'renvoi non-ouvreurs'],
  ['non-openers', 'renvoi non-ouvreurs'],
  ['send time', 'heure d\'envoi'],
  ['schedule', 'programmer'],
  ['template', 'modele'],
  ['unsubscribe', 'desabonnement'],
  ['sold out', 'complet'],
  ['entry target', 'objectif'],
  ['target', 'objectif'],
  ['tracked link', 'lien suivi'],
  ['bio link', 'lien bio'],
  ['promo code', 'code promo'],
  ['discount', 'reduction'],
  ['guest list', 'guest list liste'],
  ['refund', 'remboursement'],
  ['event', 'soiree'],
  ['party', 'soiree'],
  ['ticket', 'billet'],
  ['import', 'importer'],
  ['contacts', 'contacts base'],
  ['customer', 'client'],
  ['team', 'equipe'],
  ['door', 'porte'],
];

export function expandQuery(query: string): string {
  const q = fold(query);
  const extra = EN_TO_FR.filter(([en]) => q.includes(en)).map(([, fr]) => fr);
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

export const ANSWER_BUDGET = 2400;

// Les phrases d'un long article qui parlent de la question, dans l'ordre de
// l'article, précédées de son ouverture. Un article court passe entier.
export function focusExcerpt(text: string, words: string[], budget = ANSWER_BUDGET): { text: string; cut: boolean } {
  if (text.length <= budget) return { text, cut: false };
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const stems = [...new Set(words.filter((w) => w.length >= 4).map((w) => w.slice(0, 6)))];
  const scored = sentences.map((s, i) => {
    const f = fold(s);
    return { i, s, score: stems.reduce((n, st) => n + (f.includes(st) ? 1 : 0), 0) };
  });
  const keep = new Set<number>([0]);
  let size = sentences[0].length;
  for (const x of [...scored].filter((x) => x.i > 0 && x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (size + x.s.length + 1 > budget) continue;
    keep.add(x.i);
    size += x.s.length + 1;
  }
  // Rien de précis : on prolonge l'ouverture de l'article.
  for (let i = 1; i < sentences.length && keep.size === 1; i++) {
    if (size + sentences[i].length + 1 > budget) break;
    keep.add(i);
    size += sentences[i].length + 1;
  }
  const order = [...keep].sort((a, b) => a - b);
  const out = order.map((i, k) => (k > 0 && i !== order[k - 1] + 1 ? `… ${sentences[i]}` : sentences[i])).join(' ');
  return { text: out, cut: true };
}

export interface HelpHit {
  id: string;
  title: string;
  answer: string;
  console_url: string;
  excerpt?: boolean;
}

export function searchHelp(query: string, origin: string, kind: 'venue' | 'organizer'): HelpHit[] {
  const q = expandQuery(query);
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
  return scored.map(({ id, a }) => {
    const { text, cut } = focusExcerpt(a.snippet, words);
    return {
      id,
      title: a.title,
      answer: text,
      // Les chemins de la base de connaissances sont ceux de la Console Club ;
      // un organisateur a son propre centre d'aide.
      console_url: kind === 'venue' ? `${origin}${a.path}` : `${origin}/organizer-app/help`,
      ...(cut ? { excerpt: true } : {}),
    };
  });
}
