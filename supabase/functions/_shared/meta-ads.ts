// Meta Marketing API — campagnes, créas, ciblage, audiences, insights, leads.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md §5 phases 3-4.
//
// Yuno pilote, Meta diffuse et facture. Règles :
//   - Tout est créé en PAUSED ; l'activation est un clic explicite du pro.
//   - `special_ad_categories` toujours envoyé (vide) : sans lui, 400.
//   - UE : `dsa_beneficiary` / `dsa_payor` obligatoires sur l'ensemble de pubs.
//   - `promoted_object.pixel_id` exige `custom_event_type` ; immuable ensuite.
//   - `targeting_automation.advantage_audience` explicite depuis la v23.
//   - Audiences : contacts CONSENTANTS seulement, normalisés + SHA-256 ici,
//     envoyés par sessions de ≤ 10 000, `usersreplace` (l'audience = le
//     segment du jour, jamais une accumulation).
//   - Insights : copiés par jour dans meta_insights_daily ; les VENTES attribuées
//     viennent du lien suivi Yuno, pas d'ici.
//   - Ce module ne lève jamais vers le cron : chaque dispatcher rend un bilan.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { META_GRAPH_VERSION, sha256Hex, normalizeEmail, normalizePhone, normalizeName, normalizeCountry } from "./meta-capi.ts";
import { appSecretProof, graphGet, type GraphError } from "./meta-oauth.ts";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const PUBLIC_BASE = "https://yunoapp.eu";

// ── Transport ────────────────────────────────────────────────────────────────

export async function graphPost<T = Record<string, unknown>>(
  path: string,
  params: Record<string, unknown>,
  token: string,
  appSecret: string | null,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: GraphError }> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  form.set("access_token", token);
  // Un jeton d'utilisateur système généré pour UNE AUTRE app que Yuno n'a pas
  // de proof valide de notre côté : on l'omet plutôt que d'en envoyer un faux,
  // que Meta rejetterait. Le proof reste posé dès que le jeton vient de nous.
  if (appSecret) form.set("appsecret_proof", await appSecretProof(appSecret, token));
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${path.replace(/^\//, "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { ok: false, status: 0, error: { message: e instanceof Error ? e.message : "network" } };
  }
  const json = await res.json().catch(() => null) as (T & { error?: GraphError }) | null;
  if (res.ok && json) return { ok: true, data: json };
  return { ok: false, status: res.status, error: json?.error ?? { message: `HTTP ${res.status}` } };
}

export function graphErrorText(e: GraphError): string {
  return (e.error_user_msg || e.message || "meta_error").slice(0, 500);
}

// ── Compte publicitaire ──────────────────────────────────────────────────────

export async function adAccountInfo(adAccountId: string, token: string, appSecret: string | null) {
  return graphGet<{ id: string; name?: string; currency?: string; account_status?: number; tos_accepted?: Record<string, number>; funding_source?: string; timezone_name?: string }>(
    adAccountId, { fields: "id,name,currency,account_status,tos_accepted,funding_source,timezone_name" }, { token, appSecret },
  );
}

export async function pageAccessToken(pageId: string, token: string, appSecret: string | null): Promise<string | null> {
  const r = await graphGet<{ access_token?: string }>(pageId, { fields: "access_token" }, { token, appSecret });
  return r.ok && r.data.access_token ? r.data.access_token : null;
}

/**
 * Identité Instagram de la Page. Miroir de `pageInstagramIdentity`
 * (`meta-oauth.ts`) : le lien vit sous `instagram_business_account` quand il
 * est fait depuis la Page, sous `connected_instagram_account` quand il vient
 * des « actifs connectés » du portefeuille. Sans les deux, une pub part sous
 * l'identité de la Page alors que le compte Instagram est bien relié.
 */
export async function pageInstagramAccount(pageId: string, token: string, appSecret: string | null): Promise<string | null> {
  type Fields = { instagram_business_account?: { id: string }; connected_instagram_account?: { id: string } };
  const pick = (d: Fields) => d.instagram_business_account?.id ?? d.connected_instagram_account?.id ?? null;
  const both = await graphGet<Fields>(pageId, { fields: "instagram_business_account,connected_instagram_account" }, { token, appSecret });
  if (both.ok) return pick(both.data);
  // Graph refuse la requête entière si un champ n'est pas couvert : on retente seul.
  const one = await graphGet<Fields>(pageId, { fields: "instagram_business_account" }, { token, appSecret });
  return one.ok ? pick(one.data) : null;
}

/** Recherche de villes pour le ciblage (clé Meta + nom + pays). */
export async function searchGeo(q: string, countryCode: string | null, token: string, appSecret: string | null) {
  const params: Record<string, string> = { type: "adgeolocation", q, location_types: JSON.stringify(["city", "region"]), limit: "12" };
  if (countryCode) params.country_code = countryCode;
  const r = await graphGet<{ data?: Array<{ key: string; name: string; type: string; country_code: string; region?: string; country_name?: string }> }>("search", params, { token, appSecret });
  return r.ok ? (r.data.data ?? []) : [];
}

/**
 * Centres d'intérêt (`adinterest`) et langues (`adlocale`) pour le ciblage
 * détaillé. Meta rend pour un intérêt son id, son nom, sa taille d'audience et
 * son chemin de catégorie ; pour une langue sa clé numérique (`locales`) et son
 * nom. La recherche est faite dans la langue du pro (`locale`), sinon Meta rend
 * des libellés anglais.
 */
export async function searchInterests(q: string, locale: string, token: string, appSecret: string | null) {
  const r = await graphGet<{ data?: Array<{ id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[]; topic?: string }> }>(
    "search", { type: "adinterest", q, limit: "15", locale }, { token, appSecret },
  );
  return r.ok ? (r.data.data ?? []).map((i) => ({ id: String(i.id), name: i.name, size: i.audience_size_upper_bound ?? i.audience_size_lower_bound ?? null, path: (i.path ?? []).slice(0, -1).join(" › ") || i.topic || null })) : [];
}

export async function searchLocales(q: string, token: string, appSecret: string | null) {
  const r = await graphGet<{ data?: Array<{ key: number; name: string }> }>("search", { type: "adlocale", q, limit: "15" }, { token, appSecret });
  return r.ok ? (r.data.data ?? []).map((l) => ({ key: Number(l.key), name: l.name })) : [];
}

/**
 * Estimation de la taille de l'audience, telle que Meta la donne à Ads Manager.
 * `-1` = Meta ne sait pas dire (fréquent avec une audience personnalisée) :
 * ce n'est pas une audience vide.
 */
export async function reachEstimate(adAccountId: string, targeting: CampaignTargeting, placements: CampaignPlacements, token: string, appSecret: string | null): Promise<{ lower: number; upper: number } | null> {
  const r = await graphGet<{ data?: { users_lower_bound?: number; users_upper_bound?: number; estimate_ready?: boolean } }>(
    `${adAccountId}/reachestimate`, { targeting_spec: JSON.stringify(buildTargeting(targeting, placements)) }, { token, appSecret },
  );
  if (!r.ok || !r.data.data) return null;
  const lower = Number(r.data.data.users_lower_bound ?? -1); const upper = Number(r.data.data.users_upper_bound ?? -1);
  if (!Number.isFinite(lower) || lower < 0) return null;
  return { lower, upper: Number.isFinite(upper) && upper >= lower ? upper : lower };
}

// ── Création d'une campagne complète ─────────────────────────────────────────

export interface CampaignTargeting {
  countries?: string[];
  cities?: Array<{ key: string; name: string; radius_km?: number; type?: string }>;
  age_min?: number;
  age_max?: number;
  genders?: number[];
  audience_ids?: string[];          // meta_audience_id (Meta)
  exclude_audience_ids?: string[];
  /** Centres d'intérêt Meta (`adinterest`) — ciblage détaillé, facultatif. */
  interests?: Array<{ id: string; name: string }>;
  /** Langues (`adlocale`, clés numériques) — facultatif. */
  locales?: number[];
  /**
   * Jusqu'où Meta peut sortir du ciblage. Sondé en vrai le 2026-09-22 sur le
   * compte Amoris (sous-codes 1870188 / 1870189) :
   *   - `full`    = Advantage+ audience (`advantage_audience: 1`) : tout est
   *     suggestion ; Meta REFUSE un âge maximum sous 65 et un âge minimum
   *     au-dessus de 25 — on n'envoie donc pas d'âge max et on plafonne le min.
   *   - `relaxed` = `advantage_audience: 0` + `individual_setting` : la tranche
   *     d'âge et la zone sont des limites dures, les audiences, jumeaux,
   *     intérêts et genre sont relâchés. Le bon défaut pour une boîte de nuit
   *     qui sait l'âge de sa clientèle. (`individual_setting.age` est refusé :
   *     relâcher l'âge, c'est Advantage+.)
   *   - `strict`  = rien n'est relâché.
   * `advantage` (booléen historique) est lu quand `audience_mode` manque :
   * true → full, false → strict.
   */
  audience_mode?: "full" | "relaxed" | "strict";
  advantage?: boolean;
}

export interface CampaignPlacements { facebook?: boolean; instagram?: boolean }

export type CreativeFormat = "image" | "carousel" | "video";

export interface CreativeMedia {
  url: string;
  kind: "image" | "video";
  /** Vidéo : image de couverture (obligatoire chez Meta pour une pub vidéo). */
  thumbnail_url?: string | null;
  /** Carrousel : titre et description propres à la carte (sinon ceux de la création). */
  headline?: string | null;
  description?: string | null;
}

/**
 * Une CRÉATION = une pub dans l'ensemble. Plusieurs créations dans la même
 * campagne partagent le même budget : Meta le déplace vers celle qui obtient
 * les meilleurs résultats (c'est le test A/B naturel d'un ensemble de pubs).
 */
export interface CampaignCreative {
  format: CreativeFormat;
  media: CreativeMedia[];
  headline: string;
  body: string;
  cta: string;
  link: string;
  description?: string | null;
}

export interface CreateCampaignInput {
  adAccountId: string;
  pageId: string;
  instagramActorId?: string | null;
  pixelId: string;
  name: string;
  objective: "OUTCOME_SALES" | "OUTCOME_TRAFFIC";
  budgetType: "daily" | "lifetime";
  budgetCents: number;
  startAt: string;
  endAt: string | null;
  targeting: CampaignTargeting;
  creatives: CampaignCreative[];
  placements: CampaignPlacements;
  dsaBeneficiary: string;
  dsaPayor: string;
}

export interface CreatedAd {
  index: number;
  format: CreativeFormat;
  ad_id: string;
  creative_id: string;
  video_id?: string | null;
  effective_status?: string | null;
  review?: string | null;
}

export interface CreateCampaignResult {
  ok: boolean;
  campaignId?: string;
  adsetId?: string;
  ads: CreatedAd[];
  error?: string;
  step?: string;
}

/**
 * Bibliothèque d'images du compte : une même URL n'est envoyée qu'une fois
 * (l'affiche sert souvent à plusieurs créations).
 */
class ImageLibrary {
  private cache = new Map<string, string>();
  constructor(private adAccountId: string, private token: string, private appSecret: string | null) {}
  async hashFor(imageUrl: string): Promise<{ hash: string } | { error: string }> {
    const hit = this.cache.get(imageUrl);
    if (hit) return { hash: hit };
    const r = await uploadImage(this.adAccountId, imageUrl, this.token, this.appSecret);
    if ("hash" in r) this.cache.set(imageUrl, r.hash);
    return r;
  }
}

async function uploadImage(adAccountId: string, imageUrl: string, token: string, appSecret: string | null): Promise<{ hash: string } | { error: string }> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { error: `image_fetch_${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 8 * 1024 * 1024) return { error: "image_too_large" };
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    const b64 = btoa(bin);
    const r = await graphPost<{ images?: Record<string, { hash: string }> }>(`${adAccountId}/adimages`, { bytes: b64 }, token, appSecret);
    if (!r.ok) return { error: graphErrorText(r.error) };
    const first = Object.values(r.data.images ?? {})[0];
    return first?.hash ? { hash: first.hash } : { error: "image_hash_missing" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "image_upload_failed" };
  }
}

/**
 * Vidéo : Meta va la chercher lui-même (`file_url`), puis la transcode. Une pub
 * créée sur une vidéo encore en traitement est refusée : on attend `ready`
 * (jusqu'à ~50 s, le gros d'une vidéo de 30 Mo), sinon on tente quand même —
 * Meta accepte souvent la créa et finit le traitement de son côté.
 */
async function uploadVideo(adAccountId: string, videoUrl: string, name: string, token: string, appSecret: string | null): Promise<{ id: string } | { error: string }> {
  const r = await graphPost<{ id?: string; video_id?: string }>(`${adAccountId}/advideos`, { file_url: videoUrl, name: name.slice(0, 100) }, token, appSecret);
  if (!r.ok) return { error: graphErrorText(r.error) };
  const id = r.data.id ?? r.data.video_id;
  return id ? { id: String(id) } : { error: "video_id_missing" };
}

async function waitVideoReady(videoId: string, token: string, appSecret: string | null, maxMs = 50_000): Promise<"ready" | "processing" | "error"> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const r = await graphGet<{ status?: { video_status?: string } }>(videoId, { fields: "status" }, { token, appSecret });
    const st = r.ok ? r.data.status?.video_status : undefined;
    if (st === "ready") return "ready";
    if (st === "error") return "error";
    await new Promise((res) => setTimeout(res, 3_000));
  }
  return "processing";
}

export function buildTargeting(t: CampaignTargeting, placements: CampaignPlacements): Record<string, unknown> {
  const geo: Record<string, unknown> = {};
  if (t.cities && t.cities.length > 0) {
    geo.cities = t.cities.filter((c) => c.type !== "region").map((c) => ({ key: c.key, radius: Math.min(80, Math.max(10, c.radius_km ?? 25)), distance_unit: "kilometer" }));
    const regions = t.cities.filter((c) => c.type === "region").map((c) => ({ key: c.key }));
    if (regions.length) geo.regions = regions;
    if (Array.isArray(geo.cities) && (geo.cities as unknown[]).length === 0) delete geo.cities;
  }
  if (!geo.cities && !geo.regions) geo.countries = t.countries && t.countries.length > 0 ? t.countries : ["FR"];
  const platforms: string[] = [];
  if (placements.facebook !== false) platforms.push("facebook");
  if (placements.instagram !== false) platforms.push("instagram");
  const mode = t.audience_mode ?? (t.advantage === false ? "strict" : "full");
  const ageMin = Math.max(18, Math.min(65, t.age_min ?? 18));
  const ageMax = Math.max(ageMin, Math.min(65, t.age_max ?? 40));
  const out: Record<string, unknown> = {
    geo_locations: geo,
    age_min: mode === "full" ? Math.min(25, ageMin) : ageMin,
    publisher_platforms: platforms.length ? platforms : ["facebook", "instagram"],
    targeting_automation: mode === "full"
      ? { advantage_audience: 1 }
      : mode === "relaxed"
        ? { advantage_audience: 0, individual_setting: { custom_audience: 1, lookalike: 1, detailed_targeting: 1, gender: 1 } }
        : { advantage_audience: 0 },
  };
  if (mode !== "full") out.age_max = ageMax;
  if (t.genders && t.genders.length === 1) out.genders = t.genders;
  if (t.audience_ids && t.audience_ids.length) out.custom_audiences = t.audience_ids.map((id) => ({ id }));
  if (t.exclude_audience_ids && t.exclude_audience_ids.length) out.excluded_custom_audiences = t.exclude_audience_ids.map((id) => ({ id }));
  const interests = (t.interests ?? []).filter((i) => i && /^[0-9]{3,30}$/.test(String(i.id))).slice(0, 25).map((i) => ({ id: String(i.id), name: String(i.name ?? "").slice(0, 80) }));
  if (interests.length) out.flexible_spec = [{ interests }];
  const locales = (t.locales ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  if (locales.length) out.locales = locales;
  return out;
}

function callToAction(cta: string, link: string) {
  return { type: cta || "LEARN_MORE", value: { link } };
}

/**
 * Une créa Meta par création Yuno. Le lien est le même pour toutes (le lien
 * suivi de la campagne) : c'est lui qui attribue les ventes, pas la créa.
 */
async function buildCreativeSpec(
  c: CampaignCreative, pageId: string, instagramActorId: string | null | undefined,
  lib: ImageLibrary, adAccountId: string, name: string, token: string, appSecret: string | null,
): Promise<{ spec: Record<string, unknown>; videoId?: string } | { error: string }> {
  const story: Record<string, unknown> = { page_id: pageId };
  if (instagramActorId) story.instagram_user_id = instagramActorId;
  if (c.format === "video") {
    const video = c.media.find((m) => m.kind === "video");
    if (!video) return { error: "video_missing" };
    const thumbUrl = video.thumbnail_url || c.media.find((m) => m.kind === "image")?.url || null;
    if (!thumbUrl) return { error: "video_thumbnail_missing" };
    const thumb = await lib.hashFor(thumbUrl);
    if ("error" in thumb) return { error: thumb.error };
    const up = await uploadVideo(adAccountId, video.url, name, token, appSecret);
    if ("error" in up) return { error: up.error };
    const st = await waitVideoReady(up.id, token, appSecret);
    if (st === "error") return { error: "video_processing_failed" };
    story.video_data = {
      video_id: up.id,
      image_hash: thumb.hash,
      message: c.body,
      title: c.headline,
      ...(c.description ? { link_description: c.description } : {}),
      call_to_action: callToAction(c.cta, c.link),
    };
    return { spec: { name, object_story_spec: story }, videoId: up.id };
  }
  if (c.format === "carousel") {
    const cards = c.media.filter((m) => m.kind === "image").slice(0, 10);
    if (cards.length < 2) return { error: "carousel_needs_two_images" };
    const children: Array<Record<string, unknown>> = [];
    for (const card of cards) {
      const h = await lib.hashFor(card.url);
      if ("error" in h) return { error: h.error };
      children.push({
        link: c.link, image_hash: h.hash,
        name: (card.headline || c.headline).slice(0, 40),
        ...(card.description || c.description ? { description: String(card.description || c.description).slice(0, 120) } : {}),
        call_to_action: callToAction(c.cta, c.link),
      });
    }
    story.link_data = {
      link: c.link, message: c.body, child_attachments: children,
      multi_share_optimized: false, multi_share_end_card: false,
      call_to_action: callToAction(c.cta, c.link),
    };
    return { spec: { name, object_story_spec: story } };
  }
  const image = c.media.find((m) => m.kind === "image");
  if (!image) return { error: "image_missing" };
  const h = await lib.hashFor(image.url);
  if ("error" in h) return { error: h.error };
  story.link_data = {
    link: c.link, message: c.body, name: c.headline,
    ...(c.description ? { description: c.description } : {}),
    image_hash: h.hash,
    call_to_action: callToAction(c.cta, c.link),
  };
  return { spec: { name, object_story_spec: story } };
}

export async function createFullCampaign(input: CreateCampaignInput, token: string, appSecret: string | null): Promise<CreateCampaignResult> {
  const { adAccountId } = input;
  const ads: CreatedAd[] = [];
  if (input.creatives.length === 0) return { ok: false, error: "no_creative", step: "creative", ads };
  const lib = new ImageLibrary(adAccountId, token, appSecret);

  // Le budget vit sur l'ENSEMBLE de pubs (une campagne Yuno = un ensemble) :
  // depuis la v24 Meta exige alors `is_adset_budget_sharing_enabled` en clair
  // (erreur 4834011 sinon). `false` : le budget reste celui que le pro a posé,
  // rien n'est partagé avec d'autres ensembles (il n'y en a pas).
  const camp = await graphPost<{ id: string }>(`${adAccountId}/campaigns`, {
    name: input.name,
    objective: input.objective,
    status: "PAUSED",
    special_ad_categories: [],
    buying_type: "AUCTION",
    is_adset_budget_sharing_enabled: false,
  }, token, appSecret);
  if (!camp.ok) return { ok: false, error: graphErrorText(camp.error), step: "campaign", ads };

  const adset: Record<string, unknown> = {
    name: `${input.name} — audience`,
    campaign_id: camp.data.id,
    status: "PAUSED",
    billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    start_time: input.startAt,
    targeting: buildTargeting(input.targeting, input.placements),
    attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }],
    dsa_beneficiary: input.dsaBeneficiary,
    dsa_payor: input.dsaPayor,
  };
  if (input.objective === "OUTCOME_SALES") {
    adset.optimization_goal = "OFFSITE_CONVERSIONS";
    adset.promoted_object = { pixel_id: input.pixelId, custom_event_type: "PURCHASE" };
  } else {
    adset.optimization_goal = "LINK_CLICKS";
    adset.destination_type = "WEBSITE";
  }
  if (input.budgetType === "daily") adset.daily_budget = input.budgetCents;
  else {
    adset.lifetime_budget = input.budgetCents;
    adset.end_time = input.endAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  }
  if (input.endAt && input.budgetType === "daily") adset.end_time = input.endAt;
  const set = await graphPost<{ id: string }>(`${adAccountId}/adsets`, adset, token, appSecret);
  if (!set.ok) return { ok: false, error: graphErrorText(set.error), step: "adset", campaignId: camp.data.id, ads };

  // Une pub par création, toutes dans le même ensemble : Meta répartit le
  // budget entre elles selon leurs résultats.
  for (let i = 0; i < input.creatives.length; i++) {
    const c = input.creatives[i];
    const label = input.creatives.length > 1 ? `${input.name} — créa ${i + 1}` : `${input.name} — créa`;
    const built = await buildCreativeSpec(c, input.pageId, input.instagramActorId, lib, adAccountId, label, token, appSecret);
    if ("error" in built) return { ok: false, error: built.error, step: `creative_${i + 1}`, campaignId: camp.data.id, adsetId: set.data.id, ads };
    const creative = await graphPost<{ id: string }>(`${adAccountId}/adcreatives`, built.spec, token, appSecret);
    if (!creative.ok) return { ok: false, error: graphErrorText(creative.error), step: `creative_${i + 1}`, campaignId: camp.data.id, adsetId: set.data.id, ads };
    const ad = await graphPost<{ id: string }>(`${adAccountId}/ads`, {
      name: input.creatives.length > 1 ? `${input.name} — pub ${i + 1}` : `${input.name} — pub`,
      adset_id: set.data.id,
      creative: { creative_id: creative.data.id },
      status: "PAUSED",
    }, token, appSecret);
    if (!ad.ok) return { ok: false, error: graphErrorText(ad.error), step: `ad_${i + 1}`, campaignId: camp.data.id, adsetId: set.data.id, ads };
    ads.push({ index: i, format: c.format, ad_id: ad.data.id, creative_id: creative.data.id, video_id: built.videoId ?? null });
  }

  return { ok: true, campaignId: camp.data.id, adsetId: set.data.id, ads };
}

export async function setCampaignStatus(
  ids: { campaignId: string; adsetId?: string | null; adIds?: string[] },
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
  token: string,
  appSecret: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // Activer : la campagne, puis l'ensemble, puis chaque pub (tous doivent l'être).
  // Mettre en pause / archiver : la campagne suffit (hérité).
  const targets = status === "ACTIVE"
    ? [ids.campaignId, ids.adsetId, ...(ids.adIds ?? [])].filter((x): x is string => !!x)
    : [ids.campaignId];
  for (const id of targets) {
    const r = await graphPost(id, { status }, token, appSecret);
    if (!r.ok) return { ok: false, error: graphErrorText(r.error) };
  }
  return { ok: true };
}

/** État Meta de la campagne et de chacune de ses pubs (validation, refus). */
export async function campaignStatusInfo(campaignId: string, adIds: string[], token: string, appSecret: string | null) {
  const c = await graphGet<{ effective_status?: string; status?: string }>(campaignId, { fields: "effective_status,status" }, { token, appSecret });
  const perAd: Array<{ ad_id: string; effective_status: string | null; review: string | null }> = [];
  for (const adId of adIds) {
    const a = await graphGet<{ effective_status?: string; ad_review_feedback?: { global?: Record<string, string> } }>(adId, { fields: "effective_status,ad_review_feedback" }, { token, appSecret });
    perAd.push({
      ad_id: adId,
      effective_status: a.ok ? (a.data.effective_status ?? null) : null,
      review: a.ok && a.data.ad_review_feedback?.global ? Object.values(a.data.ad_review_feedback.global).join(" · ").slice(0, 500) : null,
    });
  }
  const review = perAd.map((p) => p.review).filter((x): x is string => !!x).join(" · ").slice(0, 500) || null;
  const first = perAd[0];
  const effective = c.ok ? (first?.effective_status ? `${c.data.effective_status ?? ""}/${first.effective_status}` : (c.data.effective_status ?? null)) : null;
  return { effective, review, perAd };
}

// ── Insights ─────────────────────────────────────────────────────────────────

export interface DailyInsight {
  day: string; spend_cents: number; impressions: number; reach: number; clicks: number;
  link_clicks: number; purchases: number; purchase_value_cents: number; leads: number; raw: Record<string, unknown>;
}

export async function campaignInsights(campaignId: string, token: string, appSecret: string | null): Promise<DailyInsight[]> {
  const r = await graphGet<{ data?: Array<Record<string, unknown>> }>(`${campaignId}/insights`, {
    fields: "spend,impressions,reach,clicks,inline_link_clicks,actions,action_values",
    time_increment: "1",
    date_preset: "maximum",
    use_unified_attribution_setting: "true",
    limit: "200",
  }, { token, appSecret });
  if (!r.ok || !Array.isArray(r.data.data)) return [];
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pick = (arr: unknown, types: string[]) => {
    if (!Array.isArray(arr)) return 0;
    for (const t of types) {
      const hit = (arr as Array<{ action_type?: string; value?: string }>).find((a) => a.action_type === t);
      if (hit) return num(hit.value);
    }
    return 0;
  };
  return r.data.data.map((row) => ({
    day: String(row.date_start ?? "").slice(0, 10),
    spend_cents: Math.round(num(row.spend) * 100),
    impressions: num(row.impressions),
    reach: num(row.reach),
    clicks: num(row.clicks),
    link_clicks: num(row.inline_link_clicks),
    purchases: pick(row.actions, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    purchase_value_cents: Math.round(pick(row.action_values, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]) * 100),
    leads: pick(row.actions, ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped"]),
    raw: row,
  })).filter((d) => d.day);
}

/**
 * Résultats PAR PUB (donc par création) sur toute la vie de la campagne :
 * c'est ce qui dit au pro laquelle de ses créations vend, et vers laquelle
 * Meta a déplacé le budget.
 */
export interface AdInsight { ad_id: string; spend_cents: number; impressions: number; reach: number; link_clicks: number; purchases: number; purchase_value_cents: number }

export async function campaignAdInsights(campaignId: string, token: string, appSecret: string | null): Promise<AdInsight[]> {
  const r = await graphGet<{ data?: Array<Record<string, unknown>> }>(`${campaignId}/insights`, {
    level: "ad",
    fields: "ad_id,spend,impressions,reach,inline_link_clicks,actions,action_values",
    date_preset: "maximum",
    use_unified_attribution_setting: "true",
    limit: "50",
  }, { token, appSecret });
  if (!r.ok || !Array.isArray(r.data.data)) return [];
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pick = (arr: unknown, types: string[]) => {
    if (!Array.isArray(arr)) return 0;
    for (const t of types) {
      const hit = (arr as Array<{ action_type?: string; value?: string }>).find((a) => a.action_type === t);
      if (hit) return num(hit.value);
    }
    return 0;
  };
  return r.data.data.filter((row) => row.ad_id).map((row) => ({
    ad_id: String(row.ad_id),
    spend_cents: Math.round(num(row.spend) * 100),
    impressions: num(row.impressions),
    reach: num(row.reach),
    link_clicks: num(row.inline_link_clicks),
    purchases: pick(row.actions, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    purchase_value_cents: Math.round(pick(row.action_values, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]) * 100),
  }));
}

// ── Audiences ────────────────────────────────────────────────────────────────

export async function createCustomAudience(adAccountId: string, name: string, description: string, token: string, appSecret: string | null) {
  const r = await graphPost<{ id: string }>(`${adAccountId}/customaudiences`, {
    name, description, subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY",
  }, token, appSecret);
  return r.ok ? { ok: true as const, id: r.data.id } : { ok: false as const, error: graphErrorText(r.error), code: r.error.code, subcode: r.error.error_subcode };
}

export async function createLookalike(adAccountId: string, name: string, originAudienceId: string, ratio: number, country: string, token: string, appSecret: string | null) {
  const r = await graphPost<{ id: string }>(`${adAccountId}/customaudiences`, {
    name, subtype: "LOOKALIKE", origin_audience_id: originAudienceId,
    lookalike_spec: { ratio: Math.min(0.2, Math.max(0.01, ratio)), country },
  }, token, appSecret);
  return r.ok ? { ok: true as const, id: r.data.id } : { ok: false as const, error: graphErrorText(r.error) };
}

export interface AudienceMember { email: string | null; phone: string | null; first_name: string | null; last_name: string | null; country: string | null }

async function hashRow(m: AudienceMember, defaultCountry: "FR" | "ES"): Promise<string[]> {
  const em = normalizeEmail(m.email); const ph = normalizePhone(m.phone, defaultCountry);
  const fn = normalizeName(m.first_name); const ln = normalizeName(m.last_name); const ct = normalizeCountry(m.country);
  return [
    em ? await sha256Hex(em) : "",
    ph ? await sha256Hex(ph) : "",
    fn ? await sha256Hex(fn) : "",
    ln ? await sha256Hex(ln) : "",
    ct ? await sha256Hex(ct) : "",
  ];
}

/** Remplace le contenu d'une audience par la liste donnée (sessions de 10 000). */
export async function replaceAudienceUsers(audienceId: string, members: AudienceMember[], token: string, appSecret: string | null, defaultCountry: "FR" | "ES" = "FR"): Promise<{ ok: boolean; uploaded: number; error?: string }> {
  const rows: string[][] = [];
  for (const m of members) {
    const r = await hashRow(m, defaultCountry);
    if (r[0] || r[1]) rows.push(r);
  }
  if (rows.length === 0) return { ok: true, uploaded: 0 };
  const sessionId = Date.now() % 2_000_000_000;
  const batch = 10_000;
  const total = Math.ceil(rows.length / batch);
  for (let i = 0; i < total; i++) {
    const slice = rows.slice(i * batch, (i + 1) * batch);
    const r = await graphPost(`${audienceId}/usersreplace`, {
      session: { session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === total - 1, estimated_num_total: rows.length },
      payload: { schema: ["EMAIL", "PHONE", "FN", "LN", "COUNTRY"], data: slice },
    }, token, appSecret);
    if (!r.ok) return { ok: false, uploaded: i * batch, error: graphErrorText(r.error) };
  }
  return { ok: true, uploaded: rows.length };
}

// ── Leads ────────────────────────────────────────────────────────────────────

export async function subscribePageToLeads(pageId: string, pageToken: string, appSecret: string | null): Promise<{ ok: boolean; error?: string }> {
  const r = await graphPost(`${pageId}/subscribed_apps`, { subscribed_fields: ["leadgen"] }, pageToken, appSecret);
  return r.ok ? { ok: true } : { ok: false, error: graphErrorText(r.error) };
}

export async function fetchLead(leadgenId: string, token: string, appSecret: string | null) {
  return graphGet<{ id: string; created_time?: string; ad_id?: string; form_id?: string; campaign_id?: string; field_data?: Array<{ name: string; values: string[] }> }>(
    leadgenId, { fields: "id,created_time,ad_id,form_id,campaign_id,field_data" }, { token, appSecret },
  );
}

export function extractLeadContact(fieldData: Array<{ name: string; values: string[] }> | undefined): { email: string | null; phone: string | null; name: string | null } {
  let email: string | null = null, phone: string | null = null, first = "", last = "", full = "";
  for (const f of fieldData ?? []) {
    const v = (f.values?.[0] ?? "").trim();
    const n = f.name.toLowerCase();
    if (!v) continue;
    if (n === "email" || n.includes("mail")) email = v.toLowerCase();
    else if (n === "phone_number" || n.includes("phone") || n.includes("tel")) phone = v.replace(/[^0-9+]/g, "").replace(/^00/, "+");
    else if (n === "first_name" || n === "prenom" || n === "prénom") first = v;
    else if (n === "last_name" || n === "nom") last = v;
    else if (n === "full_name" || n === "name") full = v;
  }
  const name = full || [first, last].filter(Boolean).join(" ") || null;
  if (phone && !phone.startsWith("+")) {
    if (phone.startsWith("0") && phone.length === 10) phone = "+33" + phone.slice(1);
    else if (phone.length === 9 && /^[67]/.test(phone)) phone = "+34" + phone;
    else phone = "+" + phone;
  }
  return { email, phone, name };
}

// ── Dispatchers (cron) ───────────────────────────────────────────────────────

interface ConnRow { id: string; venue_id: string | null; organizer_user_id: string | null; ad_account_id: string | null; page_id: string | null; mode: string; status: string }

async function connToken(admin: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await admin.rpc("get_meta_capi_token", { p_connection_id: id });
  return typeof data === "string" && data ? data : null;
}

export async function syncMetaAudiences(admin: SupabaseClient, appSecret: string | null, opts: { onlyAudienceId?: string; force?: boolean } = {}): Promise<{ synced: number; failed: number }> {
  const out = { synced: 0, failed: 0 };
  try {
    let q = admin.from("meta_audiences").select("id, connection_id, kind, ref, name, meta_audience_id, status, last_sync_at, lookalike_ratio, lookalike_country");
    if (opts.onlyAudienceId) q = q.eq("id", opts.onlyAudienceId);
    else if (!opts.force) q = q.or("last_sync_at.is.null,last_sync_at.lt." + new Date(Date.now() - 20 * 3600 * 1000).toISOString());
    const { data: auds } = await q.limit(50);
    for (const a of (auds ?? []) as Array<{ id: string; connection_id: string; kind: string; ref: string; name: string; meta_audience_id: string | null; lookalike_ratio: number | null; lookalike_country: string | null }>) {
      const { data: c } = await admin.from("meta_connections").select("id, venue_id, organizer_user_id, ad_account_id, page_id, mode, status").eq("id", a.connection_id).maybeSingle();
      const conn = c as ConnRow | null;
      const token = conn && conn.status === "active" && conn.ad_account_id ? await connToken(admin, conn.id) : null;
      if (!conn || !token) { await admin.from("meta_audiences").update({ status: "error", last_error: "connection_inactive" }).eq("id", a.id); out.failed++; continue; }
      await admin.from("meta_audiences").update({ status: "syncing", last_error: null }).eq("id", a.id);
      try {
        if (a.kind === "lookalike") {
          if (!a.meta_audience_id) {
            const { data: origin } = await admin.from("meta_audiences").select("meta_audience_id, size_uploaded").eq("id", a.ref).maybeSingle();
            const o = origin as { meta_audience_id: string | null; size_uploaded: number | null } | null;
            if (!o?.meta_audience_id) throw new Error("origin_not_ready");
            if ((o.size_uploaded ?? 0) < 100) throw new Error("origin_too_small");
            const r = await createLookalike(conn.ad_account_id!, a.name, o.meta_audience_id, Number(a.lookalike_ratio ?? 0.03), a.lookalike_country ?? "FR", token, appSecret);
            if (!r.ok) throw new Error(r.error);
            await admin.from("meta_audiences").update({ meta_audience_id: r.id }).eq("id", a.id);
          }
          await admin.from("meta_audiences").update({ status: "ready", last_sync_at: new Date().toISOString() }).eq("id", a.id);
          out.synced++;
          continue;
        }
        let metaId = a.meta_audience_id;
        if (!metaId) {
          const r = await createCustomAudience(conn.ad_account_id!, a.name, "Audience Yuno — contacts consentants", token, appSecret);
          if (!r.ok) throw new Error(r.subcode === 1870090 ? "custom_audience_tos" : r.error);
          metaId = r.id;
          await admin.from("meta_audiences").update({ meta_audience_id: metaId }).eq("id", a.id);
        }
        const { data: members, error: mErr } = await admin.rpc("resolve_meta_audience", { p_connection_id: conn.id, p_kind: a.kind, p_ref: a.ref });
        if (mErr) throw new Error(mErr.message);
        const list = (members ?? []) as AudienceMember[];
        const up = await replaceAudienceUsers(metaId, list, token, appSecret);
        if (!up.ok) throw new Error(up.error ?? "upload_failed");
        await admin.from("meta_audiences").update({ status: "ready", size_uploaded: up.uploaded, last_sync_at: new Date().toISOString(), last_error: null }).eq("id", a.id);
        out.synced++;
      } catch (e) {
        await admin.from("meta_audiences").update({ status: "error", last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq("id", a.id);
        out.failed++;
      }
    }
  } catch (e) {
    console.error("[meta-ads] syncMetaAudiences:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

export async function syncMetaInsights(admin: SupabaseClient, appSecret: string | null, opts: { onlyCampaignId?: string; force?: boolean } = {}): Promise<{ synced: number; failed: number }> {
  const out = { synced: 0, failed: 0 };
  try {
    let q = admin.from("meta_campaigns").select("id, connection_id, meta_campaign_id, meta_ad_id, meta_ads, status, end_at, last_synced_at")
      .not("meta_campaign_id", "is", null)
      .in("status", ["paused", "active", "ended", "error"]);
    if (opts.onlyCampaignId) q = q.eq("id", opts.onlyCampaignId);
    else if (!opts.force) q = q.or("last_synced_at.is.null,last_synced_at.lt." + new Date(Date.now() - 55 * 60 * 1000).toISOString());
    const { data: rows } = await q.limit(100);
    const tokens = new Map<string, string | null>();
    for (const c of (rows ?? []) as Array<{ id: string; connection_id: string; meta_campaign_id: string; meta_ad_id: string | null; meta_ads: CreatedAd[] | null; status: string; end_at: string | null }>) {
      // Campagne terminée depuis plus de 3 jours : plus rien à lire.
      if (c.end_at && new Date(c.end_at).getTime() < Date.now() - 3 * 24 * 3600 * 1000 && c.status === "ended" && !opts.force) continue;
      if (!tokens.has(c.connection_id)) tokens.set(c.connection_id, await connToken(admin, c.connection_id));
      const token = tokens.get(c.connection_id);
      if (!token) { out.failed++; continue; }
      try {
        const days = await campaignInsights(c.meta_campaign_id, token, appSecret);
        if (days.length) {
          await admin.from("meta_insights_daily").upsert(days.map((d) => ({ campaign_id: c.id, ...d, synced_at: new Date().toISOString() })), { onConflict: "campaign_id,day" });
        }
        const knownAds = Array.isArray(c.meta_ads) && c.meta_ads.length ? c.meta_ads : (c.meta_ad_id ? [{ index: 0, format: "image" as const, ad_id: c.meta_ad_id, creative_id: "" }] : []);
        const st = await campaignStatusInfo(c.meta_campaign_id, knownAds.map((a) => a.ad_id), token, appSecret);
        const adInsights = knownAds.length ? await campaignAdInsights(c.meta_campaign_id, token, appSecret) : [];
        const patch: Record<string, unknown> = {
          last_synced_at: new Date().toISOString(), effective_status: st.effective, review_feedback: st.review,
          meta_ads: knownAds.map((a) => { const p = st.perAd.find((x) => x.ad_id === a.ad_id); return { ...a, effective_status: p?.effective_status ?? a.effective_status ?? null, review: p?.review ?? null }; }),
          ad_insights: adInsights,
        };
        if (st.effective?.startsWith("ACTIVE") && c.status === "paused") patch.status = "active";
        if (st.effective?.startsWith("PAUSED") && c.status === "active") patch.status = "paused";
        if (st.effective?.startsWith("ARCHIVED") || st.effective?.startsWith("DELETED")) patch.status = "archived";
        if (c.end_at && new Date(c.end_at) < new Date() && (c.status === "active" || c.status === "paused")) patch.status = "ended";
        await admin.from("meta_campaigns").update(patch).eq("id", c.id);
        out.synced++;
      } catch (e) {
        await admin.from("meta_campaigns").update({ last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq("id", c.id);
        out.failed++;
      }
    }
  } catch (e) {
    console.error("[meta-ads] syncMetaInsights:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

export async function processMetaLeads(admin: SupabaseClient, appSecret: string | null): Promise<{ processed: number; failed: number }> {
  const out = { processed: 0, failed: 0 };
  try {
    const { data: rows, error } = await admin.rpc("claim_meta_leads", { p_limit: 50 });
    if (error) { console.error("[meta-ads] claim leads:", error.message); return out; }
    const pageTokens = new Map<string, string | null>();
    for (const l of (rows ?? []) as Array<{ leadgen_id: string; connection_id: string | null; page_id: string | null; field_data: unknown }>) {
      try {
        let connId = l.connection_id;
        if (!connId && l.page_id) {
          const { data: c } = await admin.from("meta_connections").select("id").eq("page_id", l.page_id).eq("status", "active").maybeSingle();
          connId = (c as { id: string } | null)?.id ?? null;
          if (connId) await admin.from("meta_leads").update({ connection_id: connId }).eq("leadgen_id", l.leadgen_id);
        }
        if (!connId) throw new Error("no_connection_for_page");
        if (!l.field_data) {
          const token = await connToken(admin, connId);
          if (!token) throw new Error("token_missing");
          const key = `${connId}:${l.page_id}`;
          if (!pageTokens.has(key)) pageTokens.set(key, l.page_id ? await pageAccessToken(l.page_id, token, appSecret) : null);
          const r = await fetchLead(l.leadgen_id, pageTokens.get(key) ?? token, appSecret);
          if (!r.ok) throw new Error(graphErrorText(r.error));
          const contact = extractLeadContact(r.data.field_data);
          let campaignId: string | null = null;
          if (r.data.campaign_id) {
            const { data: mc } = await admin.from("meta_campaigns").select("id").eq("meta_campaign_id", r.data.campaign_id).maybeSingle();
            campaignId = (mc as { id: string } | null)?.id ?? null;
          }
          await admin.from("meta_leads").update({
            raw: r.data, field_data: r.data.field_data ?? [], ad_id: r.data.ad_id ?? null, form_id: r.data.form_id ?? null,
            meta_campaign_id: r.data.campaign_id ?? null, campaign_id: campaignId,
            contact_email: contact.email, contact_phone: contact.phone, contact_name: contact.name,
          }).eq("leadgen_id", l.leadgen_id);
        }
        const { error: cErr } = await admin.rpc("meta_lead_to_contact", { p_leadgen_id: l.leadgen_id });
        if (cErr) throw new Error(cErr.message);
        // Un lead sans email valide est marqué traité sans contact (pas d'erreur).
        await admin.from("meta_leads").update({ processed_at: new Date().toISOString() }).eq("leadgen_id", l.leadgen_id).is("processed_at", null);
        out.processed++;
      } catch (e) {
        await admin.from("meta_leads").update({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq("leadgen_id", l.leadgen_id);
        out.failed++;
      }
    }
  } catch (e) {
    console.error("[meta-ads] processMetaLeads:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

/**
 * Abonne l'APP (pas une Page) au champ `leadgen` de l'objet Page, avec le
 * jeton d'app `app_id|app_secret`. Idempotent : lit d'abord, n'écrit que si
 * l'abonnement manque ou pointe ailleurs. Remplace le clic manuel dans
 * App Dashboard → Webhooks. Rend l'état pour l'admin.
 */
export async function ensureAppWebhookSubscription(cfg: { appId: string; appSecret: string }, callbackUrl: string): Promise<{ ok: boolean; registered: boolean; error?: string }> {
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const verify = await webhookVerifyToken(cfg.appSecret);
  const current = await graphGet<{ data?: Array<{ object?: string; callback_url?: string; fields?: Array<{ name?: string }>; active?: boolean }> }>(
    `${cfg.appId}/subscriptions`, {}, { token: appToken },
  );
  if (current.ok) {
    const page = (current.data.data ?? []).find((s) => s.object === "page");
    const hasLeadgen = !!page?.fields?.some((f) => f.name === "leadgen");
    if (page && hasLeadgen && page.callback_url === callbackUrl && page.active !== false) return { ok: true, registered: true };
  }
  const form = new URLSearchParams({
    object: "page", callback_url: callbackUrl, fields: "leadgen", verify_token: verify, include_values: "true", access_token: appToken,
  });
  try {
    const res = await fetch(`${GRAPH}/${cfg.appId}/subscriptions`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: AbortSignal.timeout(20_000) });
    const json = await res.json().catch(() => null) as { success?: boolean; error?: GraphError } | null;
    if (res.ok && json?.success) return { ok: true, registered: true };
    return { ok: false, registered: false, error: json?.error ? graphErrorText(json.error) : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, registered: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Vérification du webhook Meta (GET hub.*). Le verify token dérive du secret d'app. */
export async function webhookVerifyToken(appSecret: string): Promise<string> {
  return (await sha256Hex(`yuno-meta-webhook:${appSecret}`)).slice(0, 32);
}

export async function verifyHubSignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (hex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
