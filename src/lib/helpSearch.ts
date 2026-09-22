import type { OwnerHelpArticle, OwnerHelpCategory } from '@/data/ownerHelpContent';

/**
 * Recherche du centre d'aide : en mémoire, scorée, tolérante aux accents.
 * Chaque résultat pointe la SECTION qui a fait mouche, pour ouvrir l'article
 * directement au bon endroit.
 */
export interface HelpSearchHit {
  article: OwnerHelpArticle;
  category: OwnerHelpCategory;
  /** Index de la section la plus pertinente, -1 si c'est le titre / la description. */
  sectionIndex: number;
  sectionHeading: string | null;
  snippet: string;
  score: number;
}

export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function searchTokens(query: string): string[] {
  return foldText(query).split(/[\s,;:!?«»"'()]+/).filter((t) => t.length >= 2);
}

function snippetAround(body: string, tokens: string[]): string {
  const folded = foldText(body);
  let at = -1;
  for (const tk of tokens) {
    const i = folded.indexOf(tk);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return body.slice(0, 140).trim() + (body.length > 140 ? '…' : '');
  const start = Math.max(0, body.lastIndexOf(' ', Math.max(0, at - 60)));
  const end = Math.min(body.length, at + 110);
  return (start > 0 ? '…' : '') + body.slice(start, end).replace(/\n+/g, ' ').trim() + (end < body.length ? '…' : '');
}

export function searchHelp(
  categories: OwnerHelpCategory[],
  query: string,
  t: (key: string) => string,
  limit = 12,
): HelpSearchHit[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const hits: HelpSearchHit[] = [];
  for (const category of categories) {
    for (const article of category.articles) {
      const title = foldText(t(article.titleKey));
      const desc = foldText(t(article.descKey));
      const keywords = (article.keywords ?? []).map(foldText);
      let score = 0;
      let matchedTokens = 0;
      for (const tk of tokens) {
        let hit = false;
        if (title.includes(tk)) { score += 12; hit = true; }
        if (desc.includes(tk)) { score += 5; hit = true; }
        if (keywords.some((k) => k.includes(tk))) { score += 9; hit = true; }
        if (hit) matchedTokens++;
      }
      let bestSection = -1;
      let bestSectionScore = 0;
      article.sections.forEach((s, i) => {
        const heading = foldText(t(s.headingKey));
        const body = foldText(t(s.bodyKey));
        let sScore = 0;
        for (const tk of tokens) {
          if (heading.includes(tk)) sScore += 6;
          if (body.includes(tk)) sScore += 2;
        }
        if (sScore > bestSectionScore) { bestSectionScore = sScore; bestSection = i; }
        score += sScore;
      });
      if (bestSectionScore > 0) matchedTokens = Math.max(matchedTokens, 1);
      if (score <= 0) continue;
      // Une requête à plusieurs mots récompense les articles qui les ont TOUS.
      if (tokens.length > 1 && matchedTokens === tokens.length) score *= 1.5;
      // Un article de démarrage rapide passe devant à score égal.
      if (article.quickStart) score += 1;
      const section = bestSection >= 0 ? article.sections[bestSection] : null;
      hits.push({
        article,
        category,
        sectionIndex: bestSection,
        sectionHeading: section ? t(section.headingKey) : null,
        snippet: section ? snippetAround(t(section.bodyKey), tokens) : t(article.descKey),
        score,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
