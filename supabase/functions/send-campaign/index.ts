// ───────────────────────────────────────────────────────────────────────────
// Envoi de campagne email — worker de file, pas boucle monolithique.
//
// AVANT : une seule invocation résolvait l'audience et envoyait tout, avec un
// UPDATE SQL par destinataire. À 3 000 adresses la fonction dépassait le
// wall-clock et la campagne restait bloquée en 'sending', moitié partie.
//
// MAINTENANT, trois modes :
//
//   • test    → envoi direct à l'owner + jusqu'à 5 adresses (ne passe pas par
//               la file, ne consomme pas de quota, ne compte pas en warm-up).
//   • send    → constitue la file (enqueue), puis draine une première tranche.
//               Appelé par le pro depuis l'app.
//   • drain   → draine une tranche puis se ré-appelle. Appelé par lui-même et
//               par le cron (filet de sécurité si l'auto-chaînage se perd).
//
// Une tranche = ~45 s de travail, des lots de 100 espacés pour rester sous la
// limite de débit Resend, un marquage EN LOT, et un point de contrôle du
// disjoncteur toutes les 3 salves.
//
// GARANTIES ANTI-DOUBLON, à deux niveaux :
//   1. `claim_campaign_recipients` (FOR UPDATE SKIP LOCKED) — deux workers ne
//      réservent jamais la même adresse.
//   2. clé d'idempotence Resend — si un worker meurt entre l'appel HTTP et le
//      marquage, le rejeu du même lot ne ré-expédie pas.
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildCampaignHtml, slugifyVenueName, type EmailBlock } from '../_shared/campaign-html.ts';
import {
  renderStudioEmailHtml, fetchStudioLiveData, fetchRecipientConds, collectStudioConds,
  type StudioBlock, type StudioSocialLinks,
} from '../_shared/email-studio-html.ts';
import { shouldHideYunoBranding } from '../_shared/venue-plan.ts';
import { sendResendBatch, batchIdempotencyKey, sleep, type ResendEmail } from '../_shared/resend-batch.ts';
import { marketingDomain, senderScopeKey } from '../_shared/email-sender-identity.ts';
import { isSupportSessionToken } from '../_shared/support-session.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const PUBLIC_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://yunoapp.eu';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Budget de travail d'une invocation. Large marge sous le wall-clock d'une
// edge function : mieux vaut 3 tranches sereines qu'une tranche coupée net.
const SLICE_MS = Number(Deno.env.get('CAMPAIGN_SLICE_MS') || 45_000);
// Resend plafonne par défaut à ~2 req/s. 600 ms ≈ 1,6 req/s : on reste dessous.
const BATCH_SPACING_MS = Number(Deno.env.get('RESEND_BATCH_SPACING_MS') || 600);
const MAX_BATCH = 100;                    // limite dure de l'API batch Resend
const MAX_PAYLOAD_BYTES = 4_500_000;      // marge sous la limite de payload
const HEALTH_CHECK_EVERY = 3;             // salves entre deux contrôles du disjoncteur

interface Recipient {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribe_token?: string | null;
  /** 'a' | 'b' pendant la phase de test A/B, null = suit le gagnant. */
  ab_variant?: string | null;
  /** Règles de visibilité satisfaites (résolues par lot avant le rendu). */
  conds?: Set<string>;
}

// ── Quiet hours (Europe/Paris) — opt-in par campagne ───────────────────────
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 9;

function inQuietHours(now: Date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('fr-FR', {
    hour: 'numeric', hour12: false, timeZone: 'Europe/Paris',
  }).format(now));
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** Sujet du destinataire : variante de test, sinon le gagnant déclaré, sinon A. */
function subjectForRecipient(campaign: Record<string, unknown>, r: Recipient): string {
  const subjectA = campaign.subject as string;
  const subjectB = (campaign.subject_b as string) || '';
  if (!campaign.ab_enabled || !subjectB) return subjectA;
  const variant = r.ab_variant || (campaign.ab_winner as string) || 'a';
  return variant === 'b' ? subjectB : subjectA;
}

const makeAdmin = () => createClient(SUPABASE_URL, SERVICE_KEY);
type Admin = ReturnType<typeof makeAdmin>;

// ── Utilitaires ────────────────────────────────────────────────────────────

function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Auto-chaînage : la tranche suivante démarre sans attendre notre réponse. */
function chainNextSlice(campaignId: string) {
  const p = fetch(`${SUPABASE_URL}/functions/v1/send-campaign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ campaign_id: campaignId, mode: 'drain' }),
  }).catch((e) => console.error('chainNextSlice failed:', e instanceof Error ? e.message : e));

  // waitUntil garde la requête vivante après le retour de la réponse. S'il
  // n'existe pas, le cron reprendra la campagne à la minute suivante.
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

function unsubHeaders(token?: string | null): Record<string, string> {
  if (!token) return {};
  const url = `${PUBLIC_URL}/unsubscribe?token=${token}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// ── Résolution de l'expéditeur ─────────────────────────────────────────────

interface Sender {
  name: string;
  city: string | null;
  ownerUserId: string;
  from: string;
  replyTo: string | null;
  scopeKey: string;
  venueId: string | null;
  organizerUserId: string | null;
}

async function resolveSender(admin: Admin, campaign: Record<string, unknown>): Promise<Sender> {
  let name = '';
  let city: string | null = null;
  let ownerUserId: string | null = null;
  const venueId = (campaign.venue_id as string) || null;
  const organizerUserId = (campaign.organizer_user_id as string) || null;

  if (venueId) {
    const { data: venue } = await admin
      .from('venues').select('id, name, city, owner_id').eq('id', venueId).single();
    if (!venue) throw new Error('Venue not found');
    name = venue.name; city = venue.city; ownerUserId = venue.owner_id;
  } else if (organizerUserId) {
    const { data: p } = await admin
      .from('profiles').select('id, organization_name, first_name, last_name, city')
      .eq('id', organizerUserId).single();
    if (!p) throw new Error('Organizer not found');
    name = p.organization_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Organisateur';
    city = (p as { city?: string | null }).city ?? null;
    ownerUserId = p.id;
  } else {
    throw new Error('Campaign has no owner');
  }

  const { data: ownerProfile } = await admin
    .from('profiles').select('email, first_name, last_name').eq('id', ownerUserId!).single();

  return {
    name, city, ownerUserId: ownerUserId!,
    from: `${name} <${slugifyVenueName(name)}@${marketingDomain()}>`,
    replyTo: ownerProfile?.email || null,
    scopeKey: senderScopeKey(venueId, organizerUserId),
    venueId, organizerUserId,
  };
}

// ── Rendu ──────────────────────────────────────────────────────────────────

/**
 * Builder v2 (Email Studio) : renderer studio + données live des blocs Yuno,
 * résolues UNE FOIS par tranche — jamais par destinataire.
 */
async function makeStudioHtmlBuilder(
  admin: Admin,
  campaign: Record<string, unknown>,
  sender: Sender,
  opts: { ignoreConds?: boolean } = {},
) {
  const blocks = (((campaign.blocks_json as StudioBlock[]) || [])).map((b) => ({ ...b }));
  const campaignLogo = campaign.logo_url as string | null;
  if (campaignLogo) {
    for (const b of blocks) {
      if (b.type === 'header' && !b.logoUrl) b.logoUrl = campaignLogo;
    }
  }
  const hideBranding = sender.venueId ? await shouldHideYunoBranding(admin, sender.venueId) : false;
  const live = await fetchStudioLiveData(admin, blocks, (campaign.event_id as string) || null, PUBLIC_URL);

  return (r: Recipient) => renderStudioEmailHtml(blocks, campaign.theme_json, {
    venueName: sender.name,
    city: sender.city,
    emailType: campaign.type as 'promotional' | 'informational',
    subject: subjectForRecipient(campaign, r),
    preheader: (campaign.preheader as string) || undefined,
    recipient: { email: r.email, firstName: r.first_name, lastName: r.last_name, conds: r.conds },
    unsubscribeUrl: r.unsubscribe_token ? `${PUBLIC_URL}/unsubscribe?token=${r.unsubscribe_token}` : undefined,
    socialLinks: (campaign.social_links_json || {}) as StudioSocialLinks,
    hideBranding,
    baseUrl: PUBLIC_URL,
    campaignId: campaign.id as string,
    live,
    ignoreConds: !!opts.ignoreConds,
  });
}

/** Route vers le builder selon la version du modèle de blocs. */
async function makeBuilder(
  admin: Admin,
  campaign: Record<string, unknown>,
  sender: Sender,
  opts: { ignoreConds?: boolean } = {},
) {
  if (Number(campaign.blocks_version || 1) >= 2) {
    return makeStudioHtmlBuilder(admin, campaign, sender, opts);
  }
  return makeHtmlBuilder(admin, campaign, sender);
}

async function makeHtmlBuilder(admin: Admin, campaign: Record<string, unknown>, sender: Sender) {
  const blocks = ((campaign.blocks_json as EmailBlock[]) || []).slice();
  const campaignLogo = campaign.logo_url as string | null;
  if (campaignLogo) {
    for (const b of blocks) {
      if (b.type === 'header' && !(b as { logo_url?: string }).logo_url) {
        (b as { logo_url?: string }).logo_url = campaignLogo;
      }
    }
  }
  const theme = (campaign.theme_json || {}) as Record<string, unknown>;
  const socialLinks = (campaign.social_links_json || {}) as Record<string, unknown>;
  const hideBranding = sender.venueId ? await shouldHideYunoBranding(admin, sender.venueId) : false;

  return (r: Recipient) => buildCampaignHtml({
    blocks,
    preheader: campaign.preheader as string,
    subject: campaign.subject as string,
    venueName: sender.name,
    city: sender.city || undefined,
    recipientEmail: r.email,
    emailType: campaign.type as 'promotional' | 'informational',
    firstName: r.first_name || undefined,
    lastName: r.last_name || undefined,
    unsubscribeUrl: r.unsubscribe_token ? `${PUBLIC_URL}/unsubscribe?token=${r.unsubscribe_token}` : undefined,
    theme,
    socialLinks,
    hideBranding,
  });
}

// ── Le cœur : drainer une tranche ──────────────────────────────────────────

interface SliceResult {
  sent: number;
  failed: number;
  remaining: number;
  status: string;
  stopped: 'done' | 'deadline' | 'quota' | 'paused' | 'error' | 'quiet' | 'throttle' | 'ab_wait';
  detail?: string;
}

async function drainSlice(
  admin: Admin,
  campaignId: string,
  campaign: Record<string, unknown>,
  sender: Sender,
): Promise<SliceResult> {
  const buildHtml = await makeBuilder(admin, campaign, sender);
  // Règles de visibilité utilisées par la campagne — résolues PAR LOT plus
  // bas (une RPC par salve de 100, jamais par destinataire).
  const usedConds = Number(campaign.blocks_version || 1) >= 2
    ? collectStudioConds((campaign.blocks_json as StudioBlock[]) || [])
    : [];
  const deadline = Date.now() + SLICE_MS;

  let sent = 0;
  let failed = 0;
  let salvo = 0;

  // Calibrage AVANT la première réservation, sur un rendu témoin. Un email
  // lourd (images inline, longs blocs) × 100 dépasserait la limite de payload
  // et le premier lot partirait droit dans un 413.
  const sampleBytes = buildHtml({ email: 'calibrage@yunoapp.eu' }).length + 200;
  let batchSize = Math.max(10, Math.min(MAX_BATCH, Math.floor(MAX_PAYLOAD_BYTES / sampleBytes)));
  let stopped: SliceResult['stopped'] = 'done';
  let detail: string | undefined;
  let status = 'sending';

  while (true) {
    // 1. La campagne est-elle toujours en vol ? (pause manuelle, disjoncteur,
    //    annulation depuis l'app pendant qu'on envoie)
    const { data: live } = await admin
      .from('email_campaigns').select('status, paused_reason').eq('id', campaignId).single();
    status = (live?.status as string) || 'sending';
    if (status !== 'sending') {
      stopped = 'paused';
      detail = (live?.paused_reason as string) || status;
      break;
    }

    if (Date.now() >= deadline) { stopped = 'deadline'; break; }

    // 1 bis. Quiet hours (opt-in par campagne) : pas d'envoi la nuit, le cron
    // reprend la campagne au créneau suivant.
    if (campaign.quiet_hours === true && inQuietHours()) {
      stopped = 'quiet';
      detail = `quiet hours ${QUIET_START_HOUR}h→${QUIET_END_HOUR}h Europe/Paris`;
      break;
    }

    // 1 ter. Throttling (lissage du débit) : plafond d'envois par heure
    // glissante, opt-in par campagne. Même philosophie que le quota : on
    // s'arrête proprement, le cron reprend quand le budget se libère.
    let want = batchSize;
    if (campaign.throttle_per_hour != null) {
      const { count: sentLastHour } = await admin
        .from('email_campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'sent')
        .gte('sent_at', new Date(Date.now() - 3_600_000).toISOString());
      const hourBudget = Number(campaign.throttle_per_hour) - (sentLastHour ?? 0);
      if (hourBudget <= 0) { stopped = 'throttle'; break; }
      want = Math.max(1, Math.min(want, hourBudget));
    }

    // 2. Quota du jour (expéditeur + plateforme), consommé AVANT de réserver.
    const { data: grantedRaw, error: qErr } = await admin.rpc('consume_email_send_quota', {
      p_scope_key: sender.scopeKey,
      p_requested: want,
      p_venue_id: sender.venueId,
      p_organizer_user_id: sender.organizerUserId,
    });
    if (qErr) { stopped = 'error'; detail = `quota: ${qErr.message}`; break; }
    const granted = Number(grantedRaw || 0);
    if (granted <= 0) { stopped = 'quota'; break; }

    // 3. Réservation atomique.
    const { data: claimed, error: cErr } = await admin.rpc('claim_campaign_recipients', {
      p_campaign_id: campaignId,
      p_limit: granted,
    });
    if (cErr) {
      await admin.rpc('refund_email_send_quota', { p_scope_key: sender.scopeKey, p_amount: granted });
      stopped = 'error'; detail = `claim: ${cErr.message}`; break;
    }
    const rows = (claimed || []) as Recipient[];
    if (rows.length < granted) {
      // File plus courte que le quota accordé : on rend la différence, sinon
      // le pro perdrait du quota sans avoir envoyé.
      await admin.rpc('refund_email_send_quota', {
        p_scope_key: sender.scopeKey, p_amount: granted - rows.length,
      });
    }
    if (rows.length === 0) {
      // File « vide » mais phase de test A/B en cours : les lignes sans
      // variante ne sont pas réclamables tant que le gagnant n'est pas
      // déclaré (claim_campaign_recipients les gate). Le cron appellera
      // resolve_campaign_ab_winner à la fin de la fenêtre, puis reprendra.
      const abGate = campaign.ab_enabled === true
        && !!(campaign.subject_b as string)
        && !campaign.ab_winner;
      stopped = abGate ? 'ab_wait' : 'done';
      break;
    }

    // 3 bis. Blocs conditionnels : quelles règles CE lot satisfait-il ?
    if (usedConds.length > 0) {
      const condMap = await fetchRecipientConds(admin, campaignId, rows.map((r) => r.email), usedConds);
      for (const r of rows) r.conds = condMap.get(r.email.toLowerCase()) || new Set();
    }

    // 4. Rendu + calibrage du lot. Un HTML riche (images inline, longs blocs)
    //    peut faire exploser la taille du payload : on adapte plutôt que de se
    //    prendre un 413 en pleine campagne.
    const payload: ResendEmail[] = rows.map((r) => ({
      from: sender.from,
      to: [r.email],
      subject: subjectForRecipient(campaign, r),
      html: buildHtml(r),
      reply_to: sender.replyTo || undefined,
      headers: unsubHeaders(r.unsubscribe_token),
      tags: [{ name: 'campaign_id', value: campaignId }],
    }));

    const approxBytes = payload.reduce((n, p) => n + p.html.length + 200, 0);
    if (approxBytes > 0 && rows.length > 0) {
      const perEmail = approxBytes / rows.length;
      batchSize = Math.max(10, Math.min(MAX_BATCH, Math.floor(MAX_PAYLOAD_BYTES / perEmail)));
    }

    // 5. Envoi.
    const key = await batchIdempotencyKey(campaignId, rows.map((r) => r.email));
    const outcome = await sendResendBatch(RESEND_API_KEY!, payload, { idempotencyKey: key });

    if (outcome.ok) {
      const marked = rows.map((r, i) => ({ email: r.email, resend_email_id: outcome.ids[i] }));
      const { error: mErr } = await admin.rpc('mark_campaign_recipients_sent', {
        p_campaign_id: campaignId, p_rows: marked,
      });
      if (mErr) console.error('mark sent failed:', mErr.message);
      sent += rows.length;

      await admin.from('email_campaign_events').insert(
        rows.map((r, i) => ({
          campaign_id: campaignId,
          recipient_email: r.email,
          event_type: 'sent',
          resend_email_id: outcome.ids[i],
        })),
      );
    } else {
      // Transitoire → retour en file dans 2 min. Définitif → échec marqué.
      // Toujours remettre en file : un refus « définitif » de Resend est presque
      // toujours systémique (domaine non vérifié, clé invalide) donc réparable.
      // Ce qui empêche de boucler, c'est la pause de la campagne juste en
      // dessous, plus le plafond `attempts` de la RPC.
      const retryAt = new Date(Date.now() + (outcome.retryable ? 120_000 : 60_000)).toISOString();
      await admin.rpc('mark_campaign_recipients_failed', {
        p_campaign_id: campaignId,
        p_emails: rows.map((r) => r.email),
        p_error: outcome.error || 'send failed',
        p_retry_at: retryAt,
      });
      failed += rows.length;
      console.error(`batch failed (${outcome.status ?? 'net'}, retryable=${outcome.retryable}):`, outcome.error);

      if (!outcome.retryable) {
        // Domaine non vérifié, clé invalide, payload refusé : rien ne sert
        // d'insister, chaque lot suivant échouerait pareil.
        await admin.from('email_campaigns').update({
          status: 'paused',
          paused_reason: 'send_error',
          error_message: (outcome.error || 'Envoi refusé par Resend').slice(0, 500),
        }).eq('id', campaignId).eq('status', 'sending');
        stopped = 'error'; detail = outcome.error; break;
      }
      // Transitoire : on souffle un peu plus longtemps avant la salve suivante.
      await sleep(2000);
    }

    // 6. Disjoncteur — toutes les 3 salves, pas à chaque lot.
    salvo++;
    if (salvo % HEALTH_CHECK_EVERY === 0) {
      const { data: health } = await admin.rpc('campaign_circuit_breaker', { p_campaign_id: campaignId });
      if (health?.paused) {
        stopped = 'paused'; detail = health.reason; status = 'paused'; break;
      }
    }

    await sleep(BATCH_SPACING_MS);
  }

  // ── Clôture ───────────────────────────────────────────────────────────────
  const { count: remaining } = await admin
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'sending']);

  const left = remaining ?? 0;

  if (left === 0 && status === 'sending') {
    const { data: totals } = await admin
      .from('email_campaigns').select('recipients_count, failed_count').eq('id', campaignId).single();
    const okCount = Number(totals?.recipients_count || 0);
    await admin.from('email_campaigns').update({
      status: okCount > 0 ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      error_message: okCount === 0 ? 'Aucun envoi n\'a abouti' : null,
    }).eq('id', campaignId);
    status = okCount > 0 ? 'sent' : 'failed';
  } else if (left > 0 && status === 'sending' && (stopped === 'deadline' || stopped === 'quota')) {
    // Il reste du monde : le quota reprend demain, la deadline reprend tout de
    // suite. Dans les deux cas le cron garantit la reprise.
    if (stopped === 'deadline') chainNextSlice(campaignId);
  }

  return { sent, failed, remaining: left, status, stopped, detail };
}

// ── Notification owner en fin de campagne ──────────────────────────────────

async function notifyOwnerIfFinished(admin: Admin, campaignId: string, campaign: Record<string, unknown>, status: string) {
  if (status !== 'sent' || !campaign.venue_id) return;
  try {
    const { data: c } = await admin
      .from('email_campaigns')
      .select('recipients_count, failed_count, suppressed_count').eq('id', campaignId).single();
    const okCount = Number(c?.recipients_count || 0);
    const failedCount = Number(c?.failed_count || 0);
    await admin.from('staff_notifications').insert({
      venue_id: campaign.venue_id,
      target_role: 'owner',
      notification_type: 'campaign_sent',
      title: 'Campagne email envoyée',
      message: `"${campaign.subject}" — ${okCount} destinataire${okCount > 1 ? 's' : ''}${failedCount > 0 ? ` (${failedCount} échec${failedCount > 1 ? 's' : ''})` : ''}`,
      priority: 'normal',
      reference_type: 'email_campaign',
      reference_id: campaignId,
      metadata: { subject: campaign.subject, sent: okCount, failed: failedCount, suppressed: c?.suppressed_count || 0 },
    });
  } catch (e) {
    console.error('Owner notif error (campaign_sent):', e);
  }
}

// ── Envoi de test (hors file, hors quota) ──────────────────────────────────

async function sendTest(
  admin: Admin, campaignId: string, campaign: Record<string, unknown>, sender: Sender,
  testEmail: unknown, testEmails: unknown,
) {
  const { data: ownerProfile } = await admin
    .from('profiles').select('email, first_name, last_name').eq('id', sender.ownerUserId).single();

  const candidates: string[] = [];
  if (ownerProfile?.email) candidates.push(ownerProfile.email);
  if (typeof testEmail === 'string' && testEmail.trim()) candidates.push(testEmail.trim());
  if (Array.isArray(testEmails)) {
    for (const e of testEmails) if (typeof e === 'string' && e.trim()) candidates.push(e.trim());
  }
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const e of candidates) {
    const lower = e.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    targets.push(e);
    if (targets.length >= 6) break;
  }
  if (targets.length === 0) throw new Error('No test email available');

  // Test : tous les blocs sont rendus, y compris les conditionnels — le pro
  // doit voir l'email complet.
  const buildHtml = await makeBuilder(admin, campaign, sender, { ignoreConds: true });
  const payload: ResendEmail[] = targets.map((email) => ({
    from: sender.from,
    to: [email],
    subject: campaign.subject as string,
    html: buildHtml({
      email,
      first_name: ownerProfile?.first_name,
      last_name: ownerProfile?.last_name,
      unsubscribe_token: '00000000-0000-0000-0000-000000000000',
    }),
    reply_to: sender.replyTo || undefined,
    headers: unsubHeaders('00000000-0000-0000-0000-000000000000'),
    tags: [{ name: 'campaign_id', value: campaignId }],
  }));

  const outcome = await sendResendBatch(RESEND_API_KEY!, payload);
  if (!outcome.ok) throw new Error(outcome.error || 'Test send failed');
  return targets.length;
}

// ── Entrée ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const body = await req.json();
    const { campaign_id, send_test, test_email, test_emails, scheduled, mode } = body ?? {};
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id required' }), { status: 400, headers: jsonHeaders });
    }

    const admin = makeAdmin();
    const token = bearer(req);
    // Un appel interne (cron, auto-chaînage) PROUVE son identité par la clé de
    // service. L'ancien code se contentait du drapeau `scheduled` dans le corps :
    // n'importe qui pouvait déclencher l'envoi d'une campagne d'autrui.
    const internal = !!token && token === SERVICE_KEY;
    const wantsInternal = mode === 'drain' || scheduled === true;

    if (wantsInternal && !internal) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
    }

    let actingUserId: string | null = null;
    if (!wantsInternal) {
      if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
      actingUserId = userData.user.id;
    }

    const { data: campaign, error: cErr } = await admin
      .from('email_campaigns').select('*').eq('id', campaign_id).single();
    if (cErr || !campaign) throw new Error('Campaign not found');

    const sender = await resolveSender(admin, campaign);

    if (actingUserId && sender.ownerUserId !== actingUserId) {
      const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', actingUserId);
      const isAdmin = roles?.some((r: { role: string }) => r.role === 'admin');
      if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: jsonHeaders });
    }

    // ── Test ────────────────────────────────────────────────────────────────
    if (send_test) {
      const n = await sendTest(admin, campaign_id, campaign, sender, test_email, test_emails);
      return new Response(JSON.stringify({ success: true, sent: n, test: true }), { headers: jsonHeaders });
    }

    // ── Constitution de la file (mode 'send') ───────────────────────────────
    if (mode !== 'drain') {
      // Un envoi de masse part au nom du pro, vers ses clients, et rien ne le
      // rattrape une fois parti. Le support peut préparer la campagne et
      // l'envoyer en test à sa propre adresse (bloc `send_test` au-dessus,
      // volontairement laissé ouvert) ; appuyer sur « envoyer » à 5 000
      // personnes appartient au pro seul.
      if (token && !internal && await isSupportSessionToken(admin as unknown as Parameters<typeof isSupportSessionToken>[0], token)) {
        return new Response(JSON.stringify({ error: 'support_session_forbidden' }), { status: 403, headers: jsonHeaders });
      }
      if (['sent', 'cancelled'].includes(campaign.status)) {
        return new Response(JSON.stringify({ error: `Campagne déjà ${campaign.status}` }), { status: 409, headers: jsonHeaders });
      }
      // Le disjoncteur ne se contourne pas par un simple re-clic sur
      // « Envoyer ». Reprendre après une coupure pour plaintes ou adresses
      // mortes exige le bouton « Reprendre » de la barre de progression, qui
      // affiche le chiffre qui a déclenché la coupure et efface paused_reason.
      // On teste paused_reason et non le statut : l'éditeur repasse la
      // campagne en 'sending' avant même de nous appeler.
      if (['complaint_rate', 'bounce_rate'].includes(campaign.paused_reason as string)) {
        return new Response(JSON.stringify({
          error: 'circuit_breaker_paused',
          paused_reason: campaign.paused_reason,
        }), { status: 409, headers: jsonHeaders });
      }
      const { data: enq, error: eErr } = await admin.rpc('enqueue_campaign_recipients', { p_campaign_id: campaign_id });
      if (eErr) throw new Error(`Audience resolution failed: ${eErr.message}`);
      if (!enq || (Number(enq.total) - Number(enq.already_sent)) <= 0) {
        await admin.from('email_campaigns').update({
          status: 'failed',
          error_message: Number(enq?.suppressed || 0) > 0
            ? 'Aucun destinataire joignable (toutes les adresses sont sur la liste de suppression)'
            : 'Aucun destinataire pour cette audience',
        }).eq('id', campaign_id);
        return new Response(JSON.stringify({ error: 'No recipients found for this audience', detail: enq }), { status: 400, headers: jsonHeaders });
      }
      // A/B d'objet : assigner les variantes de la phase de test (no-op si la
      // campagne n'est pas en A/B ou si le gagnant est déjà déclaré).
      const { error: abErr } = await admin.rpc('assign_campaign_ab_variants', { p_campaign_id: campaign_id });
      if (abErr) console.error('assign_campaign_ab_variants:', abErr.message);

      // Un premier aperçu du rendu, conservé pour le rapport de campagne.
      if (!campaign.html_body) {
        const buildHtml = await makeBuilder(admin, campaign, sender, { ignoreConds: true });
        await admin.from('email_campaigns')
          .update({ html_body: buildHtml({ email: 'apercu@yunoapp.eu' }) })
          .eq('id', campaign_id);
      }

      const slice = await drainSlice(admin, campaign_id, campaign, sender);
      await notifyOwnerIfFinished(admin, campaign_id, campaign, slice.status);
      return new Response(JSON.stringify({ success: true, queued: enq, ...slice }), { headers: jsonHeaders });
    }

    // ── Tranche suivante (mode 'drain') ─────────────────────────────────────
    if (campaign.status !== 'sending') {
      return new Response(JSON.stringify({ success: true, skipped: campaign.status }), { headers: jsonHeaders });
    }
    const slice = await drainSlice(admin, campaign_id, campaign, sender);
    await notifyOwnerIfFinished(admin, campaign_id, campaign, slice.status);
    return new Response(JSON.stringify({ success: true, ...slice }), { headers: jsonHeaders });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('send-campaign error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: jsonHeaders });
  }
});
