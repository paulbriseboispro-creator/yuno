/**
 * Envoi différé — le fichier part vers le Storage dès qu'il est CHOISI, pas au
 * clic sur « Publier ».
 *
 * Pourquoi : une soirée porte jusqu'à 30 Mo de vidéo, plus une affiche et un
 * logo de lieu. Envoyés à l'enregistrement, ils sont seuls responsables du
 * temps d'attente — sur une connexion de salle de club, 30 Mo, c'est des
 * dizaines de secondes pendant lesquelles le pro regarde un bouton tourner
 * alors qu'il a fini de remplir son formulaire depuis longtemps. Envoyés au
 * choix du fichier, ils voyagent PENDANT qu'il remplit le reste, et le clic
 * final ne fait plus qu'attendre une promesse déjà tenue.
 *
 * Ce que l'ancien commentaire d'`EventVideoField` protégeait reste vrai : un
 * pro qui ferme le panneau sans enregistrer ne doit pas laisser 30 Mo orphelins
 * dans le bucket. C'est le rôle de `discard()` — appelé quand le fichier est
 * remplacé, retiré, ou quand le formulaire se referme sans publier. Il attend
 * la fin de l'envoi avant de supprimer : lancer le remove pendant l'upload
 * laisserait justement l'orphelin qu'on veut éviter.
 *
 * `result` ne rejette JAMAIS. Un envoi qui échoue rend `{ error }`, et c'est
 * l'appelant qui décide d'annuler l'enregistrement (oui pour la vidéo : une
 * soirée « avec vidéo » sans vidéo serait un mensonge silencieux).
 */
import { supabase } from '@/integrations/supabase/client';

export type DeferredUploadResult = { url: string } | { error: string };

export type DeferredUpload = {
  /** URL publique une fois l'envoi terminé, ou l'erreur. Ne rejette jamais. */
  readonly result: Promise<DeferredUploadResult>;
  /** L'envoi est-il déjà terminé ? Sert à savoir si le clic va devoir attendre. */
  done: () => boolean;
  /** Le fichier a servi : on ne le supprimera pas. */
  keep: () => void;
  /** Retire du bucket ce qui a été envoyé. Best effort, ne lève jamais. */
  discard: () => void;
};

export function startDeferredUpload(opts: {
  bucket: string;
  /** Chemin dans le bucket. Async car il dépend parfois de l'utilisateur connecté. */
  pathFor: () => string | Promise<string>;
  /** Le fichier, ou une préparation asynchrone (compression, recadrage). */
  file: File | Blob | Promise<File | Blob>;
  contentType?: string;
  cacheControl?: string;
}): DeferredUpload {
  const { bucket, pathFor, file, contentType, cacheControl } = opts;

  let settled = false;
  let kept = false;
  let uploadedPath: string | null = null;

  const result: Promise<DeferredUploadResult> = (async () => {
    try {
      const [path, blob] = await Promise.all([pathFor(), file]);
      const type = contentType || (blob instanceof File ? blob.type : '') || 'application/octet-stream';
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, blob, { upsert: false, contentType: type, ...(cacheControl ? { cacheControl } : {}) });
      if (error) return { error: error.message };
      uploadedPath = path;
      return { url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl };
    } catch (err) {
      return { error: (err as { message?: string })?.message || 'upload_failed' };
    } finally {
      settled = true;
    }
  })();

  return {
    result,
    done: () => settled,
    keep: () => { kept = true; },
    discard: () => {
      // Attendre la fin de l'envoi : supprimer pendant qu'il monte laisserait
      // l'orphelin que cette fonction existe pour éviter.
      void result.then(() => {
        if (kept || !uploadedPath) return;
        void supabase.storage.from(bucket).remove([uploadedPath]);
      });
    },
  };
}
