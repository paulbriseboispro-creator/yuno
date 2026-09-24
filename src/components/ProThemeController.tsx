import { useEffect, useRef } from 'react';
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
  const lastResolved = useRef(resolved);

  useEffect(() => {
    // Fondu seulement quand la personne bascule elle-même, pas à la navigation.
    const animate = themed && lastResolved.current !== resolved;
    lastResolved.current = resolved;
    applyProTheme(target, { animate });
  }, [target, themed, resolved]);

  // Barre d'état iOS : texte sombre sur un dashboard clair, clair partout ailleurs.
  useEffect(() => {
    if (!isNative()) return;
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: target === 'light' ? Style.Light : Style.Dark }))
      .catch(() => {});
  }, [target]);

  return null;
}
