/**
 * Appel d'une RPC de la Console CRM. Les fonctions `crm_*` récentes ne sont
 * pas toutes dans les types générés : on type la RÉPONSE à l'appel, et une
 * erreur PostgREST devient une exception (react-query l'attrape).
 */
import { supabase } from '@/integrations/supabase/client';

type LooseRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
}>;

export class CrmRpcError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const call = supabase.rpc.bind(supabase) as unknown as LooseRpc;
  const { data, error } = await call(fn, args);
  if (error) throw new CrmRpcError(error.message, error.code);
  return data as T;
}
