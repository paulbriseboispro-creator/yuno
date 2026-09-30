/**
 * « Créer une campagne » depuis un segment RFM de l'Analyse (`?rfm=at_risk`,
 * `?rfm=champions,loyal`) : le segment intégré de l'Email Studio qui porte la
 * même population, résolu à l'envoi — jamais une liste de personnes dans l'URL.
 */
export function rfmParamToAudiences(raw: string | null): { kind: 'regulars' | 'big_spenders' | 'new_customers' | 'dormant' }[] {
  if (!raw) return [];
  const kinds = new Set<'regulars' | 'big_spenders' | 'new_customers' | 'dormant'>();
  for (const seg of raw.split(',')) {
    const k = seg.trim();
    if (k === 'champions' || k === 'loyal' || k === 'pillars') kinds.add('regulars');
    else if (k === 'promising' || k === 'big_occasional') kinds.add('big_spenders');
    else if (k === 'new' || k === 'new_promising') kinds.add('new_customers');
    else if (k === 'at_risk' || k === 'dormant' || k === 'lost') kinds.add('dormant');
  }
  return Array.from(kinds).map((kind) => ({ kind }));
}

