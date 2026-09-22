/**
 * Un champ « fichier » de formulaire de soirée, dont l'envoi voyage pendant que
 * le pro remplit le reste.
 *
 * Le hook tient ensemble le fichier choisi et son envoi : choisir remplace
 * l'envoi précédent (et supprime ce qui était déjà parti), publier attend la
 * promesse — presque toujours déjà tenue —, fermer le formulaire nettoie.
 *
 * `settle()` LÈVE quand l'envoi a échoué : c'est ce qui permet à l'appelant
 * d'annuler l'enregistrement plutôt que de persister une soirée qui annonce un
 * média qu'elle n'a pas.
 */
import { useCallback, useRef, useState } from 'react';
import type { DeferredUpload } from '@/lib/deferredUpload';

export type DeferredMedia = {
  file: File | null;
  /** Choisit un fichier (ou le retire) et lance/annule son envoi. */
  pick: (file: File | null) => void;
  /** URL publique, `null` si aucun fichier choisi. Lève si l'envoi a échoué. */
  settle: () => Promise<string | null>;
  /** Le fichier a servi : ne rien supprimer. */
  commit: () => void;
  /** Formulaire abandonné : retirer du bucket ce qui était déjà parti. */
  reset: () => void;
  /** L'envoi est-il encore en vol ? */
  uploading: boolean;
};

export function useDeferredMedia(start: (file: File) => DeferredUpload): DeferredMedia {
  // `start` referme sur des valeurs du rendu (id du compte, type de média) :
  // on garde toujours la dernière version, jamais celle du premier rendu.
  const startRef = useRef(start);
  startRef.current = start;

  const uploadRef = useRef<DeferredUpload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const pick = useCallback((next: File | null) => {
    uploadRef.current?.discard();
    uploadRef.current = null;
    setFile(next);
    if (!next) { setUploading(false); return; }
    const upload = startRef.current(next);
    uploadRef.current = upload;
    setUploading(true);
    void upload.result.then(() => {
      // Un envoi plus récent a pu prendre la place entre-temps.
      if (uploadRef.current === upload) setUploading(false);
    });
  }, []);

  const settle = useCallback(async () => {
    const upload = uploadRef.current;
    if (!upload) return null;
    const res = await upload.result;
    if ('error' in res) throw new Error(res.error);
    return res.url;
  }, []);

  const commit = useCallback(() => {
    uploadRef.current?.keep();
    uploadRef.current = null;
    setFile(null);
    setUploading(false);
  }, []);

  const reset = useCallback(() => {
    uploadRef.current?.discard();
    uploadRef.current = null;
    setFile(null);
    setUploading(false);
  }, []);

  return { file, pick, settle, commit, reset, uploading };
}
