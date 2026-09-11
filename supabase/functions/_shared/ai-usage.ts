// ─── Suivi de consommation IA ───────────────────────────────────────────────
// Une ligne dans `ai_usage_events` par appel OpenAI (chat, tool round, stream,
// embedding, traduction). Lu par le super admin via `admin_ai_usage()`.
//
// Règle d'or : ce module ne DOIT jamais faire échouer ni ralentir la réponse.
// Toute écriture est fire-and-forget, avalée en cas d'erreur, et gardée en vie
// après la réponse par `EdgeRuntime.waitUntil` quand il existe.

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export type AiAssistant =
  | 'client'        // yuno-assistant (chat)
  | 'client_search' // yuno-assistant action semantic_search (embedding)
  | 'owner'         // owner-assistant (chat + tools)
  | 'owner_content' // owner-assistant generate_marketing_content
  | 'owner_report'  // owner-assistant generate_night_report
  | 'owner_actions' // owner-assistant generate_next_best_actions
  | 'agency'        // agency-assistant
  | 'translate'     // translate-text
  | 'embeddings';   // event / dj / taste embeddings (batch)

export interface AiUsageEvent {
  assistant: AiAssistant;
  model: string;
  userId?: string | null;
  userEmail?: string | null;
  venueId?: string | null;
  agencyId?: string | null;
  language?: string | null;
  status?: 'ok' | 'error' | 'rate_limited' | 'unavailable';
  error?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  rounds?: number | null;
  toolCalls?: string[] | null;
  /** Nombre de messages de la conversation envoyés (profondeur du fil). */
  turnCount?: number | null;
  promptChars?: number | null;
  completionChars?: number | null;
  /** Dernière question de l'utilisateur, tronquée — sert à comprendre ce que
   *  les gens demandent. Jamais la réponse complète. */
  promptPreview?: string | null;
}

// Tarifs publics OpenAI en USD par million de tokens (entrée / sortie).
// Mis à jour à la main : une ligne manquante donne un coût 0, jamais une erreur.
const PRICES_USD_PER_M: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40 },
  'gpt-4.1': { in: 2, out: 8 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, out: 0 },
};

export function estimateCostUsd(model: string, promptTokens = 0, completionTokens = 0): number {
  const base = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const p = PRICES_USD_PER_M[model] ?? PRICES_USD_PER_M[base];
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

export function previewOf(text: unknown, max = 240): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Dernier message utilisateur d'un fil chat (le format OpenAI). */
export function lastUserPrompt(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown } | null;
    if (m && m.role === 'user' && typeof m.content === 'string') return previewOf(m.content);
  }
  return null;
}

export function messagesChars(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((n: number, m) => {
    const c = (m as { content?: unknown } | null)?.content;
    return n + (typeof c === 'string' ? c.length : 0);
  }, 0);
}

function keepAlive(p: Promise<unknown>) {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

/** Écrit l'événement. N'attend pas, ne lève jamais. */
export function logAiUsage(supabase: AnyClient, ev: AiUsageEvent): void {
  try {
    const promptTokens = ev.promptTokens ?? null;
    const completionTokens = ev.completionTokens ?? null;
    const row = {
      assistant: ev.assistant,
      model: ev.model,
      user_id: ev.userId ?? null,
      user_email: ev.userEmail ?? null,
      venue_id: ev.venueId ?? null,
      agency_id: ev.agencyId ?? null,
      language: ev.language ?? null,
      status: ev.status ?? 'ok',
      error: ev.error ? String(ev.error).slice(0, 500) : null,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens === null && completionTokens === null ? null : (promptTokens ?? 0) + (completionTokens ?? 0),
      cost_usd: estimateCostUsd(ev.model, promptTokens ?? 0, completionTokens ?? 0),
      latency_ms: ev.latencyMs ?? null,
      rounds: ev.rounds ?? null,
      tool_calls: ev.toolCalls ?? null,
      turn_count: ev.turnCount ?? null,
      prompt_chars: ev.promptChars ?? null,
      completion_chars: ev.completionChars ?? null,
      prompt_preview: ev.promptPreview ?? null,
    };
    const p = Promise.resolve(supabase.from('ai_usage_events').insert(row))
      .then((r: { error?: { message?: string } | null }) => {
        if (r?.error) console.warn('ai_usage_events insert failed:', r.error.message);
      })
      .catch((e: unknown) => console.warn('ai_usage_events insert threw:', e instanceof Error ? e.message : e));
    keepAlive(p);
  } catch (e) {
    console.warn('logAiUsage failed:', e instanceof Error ? e.message : e);
  }
}

export interface OpenAiUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }

/** Additionne les `usage` de plusieurs réponses (boucle de tools). */
export function sumUsage(...parts: Array<OpenAiUsage | null | undefined>): { promptTokens: number; completionTokens: number } {
  let promptTokens = 0, completionTokens = 0;
  for (const u of parts) {
    if (!u) continue;
    promptTokens += Number(u.prompt_tokens || 0);
    completionTokens += Number(u.completion_tokens || 0);
  }
  return { promptTokens, completionTokens };
}

/**
 * Enveloppe un flux SSE OpenAI (`stream: true` + `stream_options.include_usage`)
 * pour en extraire le `usage` du dernier chunk et la taille du texte produit,
 * puis journalise à la fin du flux. Le flux rendu au client est identique
 * octet pour octet.
 *
 * `base` porte tout ce qu'on sait déjà (assistant, modèle, utilisateur…) ;
 * `priorUsage` les tokens déjà consommés avant ce flux (tours de tools).
 */
export function trackOpenAiStream(
  body: ReadableStream<Uint8Array> | null,
  supabase: AnyClient,
  base: AiUsageEvent,
  opts: { startedAt: number; priorUsage?: { promptTokens: number; completionTokens: number } },
): ReadableStream<Uint8Array> | null {
  if (!body) return body;
  const decoder = new TextDecoder();
  let pending = '';
  let usage: OpenAiUsage | null = null;
  let completionChars = 0;
  let done = false;

  const finish = (status: AiUsageEvent['status']) => {
    if (done) return;
    done = true;
    const u = sumUsage(usage, opts.priorUsage
      ? { prompt_tokens: opts.priorUsage.promptTokens, completion_tokens: opts.priorUsage.completionTokens }
      : null);
    logAiUsage(supabase, {
      ...base,
      status,
      promptTokens: usage || opts.priorUsage ? u.promptTokens : null,
      completionTokens: usage || opts.priorUsage ? u.completionTokens : null,
      completionChars,
      latencyMs: Date.now() - opts.startedAt,
    });
  };

  const scan = (text: string) => {
    pending += text;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const chunk = JSON.parse(json);
        if (chunk?.usage) usage = chunk.usage;
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') completionChars += delta.length;
      } catch { /* chunk partiel ou non JSON : on ignore */ }
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      try { scan(decoder.decode(chunk, { stream: true })); } catch { /* jamais bloquant */ }
    },
    flush() {
      try { scan(decoder.decode()); } catch { /* idem */ }
      finish('ok');
    },
    // Un client qui coupe (fermeture de l'app) annule le flux : on journalise
    // quand même ce qu'on sait, sinon la conversation disparaît des compteurs.
    cancel() { finish('ok'); },
  } as Transformer<Uint8Array, Uint8Array> & { cancel?: () => void });

  return body.pipeThrough(transform);
}
