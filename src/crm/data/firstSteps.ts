/**
 * Données du guide « Premiers pas » : l'état (crm_first_steps, une lecture qui
 * relit chaque étape dans la base) et la préférence d'affichage
 * (crm_first_steps_set). Tant que la fonction n'existe pas en base (front livré
 * avant la migration), le guide se tait : `unavailable`, jamais une erreur.
 */
import { useQuery } from '@tanstack/react-query';
import { CrmRpcError, rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { FirstStepsData } from '@/crm/lib/firstSteps';

export type FirstStepsAction = 'dismiss' | 'snooze' | 'resume' | 'finish';
export type FirstStepsPref = FirstStepsData['pref'];

/** Fonction absente du cache de schéma de PostgREST (migration pas encore jouée). */
const isMissingFunction = (e: unknown) =>
  e instanceof CrmRpcError && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message));

export function useFirstStepsQuery(opts: { enabled: boolean; pollMs: number | false }) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'first-steps'],
    enabled: opts.enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: opts.pollMs,
    retry: (n, e) => !isMissingFunction(e) && n < 1,
    queryFn: async (): Promise<FirstStepsData | 'unavailable'> => {
      try {
        return await rpc<FirstStepsData>('crm_first_steps', args);
      } catch (e) {
        if (isMissingFunction(e)) return 'unavailable';
        throw e;
      }
    },
  });
}

export function setFirstStepsPref(args: Record<string, unknown>, action: FirstStepsAction) {
  return rpc<FirstStepsPref>('crm_first_steps_set', { ...args, p_action: action });
}
