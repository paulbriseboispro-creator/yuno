import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APP_BASE_URL = "https://yunoapp.eu";

const BASE_SYSTEM_PROMPT = `Tu es Yuno, un assistant sympa et accessible de l'application Yuno — l'app de nightlife pour les clubs et discothèques. Tu parles comme un pote qui connaît bien l'app, pas comme un robot. Tutoie toujours l'utilisateur. Réponds dans la langue de l'utilisateur (français, anglais ou espagnol).

IMPORTANT — Yuno est EXCLUSIVEMENT pour les clubs / discothèques / boîtes de nuit. On ne fait PAS les bars, restaurants, ou autres établissements.

Voici ce que tu sais sur Yuno :

🎫 BILLETTERIE — Achète tes billets, QR code unique, plusieurs tarifs (Early Bird, Regular, etc.)
💳 PAIEMENT — Carte bancaire, Apple Pay, Google Pay, Link (via Stripe)
🍸 CLICK & COLLECT — Commande depuis ton tel, paie, reçois un QR. Deux options : bar direct OU notif quand c'est prêt
📋 GUEST LIST — Inscription gratuite, QR, entrée gratuite avant une certaine heure
🏆 FIDÉLITÉ — Points par achat → récompenses. Bronze → Silver → Gold → Platinum
🍾 TABLES VIP — Réserve dans l'app, minimum conso, commande bouteilles depuis la table
📱 PROFIL — Stats, historique, badges dans "Mes Commandes"
🎵 DJs & ÉVÉNEMENTS — Découvre par ville/date/genre, pages DJ, favoris
🔍 EXPLORER — Soirées proches, filtres, carte interactive

═══ RÈGLES DE RÉPONSE ENRICHIE ═══

Tu as accès aux DONNÉES RÉELLES de Yuno ci-dessous. Utilise-les TOUJOURS pour répondre avec des infos concrètes.

FORMATAGE — Tu DOIS utiliser du Markdown dans tes réponses :
- **Gras** pour les noms importants, prix, dates
- [Liens cliquables](url) pour CHAQUE club, événement ou DJ que tu mentionnes
- Quand tu mentionnes un événement, ajoute TOUJOURS le lien : [Nom de l'event](lien)
- Quand tu mentionnes un club, ajoute TOUJOURS le lien : [Nom du club](lien)
- Quand tu mentionnes un DJ, ajoute le lien si disponible : [Nom DJ](lien)
- Si une image (poster, logo) est disponible, inclus-la avec la syntaxe : ![alt](url)
- Pour les événements, montre le poster si disponible
- Utilise des listes à puces pour les menus de boissons
- Utilise des titres ### pour structurer les réponses longues

RECOMMANDATIONS PROACTIVES :
- Si l'utilisateur demande des soirées, propose aussi des boissons populaires du club
- Si l'utilisateur demande un club, mentionne les prochains events
- Si l'utilisateur a un prochain event, rappelle-le naturellement
- Suggère la guest list si disponible
- Mentionne le programme de fidélité si pertinent

Ta personnalité :
- Cool, accessible, un peu enthousiaste
- Tutoie toujours
- Emojis naturels (1-2 par réponse max)
- Réponds en 2-4 phrases sauf si plus de détails demandés
- Si tu ne sais pas : "Hmm, je suis pas sûr de ça !"
- Ne parle JAMAIS de bars ou restaurants`;

function formatDateTz(dateStr: string, tz: string): string {
  const d = new Date(dateStr);
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = ['jan', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  return `${days[local.getDay()]} ${local.getDate()} ${months[local.getMonth()]} ${local.getFullYear()}, ${local.getHours()}h${String(local.getMinutes()).padStart(2, '0')}`;
}

function getNowTz(tz: string): string {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${days[local.getDay()]} ${local.getDate()} ${months[local.getMonth()]} ${local.getFullYear()}, ${local.getHours()}h${String(local.getMinutes()).padStart(2, '0')}`;
}

function buildRealDataContext(
  venues: any[],
  events: any[],
  ticketRounds: any[],
  drinks: any[],
  tablePacks: any[],
  guestLists: any[],
  djs: any[],
  djSets: any[],
  userStats: any,
  loyalty: any[],
  tz: string
): string {
  let ctx = "\n\n═══ DONNÉES RÉELLES YUNO ═══\n";

  // Venues with links
  if (venues.length > 0) {
    ctx += "\n📍 CLUBS PARTENAIRES :\n";
    for (const v of venues) {
      const link = `${APP_BASE_URL}/club/${v.id}`;
      ctx += `- **${v.name}** (${v.city}${v.address ? ', ' + v.address : ''})`;
      if (v.instagram_url) ctx += ` — Instagram: ${v.instagram_url}`;
      ctx += `\n  Lien app : ${link}`;
      if (v.logo_url) ctx += `\n  Logo : ${v.logo_url}`;
      if (v.cover_url) ctx += `\n  Cover : ${v.cover_url}`;
      ctx += `\n`;
    }
  }

  // DJs
  if (djs.length > 0) {
    ctx += "\n🎧 DJs :\n";
    for (const dj of djs) {
      const venue = venues.find((v: any) => v.id === dj.venue_id);
      const djName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;
      const link = dj.slug ? `${APP_BASE_URL}/dj/${dj.slug}` : null;
      ctx += `- **${djName}**`;
      if (venue) ctx += ` (${venue.name})`;
      if (dj.music_genres?.length) ctx += ` — ${dj.music_genres.join(', ')}`;
      if (link) ctx += `\n  Lien : ${link}`;
      if (dj.profile_image_url) ctx += `\n  Photo : ${dj.profile_image_url}`;
      if (dj.instagram_url) ctx += ` — Insta: ${dj.instagram_url}`;
      ctx += `\n`;
    }
  }

  // Events with ticket rounds, posters, links
  if (events.length > 0) {
    ctx += "\n🎉 PROCHAINS ÉVÉNEMENTS :\n";
    // Tag events happening today (Paris timezone)
    const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;

    for (const e of events) {
      const venue = venues.find((v: any) => v.id === e.venue_id);
      const venueName = venue?.name || 'Club';
      const eventLink = `${APP_BASE_URL}/club/${e.venue_id}/event/${e.id}`;
      
      const startLocal = new Date(new Date(e.start_at).toLocaleString('en-US', { timeZone: tz }));
      const startDateStr = `${startLocal.getFullYear()}-${String(startLocal.getMonth() + 1).padStart(2, '0')}-${String(startLocal.getDate()).padStart(2, '0')}`;
      const isTonight = startDateStr === todayStr;
      const isLive = new Date(e.start_at) <= new Date() && new Date(e.end_at) > new Date();
      
      let tag = '';
      if (isLive) tag = ' 🔴 EN COURS';
      else if (isTonight) tag = ' ⭐ CE SOIR';

      ctx += `\n- **"${e.title}"** au **${venueName}**${tag} — ${formatDateTz(e.start_at, tz)} à ${formatDateTz(e.end_at, tz)}`;
      if (e.music_genre) ctx += ` — ${e.music_genre}`;
      ctx += `\n  Lien : ${eventLink}`;
      if (e.poster_url) ctx += `\n  Poster : ${e.poster_url}`;
      else if (e.image_url) ctx += `\n  Image : ${e.image_url}`;

      // Ticket rounds
      const rounds = ticketRounds.filter((r: any) => r.event_id === e.id);
      if (rounds.length > 0) {
        const roundTexts = rounds.map((r: any) => {
          const remaining = r.max_tickets - r.tickets_sold;
          let txt = `${r.name} **${r.price}€**`;
          if (remaining <= 0) txt += ' (COMPLET)';
          else if (remaining <= Math.ceil(r.max_tickets * 0.2)) txt += ` (🔥 dernières places, reste ${remaining})`;
          else txt += ` (${remaining} places)`;
          return txt;
        });
        ctx += `\n  Billets : ${roundTexts.join(' | ')}`;
      }

      // DJs playing at this event
      const eventDjSets = djSets.filter((ds: any) => ds.event_id === e.id);
      if (eventDjSets.length > 0) {
        const djNames = eventDjSets.map((ds: any) => {
          const dj = djs.find((d: any) => d.id === ds.dj_id);
          return dj ? (dj.stage_name || dj.first_name) : null;
        }).filter(Boolean);
        if (djNames.length > 0) ctx += `\n  DJs : ${djNames.join(', ')}`;
      }

      // Guest list
      const gl = guestLists.find((g: any) => g.event_id === e.id);
      if (gl) {
        ctx += `\n  📋 Guest list dispo — Entrée gratuite avant ${gl.free_before_time}`;
        if (gl.includes_drink) ctx += ' + boisson offerte';
      }
      ctx += `\n`;
    }
  }

  // Drinks grouped by venue with images
  if (drinks.length > 0) {
    ctx += "\n🍸 CARTE DES BOISSONS :\n";
    const byVenue: Record<string, any[]> = {};
    for (const d of drinks) {
      if (!byVenue[d.venue_id]) byVenue[d.venue_id] = [];
      byVenue[d.venue_id].push(d);
    }
    for (const [venueId, venueDrinks] of Object.entries(byVenue)) {
      const venue = venues.find((v: any) => v.id === venueId);
      const venueName = venue?.name || venueId;
      ctx += `\n### ${venueName}\n`;

      const byCollection: Record<string, any[]> = {};
      for (const d of venueDrinks as any[]) {
        const col = d.collection || 'autre';
        if (!byCollection[col]) byCollection[col] = [];
        byCollection[col].push(d);
      }
      const collectionLabels: Record<string, string> = { drink: '🍺 Boissons', shot: '🥃 Shots', soft: '🥤 Softs' };
      for (const [col, items] of Object.entries(byCollection)) {
        ctx += `${collectionLabels[col] || col} :\n`;
        for (const d of items as any[]) {
          ctx += `- ${d.name} — **${d.price}€**`;
          if (d.promo_price) ctx += ` ~~${d.price}€~~ **${d.promo_price}€ promo**`;
          if (d.img_url) ctx += ` (image: ${d.img_url})`;
          ctx += `\n`;
        }
      }
    }
  }

  // VIP table packs
  if (tablePacks.length > 0) {
    ctx += "\n🍾 TABLES VIP :\n";
    const byVenue: Record<string, any[]> = {};
    for (const tp of tablePacks) {
      if (!byVenue[tp.venue_id]) byVenue[tp.venue_id] = [];
      byVenue[tp.venue_id].push(tp);
    }
    for (const [venueId, packs] of Object.entries(byVenue)) {
      const venue = venues.find((v: any) => v.id === venueId);
      ctx += `### ${venue?.name || venueId}\n`;
      for (const p of packs as any[]) {
        ctx += `- **${p.name}** : ${p.base_price}€, ${p.base_capacity} pers.`;
        if (p.minimum_spend > 0) ctx += `, minimum conso **${p.minimum_spend}€**`;
        ctx += `\n`;
      }
    }
  }

  // User personal stats
  if (userStats) {
    ctx += "\n👤 PROFIL DE L'UTILISATEUR :\n";
    ctx += `- **${userStats.nights_attended || 0}** soirées, **${userStats.drinks_ordered || 0}** boissons commandées\n`;
    if (userStats.favorite_club_name) {
      const favLink = userStats.favorite_club_id ? `${APP_BASE_URL}/club/${userStats.favorite_club_id}` : null;
      ctx += `- Club préféré : **${userStats.favorite_club_name}**${favLink ? ` — [Voir le club](${favLink})` : ''}\n`;
    }
    if (userStats.favorite_drink) ctx += `- Boisson préférée : **${userStats.favorite_drink}**\n`;
    if (userStats.next_event_title) {
      const nextLink = userStats.next_event_id && userStats.next_event_venue_id ? `${APP_BASE_URL}/club/${userStats.next_event_venue_id}/event/${userStats.next_event_id}` : null;
      ctx += `- 🎟️ Prochain event : **"${userStats.next_event_title}"** le ${formatDateTz(userStats.next_event_date, tz)}${nextLink ? ` — [Voir l'event](${nextLink})` : ''}\n`;
    }
    if (userStats.last_event_title) ctx += `- Dernier event : "${userStats.last_event_title}"\n`;
    if (userStats.total_spent > 0) ctx += `- Total dépensé : **${userStats.total_spent}€**\n`;
  }

  // Loyalty
  if (loyalty.length > 0) {
    ctx += "\n🏆 FIDÉLITÉ :\n";
    for (const l of loyalty) {
      const venue = venues.find((v: any) => v.id === l.venue_id);
      const tierLabel = (l.tier || 'bronze').charAt(0).toUpperCase() + (l.tier || 'bronze').slice(1);
      ctx += `- **${venue?.name || l.venue_id}** : ${tierLabel} (**${l.current_balance || 0}** points)\n`;
    }
  }

  // Navigation links
  ctx += `\n🔗 LIENS UTILES :\n`;
  ctx += `- Explorer les soirées : ${APP_BASE_URL}/explore\n`;
  ctx += `- Carte des clubs : ${APP_BASE_URL}/map\n`;
  ctx += `- Mes commandes : ${APP_BASE_URL}/my-orders\n`;
  ctx += `- Mon profil : ${APP_BASE_URL}/profile\n`;
  ctx += `- Mes favoris : ${APP_BASE_URL}/favorites\n`;

  return ctx;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, timezone } = await req.json();
    const tz = timezone || 'Europe/Paris';
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    // Fetch real data in parallel using service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date().toISOString();

    const [
      venuesRes,
      eventsRes,
      ticketRoundsRes,
      drinksRes,
      tablePacksRes,
      guestListsRes,
      djsRes,
      djSetsRes,
      userStatsRes,
      loyaltyRes,
    ] = await Promise.all([
      supabase.from("venues").select("id, name, city, address, instagram_url, logo_url, cover_url").limit(50),
      supabase.from("events")
        .select("id, venue_id, title, start_at, end_at, music_genre, ticketing_enabled, tables_enabled, poster_url, image_url")
        .gte("end_at", now)
        .eq("is_active", true)
        .order("start_at")
        .limit(20),
      supabase.from("ticket_rounds")
        .select("id, event_id, name, price, max_tickets, tickets_sold, is_active, position")
        .eq("is_active", true)
        .order("position")
        .limit(100),
      supabase.from("drinks")
        .select("id, venue_id, name, price, promo_price, collection, img_url")
        .eq("active", true)
        .order("position")
        .limit(100),
      supabase.from("table_packs")
        .select("id, venue_id, name, base_price, base_capacity, minimum_spend")
        .eq("is_active", true)
        .limit(50),
      supabase.from("guest_lists")
        .select("id, event_id, venue_id, free_before_time, includes_drink, is_active, quota")
        .eq("is_active", true)
        .limit(20),
      supabase.from("djs")
        .select("id, venue_id, first_name, last_name, stage_name, slug, music_genres, profile_image_url, instagram_url, is_active")
        .eq("is_active", true)
        .limit(50),
      supabase.from("dj_sets")
        .select("id, dj_id, event_id, start_time, end_time, music_genre")
        .gte("start_time", now)
        .limit(50),
      supabase.rpc("get_user_nightlife_stats", { p_user_id: user.id }),
      supabase.from("customer_loyalty")
        .select("venue_id, tier, current_balance, total_points_earned")
        .eq("user_id", user.id),
    ]);

    const realDataContext = buildRealDataContext(
      venuesRes.data || [],
      eventsRes.data || [],
      ticketRoundsRes.data || [],
      drinksRes.data || [],
      tablePacksRes.data || [],
      guestListsRes.data || [],
      djsRes.data || [],
      djSetsRes.data || [],
      userStatsRes.data?.[0] || null,
      loyaltyRes.data || [],
      tz
    );

    const currentDateTime = `\n\n⏰ DATE ET HEURE ACTUELLES (fuseau ${tz}) : ${getNowTz(tz)}\nUtilise cette info pour déterminer ce qui se passe "ce soir", "demain", "ce week-end". Un événement qui commence CE SOIR est bien un événement de ce soir, même si son start_at est dans quelques heures.\n`;

    const systemPrompt = BASE_SYSTEM_PROMPT + currentDateTime + realDataContext;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Trop de requêtes, réessaie dans quelques instants." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Service temporairement indisponible." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erreur du service AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("yuno-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
