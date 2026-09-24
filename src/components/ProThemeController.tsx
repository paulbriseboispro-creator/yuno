import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyProTheme, isThemedProPath, useProTheme } from '@/lib/proTheme';
import { isNative } from '@/lib/native';

/**
 * Applique le thème des dashboards pro sur `<html>` selon la route courante.
 * Monté une fois, hors <Routes>. Hors dashboard, l'attribut est retiré : une
 * page publique ouverte depuis la Console reste la page publique sombre.
 */
export function ProThemeController() {
  const { pathname } = useLocation();
  const { resolved } = useProTheme();
  const themed = isThemedProPath(pathname);
  const target = themed ? resolved : null;

  // Le changement de thème par la personne passe par `setProThemePref`, qui
  // pose déjà l'attribut dans sa transition en cercle : ici on ne fait que
  // suivre la navigation (entrer / sortir d'un dashboard), sans animation.
  useEffect(() => {
    applyProTheme(target);
  }, [target]);

  // Barre d'état iOS : texte sombre sur un dashboard clair, clair partout ailleurs.
  useEffect(() => {
    if (!isNative()) return;
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: target === 'light' ? Style.Light : Style.Dark }))
      .catch(() => {});
  }, [target]);

  return null;
}
