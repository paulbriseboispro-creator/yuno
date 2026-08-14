import { Component, type ReactNode } from 'react';
import { persistedLanguage } from '@/contexts/LanguageContext';

/**
 * Garde-fou racine : un crash de rendu n'importe où dans l'arbre ne doit
 * JAMAIS laisser un écran mort (en natif, le premier commit React a remplacé
 * le loader rouge — un crash ensuite ferait un écran blanc figé, et l'app
 * devrait être tuée à la main). Écran de relance minimal, dans la langue de
 * l'appareil, sans AUCUNE dépendance (i18n, UI kit, router) : ce composant
 * doit survivre à un arbre entièrement cassé.
 *
 * Complète le watchdog inline d'index.html, qui couvre lui les crashs AVANT
 * le premier commit React (entry JS mort → loader figé).
 */

const COPY: Record<string, { title: string; cta: string }> = {
  fr: { title: 'Un imprévu est survenu', cta: 'Relancer' },
  es: { title: 'Algo salió mal', cta: 'Reiniciar' },
  en: { title: 'Something went wrong', cta: 'Reload' },
};

function copy(): { title: string; cta: string } {
  try {
    const code = (persistedLanguage() || navigator.language || 'en').slice(0, 2);
    return COPY[code] || COPY.en;
  } catch {
    return COPY.en;
  }
}

export class BootErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('[BootErrorBoundary]', error, info?.componentStack ?? '');
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    const c = copy();
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#050505',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: '-apple-system, ui-sans-serif, system-ui, sans-serif',
          color: '#fff',
          padding: 24,
        }}
      >
        <div>
          <p style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 600 }}>{c.title}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              border: 0,
              borderRadius: 14,
              padding: '13px 30px',
              fontSize: 16,
              fontWeight: 600,
              background: '#c62828',
              color: '#fff',
            }}
          >
            {c.cta}
          </button>
        </div>
      </div>
    );
  }
}
