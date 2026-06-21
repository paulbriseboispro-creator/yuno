import { Component, type ReactNode } from "react";
import { purgeServiceWorkersAndReload } from "@/lib/swRecovery";
import { translations } from "@/i18n/data";

// Class component → no hooks. Resolve i18n from the persisted language the same
// way LanguageContext's out-of-provider fallback does, so the crash screen is
// localized (EN/FR/ES) instead of hardcoded French.
function tr(key: string): string {
  let lang = "en";
  try { lang = localStorage.getItem("language") || "en"; } catch { /* storage denied */ }
  return (translations as Record<string, Record<string, string>>)[lang]?.[key]
    ?? translations["en"]?.[key] ?? key;
}

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
            <p className="text-lg font-semibold text-white">{tr('errBoundary.chunkTitle')}</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {tr('errBoundary.chunkDesc')}
            </p>
            <button
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
              onClick={() => { void purgeServiceWorkersAndReload(); }}
            >
              {tr('errBoundary.reload')}
            </button>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center">
          <p className="text-lg font-semibold text-white">{tr('errBoundary.title')}</p>
          <button
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
            onClick={() => this.setState({ hasError: false, isChunkError: false })}
          >
            {tr('errBoundary.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
