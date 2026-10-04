/**
 * Garde d'affichage de la Console : une page qui plante rend l'écran « erreur
 * 500 » (référence copiable, envoyée au suivi d'erreurs) au lieu d'un écran
 * blanc. La référence n'est jamais montrée sans avoir été journalisée.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { capturePosthogException } from '@/lib/posthog';
import { makeErrorRef } from '@/crm/lib/errors';
import { ServerErrorScreen } from './ErrorScreens';

type State = { ref: string | null };

export class CrmErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { ref: null };

  static getDerivedStateFromError(): State { return { ref: makeErrorRef('500') }; }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    capturePosthogException(error, { yuno_ref: this.state.ref, surface: 'crm', component_stack: info.componentStack?.slice(0, 600) });
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.ref && prev.resetKey !== this.props.resetKey) this.setState({ ref: null });
  }

  render() {
    if (this.state.ref) return <ServerErrorScreen code={this.state.ref} onReload={() => window.location.reload()} />;
    return this.props.children;
  }
}
