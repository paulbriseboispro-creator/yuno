import { CameraOff, Settings, RefreshCw } from 'lucide-react';
import { isNative } from '@/lib/native';
import { openAppSettings } from '@/lib/cameraPermission';

interface Props {
  title: string;
  body: string;
  openSettingsLabel: string;
  retryLabel: string;
  /** Instruction navigateur, montrée uniquement sur le web (pas de deep-link Réglages). */
  webHint: string;
  /** true = permission refusée (propose « Ouvrir les Réglages » en natif) ; false = caméra indisponible → réessayer. */
  denied: boolean;
  onRetry: () => void;
  className?: string;
}

/**
 * Panneau plein-conteneur affiché à la place (ou par-dessus) du flux caméra
 * quand le scanner ne peut pas y accéder. Fond sombre neutre : se pose aussi
 * bien sur la boîte noire d'un scanner inline que sur le mode plein écran du
 * videur. Partagé par TOUS les scanners Pro (videur, barman, vestiaire,
 * promoteur, organisateur) pour un seul comportement de refus à maintenir.
 *
 * Le CTA « Ouvrir les Réglages » n'apparaît qu'en natif ET sur un refus : sur
 * le web il n'existe pas de deep-link fiable, on montre l'instruction à la
 * place. Un lien « Réessayer » reste toujours dispo pour re-sonder la caméra
 * après que l'utilisateur l'a réactivée dans les Réglages.
 */
export function CameraPermissionNotice({
  title,
  body,
  openSettingsLabel,
  retryLabel,
  webHint,
  denied,
  onRetry,
  className = '',
}: Props) {
  const showSettings = denied && isNative();

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 bg-black/85 px-6 py-8 text-center ${className}`}
      style={{ touchAction: 'manipulation' }}
    >
      <CameraOff className="h-8 w-8 text-white/70" />
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="max-w-xs text-sm leading-snug text-white/60">{body}</p>

      {showSettings ? (
        <>
          <button
            type="button"
            onClick={openAppSettings}
            className="mt-1 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black"
          >
            <Settings className="h-4 w-4" />
            {openSettingsLabel}
          </button>
          <button type="button" onClick={onRetry} className="text-xs text-white/45 underline underline-offset-2">
            {retryLabel}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black"
          >
            <RefreshCw className="h-4 w-4" />
            {retryLabel}
          </button>
          {denied && <p className="max-w-xs text-xs leading-snug text-white/45">{webHint}</p>}
        </>
      )}
    </div>
  );
}
