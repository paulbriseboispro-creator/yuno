// Le strict nécessaire d'un client Supabase pour appeler une RPC.
//
// Les modules partagés qui n'appellent qu'une RPC (charge-policy, coorg-stripe)
// prennent ce type plutôt qu'un SupabaseClient : les fonctions qui les importent
// ne sont pas toutes sur la même version de supabase-js, et un client
// structurel les accepte toutes. `data` arrive en `unknown` : chaque module le
// lit champ par champ, jamais en le supposant conforme.

export type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
