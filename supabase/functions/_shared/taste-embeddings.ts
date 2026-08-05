// Embedding du QUIZ de goût dans le MÊME espace que les events
// (text-embedding-3-small, 1536 dims). Rempli best-effort par le cron 5 min de
// process-scheduled-campaigns, invalidé par content_hash — même pattern que
// refreshEventEmbeddings. C'est ce vecteur qui règle le cold-start : un user
// sans aucun achat obtient quand même un vecteur de goût dès le quiz.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_LIMIT = 50;

// Dimensions comportementales du quiz → mots descriptifs pour enrichir le vecteur
// (le budget / format orientent vers des soirées premium vs abordables). À garder
// en phase avec les valeurs proposées dans OnboardingTasteQuiz.
const BUDGET_TEXT: Record<string, string> = {
  budget: "affordable, budget-friendly",
  mid: "mid-range spend",
  high: "premium spend",
  vip: "high budget, VIP, bottle service",
};
const BOOKING_TEXT: Record<string, string> = {
  tickets: "tickets, entry, dancefloor",
  tables: "VIP tables, bottle service, table service",
  both: "tickets and VIP tables",
};
const FREQ_TEXT: Record<string, string> = {
  low: "occasional nights out",
  weekly: "regular, weekly nights",
  often: "frequent nightlife",
  always: "every night, heavy nightlife",
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function embed(inputs: string[], openaiKey: string): Promise<(number[] | undefined)[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });
  if (!response.ok) throw new Error(`Embeddings API error: ${response.status}`);
  const result = (await response.json()) as { data?: { embedding?: number[] }[] };
  return inputs.map((_, i) => result.data?.[i]?.embedding);
}

function buildTasteContent(
  genres: string[] | null,
  budget: string | null,
  bookingPref: string | null,
  frequency: string | null,
  musicStyle: string | null,
): string {
  // Priorité aux libellés réels du nouveau quiz ; repli sur l'ancien music_style
  // (codes CSV) pour les profils pré-refonte. Le genre reste le signal dominant.
  const g = (genres && genres.length ? genres.join(", ") : (musicStyle || "")).trim();
  const extras = [
    budget ? (BUDGET_TEXT[budget] || "") : "",
    bookingPref ? (BOOKING_TEXT[bookingPref] || "") : "",
    frequency ? (FREQ_TEXT[frequency] || "") : "",
  ].filter(Boolean).join(", ");
  return [g, extras].filter(Boolean).join(" | ");
}

interface TasteRow {
  user_id: string;
  genres: string[] | null;
  budget: string | null;
  booking_pref: string | null;
  frequency: string | null;
  music_style: string | null;
  taste_content_hash: string | null;
}

export async function refreshTasteEmbeddings(
  admin: SupabaseClient,
  openaiKey: string,
): Promise<{ scanned: number; updated: number }> {
  const { data: rows } = await admin
    .from("user_taste_profiles")
    .select("user_id, genres, budget, booking_pref, frequency, music_style, taste_content_hash")
    .limit(200);
  const list = (rows ?? []) as TasteRow[];
  if (!list.length) return { scanned: 0, updated: 0 };

  const candidates: { userId: string; content: string; hash: string }[] = [];
  for (const r of list) {
    const content = buildTasteContent(r.genres, r.budget, r.booking_pref, r.frequency, r.music_style);
    if (!content.trim()) continue; // ni genres ni énergie ni ancien music_style
    const hash = await sha256Hex(content);
    if (r.taste_content_hash !== hash) candidates.push({ userId: r.user_id, content, hash });
    if (candidates.length >= BATCH_LIMIT) break;
  }

  if (!candidates.length) return { scanned: list.length, updated: 0 };

  const vectors = await embed(candidates.map((c) => c.content), openaiKey);

  let updated = 0;
  for (let i = 0; i < candidates.length; i++) {
    const v = vectors[i];
    if (!Array.isArray(v)) continue;
    const { error } = await admin
      .from("user_taste_profiles")
      .update({ taste_embedding: v, taste_content_hash: candidates[i].hash })
      .eq("user_id", candidates[i].userId);
    if (!error) updated++;
  }

  return { scanned: list.length, updated };
}
