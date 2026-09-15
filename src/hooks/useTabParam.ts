import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Onglet de page adressable par l'URL (`?tab=…`).
 *
 * C'est ce qui permet à la barre latérale de pointer directement sur un onglet
 * (Tables VIP → Packs, Staff → Briefing) au lieu d'obliger à ouvrir la page
 * puis à cliquer. Une valeur inconnue est ignorée — jamais d'onglet vide parce
 * qu'un lien a vieilli.
 *
 * L'URL est relue à chaque changement : cliquer une autre sous-entrée alors que
 * la page est déjà ouverte change bien d'onglet (React ne remonte pas le
 * composant, l'état initial ne suffirait pas).
 */
export function pickTab<T extends string>(
  requested: string | null,
  allowed: readonly T[],
): T | null {
  return requested && (allowed as readonly string[]).includes(requested) ? (requested as T) : null;
}

export function useTabParam<T extends string>(
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [searchParams] = useSearchParams();
  const valid = pickTab<T>(searchParams.get('tab'), allowed);
  const [tab, setTab] = useState<T>(valid ?? fallback);

  useEffect(() => {
    if (valid) setTab(valid);
  }, [valid]);

  return [tab, setTab];
}
