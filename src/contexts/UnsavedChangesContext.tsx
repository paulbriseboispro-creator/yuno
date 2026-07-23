import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Garde « modifications non enregistrées » — globale à toute l'app pro.
 *
 * Trois filets, du plus discret au plus explicite :
 *
 * 1. Le brouillon local (src/lib/formDraft.ts, câblé par useUnsavedGuard) :
 *    on peut basculer sur l'Instagram du club, verrouiller le téléphone, se
 *    faire tuer la PWA par iOS — au retour le formulaire est intact.
 * 2. `beforeunload` : fermeture d'onglet, rechargement, saisie d'une autre URL.
 *    C'est le navigateur qui affiche son propre avertissement — on ne peut ni
 *    le styler ni le déclencher sans interaction préalable, d'où le point 3.
 * 3. Interception de la navigation interne : lien de la sidebar, bouton retour
 *    d'une page, bouton « Annuler ». On ouvre notre propre dialogue avec un
 *    vrai choix : enregistrer et quitter, rester, quitter quand même.
 *
 * Le point 3 s'appuie sur une écoute de clic en phase de CAPTURE au niveau du
 * document : les `<Link>` de react-router rendent de vrais `<a href>`, donc
 * couper l'événement avant qu'il n'atteigne sa cible bloque toute la navigation
 * par lien sans toucher une ligne des composants de navigation.
 *
 * La navigation programmatique (`navigate('/…')` derrière un `<button>`) ne
 * passe pas par un lien : les pages utilisent `guardedNavigate`, retourné par
 * useUnsavedGuard.
 *
 * NB : le routeur de l'app est un `BrowserRouter` (pas un data router), donc
 * `useBlocker` de react-router n'est pas disponible. Le retour navigateur n'est
 * volontairement pas intercepté — bidouiller l'historique casserait plus qu'il
 * ne protège. C'est le brouillon local qui couvre ce cas : on revient, tout est là.
 */

export type UnsavedEntry = {
  /** Identifiant stable du formulaire (unique par page, ou par section de page). */
  key: string;
  /** Libellé humain de la section — affiché dans la barre et le dialogue. */
  label: string;
  isDirty: boolean;
  /** Enregistre. Retourner `false` (ou lever) signale un échec : on ne quitte pas. */
  save?: () => Promise<boolean | void> | boolean | void;
  /** Rétablit les valeurs enregistrées et supprime le brouillon. */
  discard?: () => void;
  /** Supprime le brouillon local sans toucher à l'état affiché. */
  dropDraft?: () => void;
};

type ContextValue = {
  register: (entry: UnsavedEntry) => void;
  unregister: (key: string) => void;
  /** Exécute `run` — après confirmation s'il reste des modifications non enregistrées. */
  requestLeave: (run: () => void) => void;
  dirtyEntries: UnsavedEntry[];
};

const UnsavedChangesContext = createContext<ContextValue | undefined>(undefined);

export function useUnsavedChanges(): ContextValue {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    // Hors provider (HMR, test, composant monté à part) : la garde devient un
    // passe-plat. Un formulaire sans garde reste un formulaire qui marche.
    return {
      register: () => {},
      unregister: () => {},
      requestLeave: (run: () => void) => run(),
      dirtyEntries: [],
    };
  }
  return ctx;
}

// ─── Interception des liens ───────────────────────────────────────────────────

/**
 * Ce clic déclenche-t-il une navigation interne (SPA) ?
 * On laisse filer tout le reste : nouvel onglet, téléchargement, ancre, autre
 * origine, protocole non http — pour ces cas c'est `beforeunload` qui protège.
 */
function inAppTarget(anchor: HTMLAnchorElement, event: MouseEvent): string | null {
  if (event.defaultPrevented) return null;
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;

  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Même page : rien à perdre.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<UnsavedEntry[]>([]);
  // Miroir synchrone : `beforeunload` et l'écoute de clic lisent l'état sans
  // dépendre du cycle de rendu React — un handler natif capturerait sinon une
  // valeur périmée entre deux rendus.
  const entriesRef = useRef<UnsavedEntry[]>([]);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const register = useCallback((entry: UnsavedEntry) => {
    setEntries((prev) => {
      const i = prev.findIndex((e) => e.key === entry.key);
      const next = i === -1 ? [...prev, entry] : prev.map((e) => (e.key === entry.key ? entry : e));
      entriesRef.current = next;
      return next;
    });
  }, []);

  const unregister = useCallback((key: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.key !== key);
      entriesRef.current = next;
      return next;
    });
  }, []);

  const dirtyEntries = useMemo(() => entries.filter((e) => e.isDirty), [entries]);

  const requestLeave = useCallback((run: () => void) => {
    if (entriesRef.current.some((e) => e.isDirty)) setPending(() => run);
    else run();
  }, []);

  // 1) Fermeture d'onglet / rechargement / URL externe.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!entriesRef.current.some((entry) => entry.isDirty)) return;
      e.preventDefault();
      // Les navigateurs modernes ignorent le texte et affichent le leur, mais
      // `returnValue` reste nécessaire pour que l'avertissement apparaisse.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // 2) Navigation interne par lien (sidebar, header, cartes…).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!entriesRef.current.some((entry) => entry.isDirty)) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const to = inAppTarget(anchor, e);
      if (!to) return;

      // Capture + stopPropagation : react-router n'entend jamais ce clic, donc
      // la navigation n'a pas lieu tant qu'on ne la rejoue pas nous-mêmes.
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => navigate(to));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);

  const value = useMemo<ContextValue>(
    () => ({ register, unregister, requestLeave, dirtyEntries }),
    [register, unregister, requestLeave, dirtyEntries],
  );

  /** Exécute la navigation mise en attente. `abandon` = on jette les brouillons. */
  const runPending = useCallback((abandon: boolean) => {
    const run = pending;
    setPending(null);
    if (!run) return;
    if (abandon) entriesRef.current.forEach((entry) => entry.dropDraft?.());
    // Le registre est vidé avant de partir : sinon `beforeunload` se
    // redéclencherait sur une navigation qu'on vient justement d'autoriser.
    entriesRef.current = [];
    setEntries([]);
    run();
  }, [pending]);

  const saveThenLeave = useCallback(async () => {
    setBusy(true);
    try {
      for (const entry of entriesRef.current.filter((e) => e.isDirty)) {
        const ok = await entry.save?.();
        if (ok === false) { setBusy(false); return; } // échec : on reste sur la page
      }
    } catch {
      setBusy(false);
      return; // la page a déjà affiché son propre message d'erreur
    }
    setBusy(false);
    runPending(false);
  }, [runPending]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <UnsavedChangesUI
        dirtyEntries={dirtyEntries}
        promptOpen={pending !== null}
        busy={busy}
        onStay={() => setPending(null)}
        onLeaveAnyway={() => runPending(true)}
        onSaveThenLeave={saveThenLeave}
      />
    </UnsavedChangesContext.Provider>
  );
}

// ─── UI : barre persistante + dialogue de confirmation ────────────────────────

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const BORDER = 'rgba(255,255,255,0.10)';
const RED = '#E8192C';
const PANEL = 'linear-gradient(180deg,rgba(255,255,255,.05) 0%,rgba(255,255,255,.01) 100%),#0b0b0d';

function UnsavedChangesUI({
  dirtyEntries, promptOpen, busy, onStay, onLeaveAnyway, onSaveThenLeave,
}: {
  dirtyEntries: UnsavedEntry[];
  promptOpen: boolean;
  busy: boolean;
  onStay: () => void;
  onLeaveAnyway: () => void;
  onSaveThenLeave: () => void;
}) {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const entry of dirtyEntries) await entry.save?.();
    } catch { /* la page affiche son propre message d'erreur */ }
    finally { setSaving(false); }
  };

  const discardAll = () => dirtyEntries.forEach((entry) => entry.discard?.());

  // Échap = rester : le geste réflexe ne doit jamais faire perdre le travail.
  useEffect(() => {
    if (!promptOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onStay(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promptOpen, onStay]);

  if (dirtyEntries.length === 0 && !promptOpen) return null;

  const sections = dirtyEntries.map((e) => e.label).filter(Boolean);
  const canSave = dirtyEntries.some((e) => e.save);

  return (
    <>
      {dirtyEntries.length > 0 && (
        <div
          role="status"
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100001,
            padding: '10px max(12px, env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-right))',
            background: 'linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.75) 45%,rgba(0,0,0,.92) 100%)',
            pointerEvents: 'none',
          }}
        >
          <div
            className="mx-auto flex items-center gap-3"
            style={{
              maxWidth: 760, pointerEvents: 'auto',
              background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14,
              boxShadow: '0 18px 40px -18px rgba(0,0,0,.95)', padding: '10px 12px',
            }}
          >
            <span
              className="flex-none inline-flex items-center justify-center rounded-lg"
              style={{ width: 28, height: 28, background: 'rgba(232,25,44,.12)', border: '1px solid rgba(232,25,44,.24)', color: RED }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p style={{ color: T1, fontSize: 13, fontWeight: 600, margin: 0 }}>{t('unsaved.barTitle')}</p>
              <p style={{ color: T2, fontSize: 11.5, margin: 0 }} className="truncate">
                {sections.length > 0 ? sections.join(' · ') : t('unsaved.barHint')}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-none">
              <button
                type="button"
                onClick={discardAll}
                style={{
                  height: 32, padding: '0 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 500,
                  color: T2, background: 'transparent', border: `1px solid ${BORDER}`, cursor: 'pointer',
                }}
              >
                {t('unsaved.discard')}
              </button>
              {canSave && (
                <button
                  type="button"
                  onClick={saveAll}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5"
                  style={{
                    height: 32, padding: '0 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600,
                    color: '#fff', background: RED, border: '1px solid transparent',
                    cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('unsaved.save')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {promptOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 flex items-end sm:items-center justify-center"
          style={{ zIndex: 100002, background: 'rgba(0,0,0,.66)', backdropFilter: 'blur(6px)', padding: 16 }}
          onClick={onStay}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420, background: PANEL, border: `1px solid ${BORDER}`,
              borderRadius: 18, padding: 20, boxShadow: '0 30px 70px -25px rgba(0,0,0,1)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className="flex-none inline-flex items-center justify-center rounded-xl"
                style={{ width: 34, height: 34, background: 'rgba(232,25,44,.12)', border: '1px solid rgba(232,25,44,.24)', color: RED }}
              >
                <AlertTriangle className="h-4 w-4" />
              </span>
              <h2 style={{ color: T1, fontSize: 16, fontWeight: 650, letterSpacing: '-0.01em', margin: 0 }}>
                {t('unsaved.promptTitle')}
              </h2>
            </div>
            <p style={{ color: T2, fontSize: 13, lineHeight: 1.55, margin: '0 0 16px' }}>
              {t('unsaved.promptBody')}
            </p>
            <div className="flex flex-col gap-2">
              {canSave && (
                <button
                  type="button"
                  onClick={onSaveThenLeave}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2"
                  style={{
                    height: 42, borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: '#fff',
                    background: RED, border: '1px solid transparent', cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('unsaved.saveAndLeave')}
                </button>
              )}
              <button
                type="button"
                onClick={onStay}
                style={{
                  height: 42, borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: T1,
                  background: 'rgba(255,255,255,.06)', border: `1px solid ${BORDER}`, cursor: 'pointer',
                }}
              >
                {t('unsaved.stay')}
              </button>
              <button
                type="button"
                onClick={onLeaveAnyway}
                style={{
                  height: 38, borderRadius: 11, fontSize: 12.5, fontWeight: 500, color: T2,
                  background: 'transparent', border: '1px solid transparent', cursor: 'pointer',
                }}
              >
                {t('unsaved.leaveAnyway')}
              </button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.30)', fontSize: 11, lineHeight: 1.5, margin: '12px 0 0', textAlign: 'center' }}>
              {t('unsaved.draftNote')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
