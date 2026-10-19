// Recherche web sur une structure qui vient de s'inscrire (club, organisateur,
// association), pour que Paul sache à qui il parle AVANT d'appeler.
//
// OpenAI Responses API + outil de recherche web, sources rendues avec la
// réponse. On ne donne que la structure (nom, ville, type), le nom de la
// personne et le domaine de son adresse quand ce n'est pas une messagerie
// grand public : jamais son téléphone ni son adresse e-mail.
//
// Le texte demandé est un objet JSON ; ce qui n'a pas été trouvé reste vide
// (la consigne interdit d'inventer, et chaque lien vient des sources).

const OPENAI_URL = 'https://api.openai.com/v1/responses';
export const RESEARCH_MODEL = 'gpt-4.1-mini';

export interface ResearchInput {
  name: string;
  city: string | null;
  country: string | null;
  kind: string;
  person: string | null;
  domain: string | null;
}

export interface OrgResearch {
  org_name: string;
  city: string | null;
  found: boolean;
  summary: string | null;
  type: string | null;
  instagram: { handle: string | null; url: string | null; followers: string | null } | null;
  website: string | null;
  ticketing: { platform: string | null; url: string | null } | null;
  recent_events: string[];
  audience: string | null;
  people: string[];
  call_angles: string[];
  red_flags: string[];
  confidence: 'high' | 'medium' | 'low';
  sources: Array<{ title: string | null; url: string }>;
  model: string;
  searched_at: string;
}

export interface ResearchRun {
  research: OrgResearch | null;
  error: string | null;
  usage: { input: number | null; output: number | null };
  latencyMs: number;
  model: string;
}

const SYSTEM = [
  "Tu prépares l'appel commercial de Paul, fondateur de Yuno (billetterie, réservation de tables VIP,",
  "guest list et CRM pour les clubs et les organisateurs de soirées).",
  "Une structure de la nuit vient de créer un compte. Cherche sur le web qui elle est : son Instagram,",
  "son site, sa billetterie (Shotgun, DICE, Weezevent, Billetweb, Eventbrite, Xceed, Fourvenues…), ses",
  "dernières soirées, sa taille, les personnes qui la mènent.",
  'Règles : n\'invente RIEN. Une information non trouvée reste null ou une liste vide. Ne recopie un',
  "nombre d'abonnés que si tu l'as lu. Plusieurs structures du même nom : dis-le dans red_flags et",
  "garde celle de la bonne ville. Rien de trouvé : found = false.",
  'Réponds en français, uniquement par un objet JSON, sans texte autour, de la forme :',
  '{"found": bool, "summary": "2 à 3 phrases", "type": "club | organisateur / collectif | bar |',
  'festival | association | autre", "instagram": {"handle": "@…", "url": "…", "followers": "12,4 k"} | null,',
  '"website": "…" | null, "ticketing": {"platform": "…", "url": "…"} | null, "recent_events": ["…"],',
  '"audience": "…" | null, "people": ["…"], "call_angles": ["2 ou 3 angles concrets pour l\'appel"],',
  '"red_flags": ["…"], "confidence": "high" | "medium" | "low", "sources": ["URL de chaque page lue"]}',
].join(' ');

function userPrompt(i: ResearchInput): string {
  const lines = [
    `Structure : « ${i.name} » (${i.kind})`,
    i.city ? `Ville : ${i.city}${i.country ? `, ${i.country}` : ''}` : (i.country ? `Pays : ${i.country}` : null),
    i.person ? `Personne qui a créé le compte : ${i.person}` : null,
    i.domain ? `Domaine de son adresse e-mail : ${i.domain}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

type ResponseItem = {
  type?: string;
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: Array<{ type?: string; url?: string; title?: string }>;
  }>;
};

function extract(json: { output?: ResponseItem[] }): { text: string; sources: Array<{ title: string | null; url: string }> } {
  let text = '';
  const sources: Array<{ title: string | null; url: string }> = [];
  const seen = new Set<string>();
  for (const item of json.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type !== 'output_text' || typeof c.text !== 'string') continue;
      text += c.text;
      for (const a of c.annotations ?? []) {
        if (a.type !== 'url_citation' || !a.url) continue;
        const url = a.url.replace(/[?&]utm_source=openai$/, '');
        if (seen.has(url)) continue;
        seen.add(url);
        sources.push({ title: a.title ?? null, url });
      }
    }
  }
  return { text, sources };
}

function str(v: unknown, max = 400): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}
function strList(v: unknown, n = 5): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, 300)).filter((x): x is string => !!x).slice(0, n) : [];
}
function url(v: unknown): string | null {
  const s = str(v, 500);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

/** Le premier objet JSON du texte, tolérant aux balises de code. */
export function parseResearchText(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function normalizeResearch(
  raw: Record<string, unknown>, input: ResearchInput,
  sources: Array<{ title: string | null; url: string }>, model: string,
): OrgResearch {
  const ig = raw.instagram && typeof raw.instagram === 'object' ? raw.instagram as Record<string, unknown> : null;
  const tk = raw.ticketing && typeof raw.ticketing === 'object' ? raw.ticketing as Record<string, unknown> : null;
  const conf = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low';
  const handle = str(ig?.handle, 60);
  const igUrl = url(ig?.url) ?? (handle ? `https://www.instagram.com/${handle.replace(/^@/, '')}/` : null);
  return {
    org_name: input.name,
    city: input.city,
    found: raw.found === true,
    summary: str(raw.summary, 700),
    type: str(raw.type, 60),
    instagram: handle || igUrl ? { handle, url: igUrl, followers: str(ig?.followers, 30) } : null,
    website: url(raw.website),
    ticketing: tk && (str(tk.platform, 40) || url(tk.url)) ? { platform: str(tk.platform, 40), url: url(tk.url) } : null,
    recent_events: strList(raw.recent_events, 4),
    audience: str(raw.audience, 200),
    people: strList(raw.people, 4),
    call_angles: strList(raw.call_angles, 3),
    red_flags: strList(raw.red_flags, 3),
    confidence: conf,
    // Les citations de l'API d'abord, puis les adresses que le modèle dit avoir lues
    // (une réponse en JSON pur n'emporte pas toujours ses citations).
    sources: [
      ...sources,
      ...strList(raw.sources, 8).filter((u) => /^https?:\/\//i.test(u) && !sources.some((x) => x.url === u))
        .map((u) => ({ title: null, url: u })),
    ].slice(0, 8),
    model,
    searched_at: new Date().toISOString(),
  };
}

/** Une recherche, 45 s au plus. Ne lève jamais. */
export async function researchOrg(input: ResearchInput, apiKey: string, timeoutMs = 45_000): Promise<ResearchRun> {
  const started = Date.now();
  const country = (input.country ?? 'FR').toUpperCase().slice(0, 2);
  // L'outil s'appelle `web_search` ; les comptes plus anciens n'ont que
  // `web_search_preview`. On essaie le premier, puis le second.
  for (const tool of ['web_search', 'web_search_preview']) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: RESEARCH_MODEL,
          tools: [{
            type: tool,
            search_context_size: 'medium',
            user_location: { type: 'approximate', country, ...(input.city ? { city: input.city } : {}) },
          }],
          tool_choice: 'auto',
          max_output_tokens: 1400,
          input: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userPrompt(input) },
          ],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String((json as { error?: { message?: string } })?.error?.message ?? res.status);
        if (tool === 'web_search' && /tool|web_search|not supported|invalid/i.test(msg)) continue;
        return { research: null, error: msg.slice(0, 300), usage: { input: null, output: null }, latencyMs: Date.now() - started, model: RESEARCH_MODEL };
      }
      const usage = (json as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {};
      const { text, sources } = extract(json as { output?: ResponseItem[] });
      const raw = parseResearchText(text);
      if (!raw) {
        return { research: null, error: 'unreadable_answer', usage: { input: usage.input_tokens ?? null, output: usage.output_tokens ?? null }, latencyMs: Date.now() - started, model: RESEARCH_MODEL };
      }
      return {
        research: normalizeResearch(raw, input, sources, RESEARCH_MODEL),
        error: null,
        usage: { input: usage.input_tokens ?? null, output: usage.output_tokens ?? null },
        latencyMs: Date.now() - started,
        model: RESEARCH_MODEL,
      };
    } catch (e) {
      return { research: null, error: e instanceof Error ? e.message.slice(0, 300) : 'error', usage: { input: null, output: null }, latencyMs: Date.now() - started, model: RESEARCH_MODEL };
    }
  }
  return { research: null, error: 'web_search_unavailable', usage: { input: null, output: null }, latencyMs: Date.now() - started, model: RESEARCH_MODEL };
}
