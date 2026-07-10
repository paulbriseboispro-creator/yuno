// Rafraîchissement des embeddings d'events (fondation pgvector des
// recommandations « Pour toi »). Appelé best-effort par le cron 5 min de
// process-scheduled-campaigns — même pattern que dispatchPushAutomations.
//
// Un embedding par event public à venir, invalidé par content_hash quand le
// contenu (titre, genres, venue, ville, description) change. Batch borné à
// 50 events par run, un seul appel OpenAI embeddings (input: string[]).

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_LIMIT = 50;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildContent(evt: {
  title: string;
  description: string | null;
  music_genres: string[] | null;
  music_genre: string | null;
  location_city: string | null;
  location_name: string | null;
}, venueName: string | null): string {
  const genres = (evt.music_genres && evt.music_genres.length ? evt.music_genres : [evt.music_genre]).filter(Boolean).join(", ");
  return [
    evt.title,
    genres,
    venueName || evt.location_name || "",
    evt.location_city || "",
    (evt.description || "").substring(0, 500),
  ].join(" | ");
}

export async function refreshEventEmbeddings(
  // deno-lint-ignore no-explicit-any
  admin: any,
  openaiKey: string,
): Promise<{ scanned: number; updated: number }> {
  // Events publics à venir — mêmes filtres que la RPC get_for_you_events.
  const { data: events } = await admin
    .from("events")
    .select("id, title, description, music_genres, music_genre, location_city, location_name, venue_id")
    .eq("is_active", true)
    .eq("visibility", "public")
    .eq("is_discoverable", true)
    .is("cancelled_at", null)
    .gte("start_at", new Date().toISOString())
    .limit(300);

  if (!events || events.length === 0) return { scanned: 0, updated: 0 };

  // Noms de venues en une requête séparée (l'embed events→venues est ambigu :
  // deux FK, venue_id et partner_venue_id).
  const venueIds = [...new Set(events.map((e: any) => e.venue_id).filter(Boolean))];
  const venueNames = new Map<string, string>();
  if (venueIds.length) {
    const { data: venues } = await admin.from("venues").select("id, name").in("id", venueIds);
    for (const v of venues || []) venueNames.set(v.id, v.name);
  }

  const { data: existing } = await admin
    .from("event_embeddings")
    .select("event_id, content_hash")
    .in("event_id", events.map((e: any) => e.id));
  const existingHashes = new Map<string, string>((existing || []).map((r: any) => [r.event_id, r.content_hash]));

  // Candidats : embedding manquant ou contenu modifié.
  const candidates: { id: string; content: string; hash: string }[] = [];
  for (const evt of events) {
    const content = buildContent(evt, evt.venue_id ? venueNames.get(evt.venue_id) || null : null);
    const hash = await sha256Hex(content);
    if (existingHashes.get(evt.id) !== hash) candidates.push({ id: evt.id, content, hash });
    if (candidates.length >= BATCH_LIMIT) break;
  }

  if (candidates.length === 0) return { scanned: events.length, updated: 0 };

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: candidates.map((c) => c.content),
    }),
  });
  if (!response.ok) {
    throw new Error(`Embeddings API error: ${response.status}`);
  }
  const result = await response.json();

  const rows = candidates.map((c, i) => ({
    event_id: c.id,
    embedding: result.data?.[i]?.embedding,
    content_hash: c.hash,
    model: EMBEDDING_MODEL,
    updated_at: new Date().toISOString(),
  })).filter((r) => Array.isArray(r.embedding));

  if (rows.length) {
    const { error } = await admin.from("event_embeddings").upsert(rows, { onConflict: "event_id" });
    if (error) throw new Error(`Embeddings upsert error: ${error.message}`);
  }

  return { scanned: events.length, updated: rows.length };
}
