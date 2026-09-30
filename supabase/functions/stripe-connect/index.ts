import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { releaseDjBookingBalance, refundDjBookingContract, computeDjEscrowFeeCents } from "../_shared/dj-payout.ts";
import { resolveReturnOrigin, safeReturnUrl } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoAccountGuard, demoPreviewGuard } from "../_shared/demo-guard.ts";
import {
  ConnectAccountCreateError,
  DEFAULT_CONNECT_COUNTRY,
  STRIPE_FULL_DASHBOARD_URL,
  StripeHttpError,
  UnsupportedConnectCountryError,
  connectStatusOf,
  createConnectedAccount,
  createOnboardingLink,
  dashboardUrlFor,
  normalizeConnectCountry,
  organizerConnectColumns,
  readConnectAccountState,
  venueConnectColumns,
  type ConnectAccountState,
  type ConnectContext,
  type ConnectLanguage,
  type NewConnectedAccount,
} from "../_shared/stripe-connect-accounts.ts";

// Unified Stripe Connect dispatcher.
// Replaces: organizer-stripe-connect-onboard, organizer-stripe-connect-status,
// stripe-connect-dashboard, stripe-connect-refresh.
// Route via body.action: "onboard" | "status" | "dashboard" | "refresh".
// Also hosts DJ secured-booking escrow actions (actor_type "dj" onboarding +
// "dj_booking_checkout" | "dj_booking_release" | "dj_booking_cancel") so no new
// edge function is needed — the 402 deploy cap blocks new functions.
//
// Comptes connectés = Accounts v2 depuis le 2026-09-29 (Stripe refuse le
// `type: "express"` hérité sur la plateforme Yuno). Création, lien
// d'onboarding, lecture d'état et lien de tableau de bord passent TOUS par
// _shared/stripe-connect-accounts.ts — lire son en-tête avant d'y toucher.
//
// Pays du compte (2026-09-29) : `onboard` reçoit `country` (ISO alpha-2, choisi
// par le pro dans la Console AVANT la création) et `language`. Le pays ne se
// change plus chez Stripe une fois le compte ouvert : un pays hors liste est
// refusé (`stripe_country_unsupported`) sans rien créer ; un appel SANS pays
// (bundle antérieur) garde la France, comme avant.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: Record<string, unknown>) =>
  console.log(`[STRIPE-CONNECT] ${s}`, d ? JSON.stringify(d) : "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

/** Texte que Stripe pré-remplit dans le formulaire (« description de l'activité »), dans la langue du pro. */
const PRODUCT_DESCRIPTIONS: Record<"organizer" | "venue" | "dj", Record<ConnectLanguage, string>> = {
  organizer: { fr: "Vente de billets pour événements", en: "Event ticket sales", es: "Venta de entradas para eventos" },
  venue: { fr: "Vente de tickets et services de boîte de nuit", en: "Nightclub tickets and services", es: "Venta de entradas y servicios de discoteca" },
  dj: { fr: "Prestation de DJ (cachet)", en: "DJ performance fee", es: "Actuación de DJ (caché)" },
};

/** Erreur métier avec un code que le front sait traduire (useStripeConnectError). */
class ConnectError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

// Actions de LECTURE : elles ne créent rien chez Stripe et ne font que recopier
// l'état du compte en base. Ouvertes à l'accès assisté (le support doit pouvoir
// voir où en est le pro) et à l'aperçu démo, comme `status` l'a toujours été.
const READ_ACTIONS = new Set(["status", "refresh"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("User not authenticated");
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    // Origine verrouillée sur la liste blanche CORS : les URLs de retour Stripe
    // (onboarding, portail, checkout séquestre DJ) ne reflètent jamais une
    // Origin forgée. Voir resolveReturnOrigin dans _shared/cors.ts.
    const { origin } = resolveReturnOrigin(req);
    log("Request", { userId: user.id, action });

    // Compte démo partagé (@womber.fr) : jamais de compte Stripe réel relié,
    // jamais de lien Express ni d'argent déplacé — Paul et l'agent compris.
    // Seules les lectures restent ouvertes ; en aperçu, rien du tout.
    {
      const demoRefusal = READ_ACTIONS.has(action)
        ? await demoPreviewGuard(req, corsHeaders)
        : await demoAccountGuard(req, corsHeaders);
      if (demoRefusal) return demoRefusal;
    }

    // Mode support (accès admin assisté) : lecture seule sur Stripe. Toute
    // action qui crée/modifie un compte connecté, mint un lien (onboarding,
    // tableau de bord : accès solde + compte bancaire) ou déplace de l'argent
    // est refusée — seules les lectures passent.
    if (!READ_ACTIONS.has(action) && (await isSupportSessionToken(supabaseAdmin, token))) {
      return json({ error: "support_session_forbidden", code: "support_session_forbidden" }, 403);
    }

    const connect: ConnectContext = { secretKey: stripeKey, log };

    // Langue de la Console du pro : emails Stripe et description pré-remplie.
    const language: ConnectLanguage | null = ["fr", "en", "es"].includes(body.language) ? body.language : null;

    // Pays d'un compte À CRÉER. Absent (bundle antérieur) = France, comme avant ;
    // présent mais hors liste = refus net, rien n'est créé chez Stripe.
    const creationCountry = (): string => {
      const raw = body.country;
      if (raw === undefined || raw === null || raw === "") return DEFAULT_CONNECT_COUNTRY;
      const country = normalizeConnectCountry(raw);
      if (!country) {
        throw new ConnectError(
          `Stripe accounts are not available for country "${String(raw).slice(0, 8)}"`,
          "stripe_country_unsupported",
          400,
        );
      }
      return country;
    };
    const descriptionLanguage = (country: string): ConnectLanguage =>
      language ?? (country === "FR" ? "fr" : country === "ES" ? "es" : "en");

    // Any venueId coming from the request body MUST belong to the caller. Every
    // owner branch below runs via service_role (RLS bypassed), so without this an
    // attacker could pass another club's id and either mint a Stripe login link to
    // that club's Express dashboard (balance / payouts / bank account) or
    // create/overwrite its connected account and hijack all future payouts.
    // Self-resolved paths (owner_id / profiles.venue_id lookups) are already
    // caller-scoped, so we only gate the body-supplied id.
    const assertOwnsBodyVenue = async (bodyVenueId: unknown): Promise<void> => {
      if (!bodyVenueId) return;
      const { data: owned } = await supabaseAdmin
        .from("venues")
        .select("id")
        .eq("id", bodyVenueId as string)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!owned) throw new Error("Unauthorized: you do not own this venue");
    };

    // Club du propriétaire : celui du body (vérifié), sinon le sien, sinon celui
    // de son profil. Jamais `.single()` : un owner de deux clubs le faisait lever.
    const resolveOwnerVenueId = async (bodyVenueId: unknown): Promise<string | null> => {
      await assertOwnsBodyVenue(bodyVenueId);
      if (bodyVenueId) return bodyVenueId as string;
      const { data: owned } = await supabaseAdmin
        .from("venues")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (owned?.id) return owned.id;
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("venue_id")
        .eq("id", user.id)
        .maybeSingle();
      return profile?.venue_id ?? null;
    };

    // Création d'un compte : un refus Stripe devient une erreur codée pour le
    // front ET une alerte super admin — c'est ce qui a manqué le 29/09, quand le
    // premier organisateur réel n'a vu que « Edge Function returned a non-2xx ».
    const createAccountOrExplain = async (
      spec: NewConnectedAccount,
      who: { kind: "organizer" | "venue" | "dj"; id: string; name?: string | null },
    ): Promise<string> => {
      try {
        const created = await createConnectedAccount(connect, spec);
        return created.id;
      } catch (err) {
        if (err instanceof UnsupportedConnectCountryError) {
          throw new ConnectError(err.message, "stripe_country_unsupported", 400);
        }
        const attempts = err instanceof ConnectAccountCreateError ? err.attempts : [];
        const message = err instanceof Error ? err.message : String(err);
        log("Connected account creation failed", { who, message, attempts });
        try {
          await supabaseAdmin.rpc("emit_admin_notification", {
            p_type: "admin_stripe_connect_failed",
            p_title: "Stripe refuse l'ouverture d'un compte",
            p_message: `${who.name || who.kind} (${who.kind}, ${spec.country}) n'a pas pu relier Stripe : ${message}`.slice(0, 480),
            p_priority: "high",
            p_reference_type: who.kind,
            p_reference_id: who.id,
            p_metadata: { kind: who.kind, id: who.id, country: spec.country, attempts },
            p_dedup_key: `stripe_connect_failed:${who.kind}:${who.id}:${new Date().toISOString().slice(0, 10)}`,
            p_event_id: null,
          });
        } catch (alertErr) {
          log("Admin alert failed", { message: (alertErr as Error).message });
        }
        throw new ConnectError(message, "stripe_account_create_failed", 502);
      }
    };

    const onboardingLinkOrExplain = async (accountId: string, urls: { refreshUrl: string; returnUrl: string }) => {
      try {
        return await createOnboardingLink(connect, accountId, urls);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("Onboarding link failed", { accountId, message });
        throw new ConnectError(message, "stripe_onboarding_link_failed", 502);
      }
    };

    const readState = async (accountId: string): Promise<ConnectAccountState> => {
      try {
        return await readConnectAccountState(connect, accountId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ConnectError(message, "stripe_status_unavailable", 502);
      }
    };

    // Miroirs en base — mêmes colonnes et même règle que le webhook account.updated.
    const persistOrganizer = async (userId: string, state: ConnectAccountState, onboardedAt: string | null) => {
      const columns = organizerConnectColumns(state, { onboardedAt });
      const { error } = await supabaseAdmin
        .from("profiles")
        .update(columns)
        .eq("id", userId);
      if (error) log("Organizer status write failed", { error: error.message });
      return { status: connectStatusOf(state), onboardedAt: columns.stripe_connect_onboarded_at as string | null };
    };
    const persistVenue = async (venueId: string, state: ConnectAccountState) => {
      const { error } = await supabaseAdmin
        .from("venues")
        .update(venueConnectColumns(state))
        .eq("id", venueId);
      if (error) log("Venue status write failed", { error: error.message });
    };
    const persistDj = async (userId: string, state: ConnectAccountState) => {
      const status = connectStatusOf(state);
      await supabaseAdmin
        .from("dj_stripe_accounts")
        .update({
          status,
          charges_enabled: state.chargesEnabled,
          payouts_enabled: state.payoutsEnabled,
          onboarding_complete: state.detailsSubmitted,
          onboarded_at: status === "active" ? new Date().toISOString() : null,
        })
        .eq("user_id", userId);
      // Onboarding done → unblock any contracts waiting on the DJ's Stripe setup.
      if (state.payoutsEnabled) {
        await supabaseAdmin.rpc("advance_dj_contracts_after_onboarding", { p_user_id: userId });
      }
      return status;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // action: "onboard"  (← organizer-stripe-connect-onboard)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "onboard") {
      const actorType: "organizer" | "owner" | "dj" = body.actor_type || "organizer";

      // ─── Organizer path ─────────────────────────────────────────────────────
      if (actorType === "organizer") {
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, profile_type, organization_name, stripe_connect_account_id")
          .eq("id", user.id)
          .maybeSingle();

        if (profileErr || !profile) throw new Error("Profile not found");
        if (profile.profile_type !== "organizer") {
          throw new ConnectError("Stripe Connect onboarding réservé aux organisateurs.", "not_organizer", 403);
        }

        let accountId = profile.stripe_connect_account_id;
        if (!accountId) {
          // Compte ASSOCIATION (bde_verified) : le formulaire Stripe s'ouvre sur
          // « Association / organisme à but non lucratif », au nom légal de
          // l'asso — sinon le président choisit « Particulier » par défaut et
          // l'argent de l'association part sur son compte personnel. Ce
          // pré-remplissage n'est jamais bloquant (retiré si Stripe le refuse).
          const { data: orgProfile } = await supabaseAdmin
            .from("organizer_profiles")
            .select("bde_verified, legal_name, display_name")
            .eq("user_id", user.id)
            .maybeSingle();
          const isAssociation = orgProfile?.bde_verified === true;
          const displayName = orgProfile?.display_name || profile.organization_name || null;
          const country = creationCountry();
          log("Creating new organizer connected account", { association: isAssociation, country });
          accountId = await createAccountOrExplain({
            purpose: "seller",
            country,
            language,
            email: profile.email ?? user.email ?? null,
            displayName,
            entityType: isAssociation ? "non_profit" : null,
            registeredName: isAssociation ? (orgProfile?.legal_name || displayName) : null,
            productDescription: PRODUCT_DESCRIPTIONS.organizer[descriptionLanguage(country)],
            metadata: { user_id: user.id, profile_type: "organizer", platform: "yuno", association: isAssociation ? "1" : "0", country },
          }, { kind: "organizer", id: user.id, name: displayName });
          const { error: saveErr } = await supabaseAdmin
            .from("profiles")
            .update({ stripe_connect_account_id: accountId, stripe_connect_status: "pending" })
            .eq("id", user.id);
          if (saveErr) {
            // Le compte existe chez Stripe : sans cette ligne, le prochain clic en
            // créerait un second. On le dit fort plutôt que de continuer.
            log("CRITICAL: organizer account created but not saved", { accountId, error: saveErr.message });
            throw new Error("Failed to save Stripe account ID");
          }
          log("Organizer Stripe account created", { accountId });
        }

        // Retour paramétrable (étape Paiements de l'onboarding) : même liste
        // blanche que le club (safeReturnUrl), sinon la page Paiements.
        const url = await onboardingLinkOrExplain(accountId, {
          refreshUrl: safeReturnUrl(body.refreshUrl, `${origin}/organizer-app/settings?stripe=refresh`),
          returnUrl: safeReturnUrl(body.returnUrl, `${origin}/organizer-app/settings?stripe=success`),
        });
        return json({ success: true, url, accountId });
      }

      // ─── DJ path (secured-booking payee) ──────────────────────────────────────
      // A DJ's Stripe account is PER PERSON (keyed on user_id), not per djs row
      // (a person has N djs rows, one per venue). Stored in dj_stripe_accounts.
      if (actorType === "dj") {
        const { data: acct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        let accountId = acct?.stripe_account_id ?? null;
        if (!accountId) {
          const country = creationCountry();
          log("Creating new DJ connected account", { country });
          accountId = await createAccountOrExplain({
            purpose: "payee",
            country,
            language,
            email: user.email ?? null,
            entityType: "individual",
            productDescription: PRODUCT_DESCRIPTIONS.dj[descriptionLanguage(country)],
            metadata: { user_id: user.id, profile_type: "dj", platform: "yuno", country },
          }, { kind: "dj", id: user.id, name: user.email });
          const { error: saveErr } = await supabaseAdmin
            .from("dj_stripe_accounts")
            .upsert({ user_id: user.id, stripe_account_id: accountId, status: "pending" });
          if (saveErr) {
            log("CRITICAL: DJ account created but not saved", { accountId, error: saveErr.message });
            throw new Error("Failed to save Stripe account ID");
          }
          log("DJ Stripe account created", { accountId });
        }

        const url = await onboardingLinkOrExplain(accountId, {
          refreshUrl: `${origin}/dj/bookings?stripe=refresh`,
          returnUrl: `${origin}/dj/bookings?stripe=success`,
        });
        return json({ success: true, url, accountId });
      }

      // ─── Owner path ─────────────────────────────────────────────────────────
      const { refreshUrl, returnUrl } = body;
      const targetVenueId = await resolveOwnerVenueId(body.venueId);
      if (!targetVenueId) throw new ConnectError("No venue found for this user", "no_venue", 404);
      log("Target venue", { venueId: targetVenueId });

      const { data: venue, error: venueError } = await supabaseAdmin
        .from("venues")
        .select("id, name, stripe_account_id")
        .eq("id", targetVenueId)
        .maybeSingle();

      if (venueError || !venue) throw new Error("Venue not found");

      let stripeAccountId = venue.stripe_account_id;
      if (!stripeAccountId) {
        const country = creationCountry();
        log("Creating new owner connected account", { country });
        stripeAccountId = await createAccountOrExplain({
          purpose: "seller",
          country,
          language,
          email: user.email ?? null,
          displayName: venue.name,
          entityType: "company",
          productDescription: PRODUCT_DESCRIPTIONS.venue[descriptionLanguage(country)],
          metadata: { venue_id: targetVenueId, platform: "yuno", country },
        }, { kind: "venue", id: targetVenueId, name: venue.name });
        log("Owner Stripe account created", { accountId: stripeAccountId });
        const { error: updateError } = await supabaseAdmin
          .from("venues")
          .update({ stripe_account_id: stripeAccountId })
          .eq("id", targetVenueId);
        if (updateError) {
          log("CRITICAL: owner account created but not saved", { accountId: stripeAccountId, error: updateError.message });
          throw new Error("Failed to save Stripe account ID");
        }
      } else {
        log("Using existing owner Stripe account", { accountId: stripeAccountId });
      }

      // refreshUrl/returnUrl viennent du body : mêmes origines que la liste
      // blanche CORS uniquement (safeReturnUrl), sinon la page Paiements — celle
      // qui porte la carte Stripe et relit l'état au retour.
      const url = await onboardingLinkOrExplain(stripeAccountId, {
        refreshUrl: safeReturnUrl(refreshUrl, `${origin}/owner/billing?stripe=refresh`),
        returnUrl: safeReturnUrl(returnUrl, `${origin}/owner/billing?stripe=success`),
      });

      log("Onboarding link created", { accountId: stripeAccountId });
      return json({ success: true, url, accountId: stripeAccountId });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "status"  (← organizer-stripe-connect-status)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "status") {
      // ─── DJ status (dj_stripe_accounts, keyed on user_id) ────────────────────
      if (body.actor_type === "dj") {
        const { data: acct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!acct?.stripe_account_id) {
          return json({ connected: false, status: "none", chargesEnabled: false, payoutsEnabled: false });
        }
        if (acct.stripe_account_id.startsWith("acct_demo")) {
          return json({ connected: true, status: "active", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirements: null, demo: true });
        }

        const state = await readState(acct.stripe_account_id);
        const djStatus = await persistDj(user.id, state);
        return json({
          connected: true,
          accountId: acct.stripe_account_id,
          status: djStatus,
          chargesEnabled: state.chargesEnabled,
          payoutsEnabled: state.payoutsEnabled,
          detailsSubmitted: state.detailsSubmitted,
          requirements: state.requirements,
          country: state.country,
        });
      }

      const { data: profile, error: profileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_onboarded_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profileErr) throw profileErr;

      if (!profile?.stripe_connect_account_id) {
        return json({
          connected: false,
          status: "none",
          chargesEnabled: false,
          payoutsEnabled: false,
        });
      }

      // Sentinelle démo (`acct_demo_…`, seed womber) : compte FICTIF, inconnu
      // de Stripe. L'interroger rend un 400 « does not have access to account »
      // à chaque ouverture de la Console démo — on rend l'état semé, tel quel.
      if (profile.stripe_connect_account_id.startsWith("acct_demo")) {
        return json({
          connected: true,
          accountId: profile.stripe_connect_account_id,
          status: profile.stripe_connect_status || "active",
          chargesEnabled: !!profile.stripe_connect_charges_enabled,
          payoutsEnabled: !!profile.stripe_connect_payouts_enabled,
          onboardedAt: profile.stripe_connect_onboarded_at ?? null,
          detailsSubmitted: true,
          requirements: null,
          demo: true,
        });
      }

      const state = await readState(profile.stripe_connect_account_id);
      const { status, onboardedAt } = await persistOrganizer(user.id, state, profile.stripe_connect_onboarded_at ?? null);
      log("Status synced", { userId: user.id, status, chargesEnabled: state.chargesEnabled, payoutsEnabled: state.payoutsEnabled, source: state.source });

      return json({
        connected: true,
        accountId: profile.stripe_connect_account_id,
        status,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        onboardedAt,
        requirements: state.requirements,
        dashboard: state.dashboard,
        country: state.country,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "dashboard"  (← stripe-connect-dashboard)
    // Formulaire pas fini → on renvoie au formulaire. Sinon : lien de connexion
    // Express, ou dashboard.stripe.com pour un compte au tableau de bord complet
    // (tous les comptes v2 de Yuno : le pro s'y connecte avec SES identifiants).
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "dashboard") {
      const actorType: string = body.actor_type || "owner";

      const dashboardFor = async (accountId: string, urls: { refreshUrl: string; returnUrl: string }) => {
        const state = await readState(accountId);
        if (!state.detailsSubmitted) {
          const url = await onboardingLinkOrExplain(accountId, urls);
          return json({ success: true, url, needsOnboarding: true });
        }
        try {
          const url = await dashboardUrlFor(connect, accountId, state);
          return json({ success: true, url, dashboard: state.dashboard });
        } catch (err) {
          if (err instanceof StripeHttpError) {
            log("Login link refused, falling back to dashboard.stripe.com", { accountId, message: err.message });
            return json({ success: true, url: STRIPE_FULL_DASHBOARD_URL, dashboard: state.dashboard });
          }
          throw err;
        }
      };

      if (actorType === "dj") {
        const { data: acct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("stripe_account_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!acct?.stripe_account_id) throw new ConnectError("Stripe Connect non configuré.", "not_connected", 404);
        return await dashboardFor(acct.stripe_account_id, {
          refreshUrl: `${origin}/dj/bookings?stripe=refresh`,
          returnUrl: `${origin}/dj/bookings?stripe=success`,
        });
      }

      if (actorType === "organizer") {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("stripe_connect_account_id")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile?.stripe_connect_account_id) {
          throw new ConnectError("Stripe Connect non configuré.", "not_connected", 404);
        }
        if (profile.stripe_connect_account_id.startsWith("acct_demo")) {
          throw new ConnectError("Compte Stripe de démonstration : pas de tableau de bord Stripe.", "demo_account", 400);
        }
        return await dashboardFor(profile.stripe_connect_account_id, {
          refreshUrl: `${origin}/organizer-app/settings?stripe=refresh`,
          returnUrl: `${origin}/organizer-app/settings?stripe=success`,
        });
      }

      // Default: owner flow
      const targetVenueId = await resolveOwnerVenueId(body.venueId);
      if (!targetVenueId) throw new ConnectError("No venue found for this user", "no_venue", 404);

      const { data: venue, error: venueError } = await supabaseAdmin
        .from("venues")
        .select("id, stripe_account_id")
        .eq("id", targetVenueId)
        .maybeSingle();

      if (venueError || !venue) throw new Error("Venue not found");
      if (!venue.stripe_account_id) throw new ConnectError("No Stripe account connected", "not_connected", 404);

      return await dashboardFor(venue.stripe_account_id, {
        refreshUrl: `${origin}/owner/billing?stripe=refresh`,
        returnUrl: `${origin}/owner/billing?stripe=success`,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // action: "refresh"  (← stripe-connect-refresh) — état du compte d'un CLUB
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "refresh") {
      const targetVenueId = await resolveOwnerVenueId(body.venueId);
      if (!targetVenueId) throw new ConnectError("No venue found for this user", "no_venue", 404);

      const { data: venue, error: venueError } = await supabaseAdmin
        .from("venues")
        .select("id, name, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarding_complete")
        .eq("id", targetVenueId)
        .maybeSingle();

      if (venueError || !venue) throw new Error("Venue not found");

      if (!venue.stripe_account_id) {
        log("No Stripe account connected");
        return json({
          success: true,
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingComplete: false,
        });
      }

      if (venue.stripe_account_id.startsWith("acct_demo")) {
        return json({
          success: true,
          connected: true,
          accountId: venue.stripe_account_id,
          chargesEnabled: !!venue.stripe_charges_enabled,
          payoutsEnabled: !!venue.stripe_payouts_enabled,
          onboardingComplete: !!venue.stripe_onboarding_complete,
          requiresAction: false,
          demo: true,
        });
      }

      const state = await readState(venue.stripe_account_id);
      log("Stripe account retrieved", {
        accountId: venue.stripe_account_id,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        source: state.source,
      });
      await persistVenue(targetVenueId, state);

      return json({
        success: true,
        connected: true,
        accountId: venue.stripe_account_id,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        onboardingComplete: state.detailsSubmitted,
        requiresAction: !state.chargesEnabled || !state.detailsSubmitted,
        requirements: state.requirements,
        dashboard: state.dashboard,
        country: state.country,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DJ secured booking — escrow actions (club side, JWT-authenticated).
    // Authorization reuses RLS: a user-scoped client can only SELECT the contract
    // if they are the booker or the DJ. Paying/releasing is booker-only, so we
    // also require the caller is NOT the DJ.
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "dj_booking_checkout" || action === "dj_booking_release" || action === "dj_booking_cancel") {
      const contractId: string = body.contractId || body.contract_id;
      if (!contractId) throw new Error("contractId is required");

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
      );
      const { data: visible } = await userClient
        .from("dj_booking_contracts")
        .select("id, dj_user_id")
        .eq("id", contractId)
        .maybeSingle();
      if (!visible) throw new Error("Contract not found or unauthorized");
      const callerIsDj = visible.dj_user_id === user.id;

      const { data: contract } = await supabaseAdmin
        .from("dj_booking_contracts")
        .select("*, dj:djs(stage_name, first_name, last_name)")
        .eq("id", contractId)
        .maybeSingle();
      if (!contract) throw new Error("Contract not found");

      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // ── Checkout: the club pays the cachet (+ Stripe fee) into Yuno escrow. ──
      if (action === "dj_booking_checkout") {
        if (callerIsDj) throw new Error("Only the booker can pay");
        if (contract.status !== "pending_payment") {
          throw new Error(`Contract not ready for payment (status=${contract.status})`);
        }
        const { data: djAcct } = await supabaseAdmin
          .from("dj_stripe_accounts")
          .select("payouts_enabled")
          .eq("user_id", contract.dj_user_id)
          .maybeSingle();
        if (!djAcct?.payouts_enabled) throw new Error("DJ Stripe account not ready for payouts");

        // Yuno secured-booking add-on fee (4% of cachet, min 2€, cap 250€), paid by the
        // club on top of the cachet. The DJ still receives 100%. Snapshot it on the contract.
        const escrowFeeCents = computeDjEscrowFeeCents(contract.cachet_cents);
        const cachetLineCents = contract.cachet_cents + contract.stripe_fee_cents;
        await supabaseAdmin
          .from("dj_booking_contracts")
          .update({ yuno_fee_cents: escrowFeeCents })
          .eq("id", contract.id);
        const djName = contract.dj?.stage_name
          || `${contract.dj?.first_name ?? ""} ${contract.dj?.last_name ?? ""}`.trim()
          || "DJ";

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: contract.currency,
                product_data: { name: `Cachet DJ — ${djName}`, description: "Paiement sécurisé Yuno (séquestre)" },
                unit_amount: cachetLineCents,
              },
              quantity: 1,
            },
            ...(escrowFeeCents > 0 ? [{
              price_data: {
                currency: contract.currency,
                product_data: { name: "Frais de service Yuno", description: "Garantie de paiement sécurisé" },
                unit_amount: escrowFeeCents,
              },
              quantity: 1,
            }] : []),
          ],
          // successUrl/cancelUrl viennent du body : mêmes origines que la liste
          // blanche CORS uniquement (safeReturnUrl), sinon retour par défaut.
          success_url: safeReturnUrl(body.successUrl, `${origin}/owner/djs?booking=paid`),
          cancel_url: safeReturnUrl(body.cancelUrl, `${origin}/owner/djs?booking=cancelled`),
          customer_email: user.email ?? undefined,
          payment_method_types: ["card"],
          payment_intent_data: {
            metadata: {
              escrow: "dj_booking",
              contract_id: contract.id,
              dj_user_id: contract.dj_user_id,
              cachet_cents: String(contract.cachet_cents),
              acompte_cents: String(contract.acompte_cents),
              yuno_fee_cents: String(escrowFeeCents),
            },
          },
          metadata: { escrow: "dj_booking", contract_id: contract.id },
        });
        return json({ success: true, url: session.url });
      }

      // ── Release: the club confirms the gig happened → transfer the balance. ──
      if (action === "dj_booking_release") {
        if (callerIsDj) throw new Error("Only the booker can confirm the gig");
        const res = await releaseDjBookingBalance(stripe, supabaseAdmin, contract);
        return json({ success: res.released, reason: res.reason });
      }

      // ── Cancel after funding: refund the held balance to the club. ──
      if (action === "dj_booking_cancel") {
        const res = await refundDjBookingContract(stripe, supabaseAdmin, contract);
        return json({ success: res.refunded, reason: res.reason });
      }
    }

    throw new Error(`Unknown or missing action: ${action ?? "(none)"}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { message: msg });
    // Un code stable accompagne le message : le front affiche une phrase dans la
    // langue du pro au lieu de « Edge Function returned a non-2xx status code ».
    if (e instanceof ConnectError) return json({ error: msg, code: e.code }, e.status);
    return json({ error: msg }, 400);
  }
});
