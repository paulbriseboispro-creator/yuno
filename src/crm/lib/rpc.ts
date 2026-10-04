/**
 * Appel d'une RPC de la Console CRM. Les fonctions `crm_*` récentes ne sont
 * pas toutes dans les types générés : on type la RÉPONSE à l'appel, et une
 * erreur PostgREST devient une exception (react-query l'attrape).
 */
import { supabase } from '@/integrations/supabase/client';
import { CRM_RPC_TIMEOUT_MS } from './errors';

type RpcResult = PromiseLike<{
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
}>;
type LooseRpc = (fn: string, args?: Record<string, unknown>) => RpcResult & { abortSignal: (s: AbortSignal) => RpcResult };

export class CrmRpcError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Au-delà de `timeoutMs` (30 s par défaut), l'appel est abandonné : code `timeout`. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<T> {
  const call = supabase.rpc.bind(supabase) as unknown as LooseRpc;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? CRM_RPC_TIMEOUT_MS);
  try {
    const { data, error } = await call(fn, args).abortSignal(ctrl.signal);
    if (ctrl.signal.aborted) throw new CrmRpcError('timeout', 'timeout');
    if (error) throw new CrmRpcError(error.message, error.code);
    return data as T;
  } catch (e) {
    if (ctrl.signal.aborted && !(e instanceof CrmRpcError && e.code === 'timeout')) throw new CrmRpcError('timeout', 'timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
