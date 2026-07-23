import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUnsavedChanges } from '@/contexts/UnsavedChangesContext';
import { clearDraft, draftKey, readDraft, stableStringify, writeDraft } from '@/lib/formDraft';

/**
 * Auto-save local + garde de sortie pour un formulaire pro.
 *
 * Un seul appel par formulaire (ou par section, pour une page qui enregistre
 * section par section comme la fiche club owner) :
 *
 * ```tsx
 * const { markSaved, guardedNavigate } = useUnsavedGuard({
 *   scope: `affiliate-venue:${id ?? 'new'}`,
 *   label: 'Fiche club',
 *   ready: !loadingData,
 *   value: form,
 *   onRestore: setForm,
 *   onSave: handleSave,
 * });
 * ```
 *
 * Ce que ça apporte, sans une ligne de JSX côté page :
 * - le formulaire est recopié dans localStorage à chaque frappe (débounce 600 ms,
 *   plus un flush immédiat dès que l'onglet passe en arrière-plan — c'est CE
 *   flush qui sauve la mise quand on bascule sur l'Instagram du club ou que iOS
 *   suspend la PWA) ;
 * - au remontage, le brouillon est réappliqué automatiquement ;
 * - la barre globale « modifications non enregistrées » apparaît, avec
 *   Enregistrer / Annuler branchés sur `onSave` et sur la valeur d'origine ;
 * - fermer l'onglet déclenche l'avertissement du navigateur, et toute navigation
 *   interne par lien ouvre le dialogue de confirmation.
 *
 * `markSaved()` est à appeler après CHAQUE enregistrement réussi : c'est ce qui
 * fixe la nouvelle référence et supprime le brouillon.
 */

type Options<T extends object> = {
  /** Identifiant stable du formulaire. Inclure l'id de l'entité : `affiliate-venue:<id|new>`. */
  scope: string;
  /** Libellé humain de la section (barre + dialogue). */
  label: string;
  /** `false` tant que les données serveur ne sont pas chargées : rien n'est comparé ni écrit. */
  ready: boolean;
  /** Valeurs courantes du formulaire (sérialisables). */
  value: T;
  /** Réapplique un jeu de valeurs (brouillon restauré, ou retour à l'état enregistré). */
  onRestore: (value: T) => void;
  /** Enregistrement. Retourner `false` signale un échec : la garde ne laisse pas partir. */
  onSave?: () => Promise<boolean | void> | boolean | void;
  /** Champs non sérialisables ou trop lourds (File, aperçu base64…) : ni comparés, ni persistés. */
  omit?: (keyof T)[];
  /** Désactive la garde (lecture seule, aperçu démo, collab en read-only…). */
  disabled?: boolean;
};

export function useUnsavedGuard<T extends object>({
  scope, label, ready, value, onRestore, onSave, omit, disabled = false,
}: Options<T>) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { register, unregister, requestLeave } = useUnsavedChanges();

  const storageKey = useMemo(() => draftKey(scope, user?.id), [scope, user?.id]);
  const omitKey = omit ? omit.join('|') : '';

  const strip = useCallback((v: T): T => {
    if (!omitKey) return v;
    const copy = { ...(v as Record<string, unknown>) };
    omitKey.split('|').forEach((k) => { delete copy[k]; });
    return copy as T;
  }, [omitKey]);

  const serialize = useCallback((v: T) => stableStringify(strip(v)), [strip]);

  /** Référence = dernier état connu comme enregistré côté serveur. */
  const [baseline, setBaseline] = useState<{ str: string; value: T } | null>(null);
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);

  // Miroirs pour les handlers natifs (pagehide/visibilitychange) et les
  // callbacks stables, qui ne doivent pas dépendre du rendu en cours.
  const valueRef = useRef(value);
  valueRef.current = value;
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  // Changement d'utilisateur ou d'entité (création → édition) : la référence
  // repart de zéro. Le brouillon d'une fiche ne doit jamais fuir sur une autre.
  const previousKey = useRef(storageKey);
  useEffect(() => {
    if (previousKey.current === storageKey) return;
    previousKey.current = storageKey;
    setBaseline(null);
    setDraftRestoredAt(null);
  }, [storageKey]);

  // Première fois que les données serveur sont là : on fige la référence, puis
  // on rejoue le brouillon s'il en reste un et qu'il dit autre chose.
  useEffect(() => {
    if (!ready || disabled || baseline) return;
    const current = valueRef.current;
    const str = serialize(current);
    setBaseline({ str, value: current });

    const draft = readDraft<Partial<T>>(storageKey);
    if (!draft) return;
    // Fusion : les champs volontairement exclus (fichiers, aperçus) gardent leur
    // valeur vivante, seuls les champs persistés sont réappliqués.
    const merged = { ...current, ...draft.data } as T;
    if (serialize(merged) === str) {
      clearDraft(storageKey); // brouillon identique à l'enregistré : du bruit
      return;
    }
    restoreRef.current(merged);
    setDraftRestoredAt(draft.at);
  }, [ready, disabled, baseline, storageKey, serialize]);

  const currentStr = baseline ? serialize(value) : '';
  const isDirty = !disabled && baseline !== null && currentStr !== baseline.str;

  // Écriture du brouillon (débounce). `wasDirty` évite de supprimer, au montage,
  // le brouillon qu'on vient tout juste de restaurer.
  const wasDirty = useRef(false);
  useEffect(() => {
    if (!baseline || disabled) return;
    if (isDirty) {
      wasDirty.current = true;
      const id = setTimeout(() => writeDraft(keyRef.current, strip(valueRef.current)), 600);
      return () => clearTimeout(id);
    }
    if (wasDirty.current) {
      wasDirty.current = false;
      clearDraft(keyRef.current);
    }
  }, [isDirty, currentStr, baseline, disabled, strip]);

  // Flush immédiat quand la page part en arrière-plan. Le débounce de 600 ms ne
  // survit pas à une suspension d'onglet : c'est ici que se joue le « je bascule
  // sur Instagram et je reviens ».
  useEffect(() => {
    if (!isDirty || disabled) return;
    const flush = () => writeDraft(keyRef.current, strip(valueRef.current));
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [isDirty, disabled, strip]);

  /** Nouvelle référence après un enregistrement réussi + brouillon supprimé. */
  const markSaved = useCallback((next?: T) => {
    const v = next ?? valueRef.current;
    setBaseline({ str: serialize(v), value: v });
    setDraftRestoredAt(null);
    wasDirty.current = false;
    clearDraft(keyRef.current);
  }, [serialize]);

  /** Retour à l'état enregistré + brouillon supprimé. */
  const discard = useCallback(() => {
    const b = baselineRef.current;
    if (b) restoreRef.current(b.value);
    setDraftRestoredAt(null);
    wasDirty.current = false;
    clearDraft(keyRef.current);
  }, []);

  const dropDraft = useCallback(() => {
    wasDirty.current = false;
    clearDraft(keyRef.current);
  }, []);

  // Inscription au registre global (barre + dialogue + beforeunload).
  const hasSave = Boolean(onSave);
  const save = useCallback(() => saveRef.current?.(), []);
  const entry = useMemo(() => ({
    key: storageKey,
    label,
    isDirty,
    save: hasSave ? save : undefined,
    discard,
    dropDraft,
  }), [storageKey, label, isDirty, hasSave, save, discard, dropDraft]);

  useEffect(() => {
    if (disabled) return;
    register(entry);
  }, [entry, disabled, register]);

  // Démontage (ou changement de clé) : on retire l'inscription précédente.
  useEffect(() => {
    const registered = storageKey;
    return () => unregister(registered);
  }, [storageKey, unregister]);

  /** Navigation interne qui respecte la garde (bouton retour, « Annuler »…). */
  const guardedNavigate = useCallback((to: To, options?: NavigateOptions) => {
    requestLeave(() => navigate(to, options));
  }, [requestLeave, navigate]);

  /** Variante générique : n'importe quelle action de sortie passée à la garde. */
  const guard = useCallback((run: () => void) => requestLeave(run), [requestLeave]);

  return { isDirty, draftRestoredAt, markSaved, discard, guardedNavigate, guard };
}
