/**
 * Le guide « Premiers pas » de la Console CRM : son état et ses gestes, pour
 * toute la coquille (docs/designs/CRM_FIRST_STEPS_PLAN.md).
 *
 *   carte de l'Accueil · entrée du menu · volet · carte d'aide sur la page d'une
 *   étape · carte de Compte › Aide
 *
 * L'avancement vient de crm_first_steps (relu dans la base, jamais coché sur un
 * clic). Ici : quand le guide se montre, l'étape suivie de page en page (une
 * clé de session, `yuno.crm.fs.coach`), le toast quand la base voit une étape
 * faite, masquer / reporter / reprendre / terminer. En aperçu démo, en accès
 * assisté et sur un compte démo, rien ne s'enregistre : la préférence ne vit
 * que dans l'onglet (Yuno ne masque jamais le guide à la place du pro).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { isSupportSessionActive } from '@/lib/supportSession';
import { isDemoEmail } from '@/lib/demoPlan';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useCrmT } from '@/crm/i18n';
import { useCrmToast } from '@/crm/ui/toast';
import { setFirstStepsPref, useFirstStepsQuery, type FirstStepsAction, type FirstStepsPref } from '@/crm/data/firstSteps';
import {
  allCoreDone, autoShow, buildSteps, canOpenGuide, isDone, nextStep, progressOf, stepAfter,
  type FirstStepKey, type FirstStepsData, type GuideStep,
} from '@/crm/lib/firstSteps';

const COACH_KEY = 'yuno.crm.fs.coach';
const seenKey = (scope: string) => `yuno.crm.fs.seen.${scope}`;

export interface GuideValue {
  data: FirstStepsData;
  steps: GuideStep[];
  progress: { done: number; total: number };
  next: GuideStep | null;
  complete: boolean;
  /** Carte de l'Accueil et entrée du menu (le titulaire, compte récent, ni masqué ni reporté). */
  auto: boolean;
  passive: boolean;
  holderName: string | null;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** L'étape suivie de page en page (carte d'aide), ou null. */
  coach: FirstStepKey | null;
  go: (step: GuideStep) => void;
  stopCoach: () => void;
  act: (a: FirstStepsAction) => void;
  stepAfter: (key: FirstStepKey) => GuideStep | null;
}

const Ctx = createContext<GuideValue | null>(null);

/** Le guide, ou null (hors de la coquille, lecteur, fonction pas encore en base). */
export function useGuide(): GuideValue | null {
  return useContext(Ctx);
}

function readCoach(scope: string): FirstStepKey | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(COACH_KEY) || 'null') as { scope?: string; key?: FirstStepKey } | null;
    return v && v.scope === scope && v.key ? v.key : null;
  } catch { return null; }
}

function writeCoach(scope: string, key: FirstStepKey | null) {
  try {
    if (key) sessionStorage.setItem(COACH_KEY, JSON.stringify({ scope, key }));
    else sessionStorage.removeItem(COACH_KEY);
  } catch { /* mode privé : la carte d'aide tient pour la page */ }
}

function readSeen(scope: string): FirstStepKey[] | null {
  try { return JSON.parse(localStorage.getItem(seenKey(scope)) || 'null') as FirstStepKey[] | null; } catch { return null; }
}

function writeSeen(scope: string, keys: FirstStepKey[]) {
  try { localStorage.setItem(seenKey(scope), JSON.stringify(keys)); } catch { /* sans gravité : un toast de plus ou de moins */ }
}

const TOMORROW_6H = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
};

export function GuideProvider({ children, chrome }: { children: ReactNode; chrome?: ReactNode }) {
  const { user } = useAuth();
  const { space, rpc: args, qk } = useCrmScope();
  const caps = useCrmCaps();
  const { t } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const holder = space.role === 'owner';
  const write = caps.write;
  const allowed = canOpenGuide({ holder, write });
  const passive = isPreviewActive() || isSupportSessionActive() || isDemoEmail(user?.email);

  const [coach, setCoach] = useState<FirstStepKey | null>(() => readCoach(space.key));
  const [panelOpen, setPanelOpen] = useState(false);
  // Préférence locale (aperçu, accès assisté, compte démo, ou serveur injoignable).
  const [localPref, setLocalPref] = useState<Partial<FirstStepsPref> | null>(null);

  useEffect(() => { setCoach(readCoach(space.key)); setLocalPref(null); }, [space.key]);

  const [poll, setPoll] = useState<number | false>(false);
  const q = useFirstStepsQuery({ enabled: allowed, pollMs: poll });
  const raw = q.data && q.data !== 'unavailable' ? q.data : null;
  const data = useMemo<FirstStepsData | null>(
    () => (raw ? { ...raw, pref: { ...raw.pref, ...(localPref ?? {}) } } : null),
    [raw, localPref],
  );

  const steps = useMemo(() => (data ? buildSteps(data, { holder, write }) : []), [data, holder, write]);

  // Sondage : seulement quand quelque chose est en train de se faire.
  useEffect(() => {
    const coached = coach ? steps.find((s) => s.key === coach) : null;
    if (coached && !isDone(coached)) setPoll(6000);
    else if (data?.steps.shotgun.state === 'importing') setPoll(20_000);
    else setPoll(false);
  }, [coach, steps, data?.steps.shotgun.state]);

  // Changer de page relit l'état s'il a plus de 10 s (une étape a pu se faire ailleurs).
  const updatedAt = q.dataUpdatedAt;
  useEffect(() => {
    if (allowed && updatedAt && Date.now() - updatedAt > 10_000) void q.refetch();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une étape que la base voit faite pour la première fois : un toast, une fois.
  const seenRef = useRef<FirstStepKey[] | null>(null);
  useEffect(() => {
    if (!data || passive) return;
    const doneNow = steps.filter(isDone).map((s) => s.key);
    const before = seenRef.current ?? readSeen(space.key);
    if (before) {
      const fresh = doneNow.filter((k) => !before.includes(k));
      // Sur la page de l'étape suivie, c'est la carte d'aide qui le dit.
      const shown = fresh.find((k) => k !== coach);
      if (shown) toast(t(`yc.fs.toast.${shown}`));
    }
    seenRef.current = doneNow;
    writeSeen(space.key, doneNow);
  }, [steps]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((step: GuideStep) => {
    writeCoach(space.key, step.key);
    setCoach(step.key);
    setPanelOpen(false);
    navigate(step.href);
  }, [navigate, space.key]);

  const stopCoach = useCallback(() => { writeCoach(space.key, null); setCoach(null); }, [space.key]);

  const act = useCallback((a: FirstStepsAction) => {
    const now = new Date().toISOString();
    const patch: Partial<FirstStepsPref> =
      a === 'dismiss' ? { dismissed_at: now, snoozed_until: null }
        : a === 'snooze' ? { snoozed_until: TOMORROW_6H(), dismissed_at: null }
          : a === 'finish' ? { finished_at: now }
            : { dismissed_at: null, snoozed_until: null, finished_at: null };
    setLocalPref((p) => ({ ...(p ?? {}), ...patch }));
    if (a === 'dismiss') toast(t('yc.fs.toast.dismissed'));
    if (a === 'snooze') toast(t('yc.fs.toast.snoozed'));
    if (a === 'resume') toast(t('yc.fs.toast.resumed'));
    if (a !== 'resume') setPanelOpen(false);
    if (passive) return;
    void setFirstStepsPref(args, a)
      .then((pref) => {
        qc.setQueryData(['crm', qk, 'first-steps'], (old: unknown) =>
          (old && old !== 'unavailable' ? { ...(old as FirstStepsData), pref } : old));
        setLocalPref(null);
      })
      .catch(() => { /* la préférence tient dans l'onglet : sans gravité */ });
  }, [args, qc, qk, passive, t, toast]);

  const value = useMemo<GuideValue | null>(() => {
    if (!data || !allowed) return null;
    return {
      data,
      steps,
      progress: progressOf(steps),
      next: nextStep(steps),
      complete: allCoreDone(steps),
      auto: autoShow(data, { holder, write, passive }),
      passive,
      holderName: data.holder.first_name,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      coach,
      go,
      stopCoach,
      act,
      stepAfter: (key) => stepAfter(steps, key),
    };
  }, [data, allowed, steps, holder, write, passive, panelOpen, coach, go, stopCoach, act]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {value && chrome}
    </Ctx.Provider>
  );
}
