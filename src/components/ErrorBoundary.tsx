import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKeys?: unknown[];
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Importing a module script failed') ||
    error.message.includes('error loading dynamically imported module') ||
    error.message.includes('Unable to preload CSS for')
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, isChunkError: isChunkLoadError(error) };
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      prevProps.resetKeys &&
      this.props.resetKeys &&
      prevProps.resetKeys.some((k, i) => k !== this.props.resetKeys![i])
    ) {
      this.setState({ hasError: false, isChunkError: false });
    }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      if (this.state.isChunkError) {
        return (
          <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center">
            <p className="text-lg font-semibold text-white">Erreur de chargement</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Une ressource n'a pas pu être chargée. Recharge la page pour continuer.
            </p>
            <button
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
              onClick={() => window.location.reload()}
            >
              Recharger
            </button>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center">
          <p className="text-lg font-semibold text-white">Une erreur est survenue.</p>
          <button
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
            onClick={() => this.setState({ hasError: false, isChunkError: false })}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
