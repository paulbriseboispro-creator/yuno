import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get('Authorization')!;
    const userToken = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(userToken);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Vous devez être connecté pour accepter cette invitation' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load invitation (no auto-join to venues so org invites work)
    const { data: invitation, error: inviteError } = await supabase
      .from('dj_invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (inviteError || !invitation) {
      return new Response(JSON.stringify({ error: 'Invitation non trouvée' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (invitation.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Cette invitation a déjà été utilisée' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await supabase.from('dj_invitations').update({ status: 'expired' }).eq('id', invitation.id);
      return new Response(JSON.stringify({ error: 'Cette invitation a expiré' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Email match
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', user.id).single();
    if (!profile || profile.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return new Response(JSON.stringify({
        error: 'Cette invitation est destinée à une autre adresse email',
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isVenueScope = !!invitation.venue_id;
    const isOrgScope = !!invitation.organizer_user_id;

    if (!isVenueScope && !isOrgScope) {
      return new Response(JSON.stringify({ error: 'Invitation invalide (aucun scope)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Already linked?
    let scopeQuery = supabase.from('djs').select('id').eq('user_id', user.id);
    scopeQuery = isVenueScope
      ? scopeQuery.eq('venue_id', invitation.venue_id)
      : scopeQuery.eq('organizer_user_id', invitation.organizer_user_id);
    const { data: existingDJ } = await scopeQuery.limit(1);

    let venueName: string | null = null;
    if (isVenueScope) {
      const { data: v } = await supabase.from('venues').select('name').eq('id', invitation.venue_id).single();
      venueName = v?.name ?? null;
    }

    if (existingDJ && existingDJ.length > 0) {
      await supabase
        .from('dj_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      // Ensure dj role exists in user_roles even if profile was already linked
      await supabase
        .from('user_roles')
        .upsert({ user_id: user.id, role: 'dj' }, { onConflict: 'user_id,role' });

      return new Response(JSON.stringify({
        success: true,
        message: isVenueScope ? 'Vous êtes déjà DJ pour ce club' : 'Vous êtes déjà DJ pour cette organisation',
        venue_name: venueName,
        venue_id: invitation.venue_id,
        organizer_user_id: invitation.organizer_user_id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Source DJ profile to clone. A DJ can have several scoped rows (one per club/org);
    // pick the richest one — the record that actually carries their uploaded photos — so the
    // new roster record inherits the DJ's real profile + cover, not an empty scoped stub.
    const { data: allDJProfiles, error: djProfileError } = await supabase
      .from('djs')
      .select('*')
      .eq('user_id', user.id);

    if (djProfileError || !allDJProfiles || allDJProfiles.length === 0) {
      return new Response(JSON.stringify({
        error: "Profil DJ existant non trouvé. Impossible d'accepter l'invitation.",
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mediaScore = (d: Record<string, any>) => (d.cover_image_url ? 2 : 0) + (d.profile_image_url ? 1 : 0);
    const existingDJProfile = [...allDJProfiles].sort((a, b) => {
      const byMedia = mediaScore(b) - mediaScore(a);
      if (byMedia !== 0) return byMedia;
      const at = new Date(a.updated_at || a.created_at || 0).getTime();
      const bt = new Date(b.updated_at || b.created_at || 0).getTime();
      return bt - at;
    })[0];

    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      first_name: existingDJProfile.first_name,
      last_name: existingDJProfile.last_name,
      stage_name: existingDJProfile.stage_name,
      music_genres: existingDJProfile.music_genres || [],
      bio: existingDJProfile.bio,
      description: existingDJProfile.description,
      instagram_url: existingDJProfile.instagram_url,
      tiktok_url: existingDJProfile.tiktok_url,
      soundcloud_url: existingDJProfile.soundcloud_url,
      spotify_url: existingDJProfile.spotify_url,
      youtube_url: existingDJProfile.youtube_url,
      whatsapp_number: existingDJProfile.whatsapp_number,
      city: existingDJProfile.city,
      country: existingDJProfile.country,
      profile_image_url: existingDJProfile.profile_image_url,
      cover_image_url: existingDJProfile.cover_image_url,
      is_verified: existingDJProfile.is_verified,
      is_active: true,
    };
    if (isVenueScope) insertPayload.venue_id = invitation.venue_id;
    if (isOrgScope) insertPayload.organizer_user_id = invitation.organizer_user_id;

    const { error: djError } = await supabase.from('djs').insert(insertPayload);

    if (djError) {
      console.error('Error creating DJ profile:', djError);
      return new Response(JSON.stringify({ error: 'Erreur lors de la création du profil DJ' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ensure dj role exists in user_roles (idempotent)
    await supabase
      .from('user_roles')
      .upsert({ user_id: user.id, role: 'dj' }, { onConflict: 'user_id,role' });

    await supabase
      .from('dj_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    // Owner notification: new DJ connected
    if (invitation.venue_id) {
      try {
        const djName = [existingDJProfile.stage_name, existingDJProfile.first_name, existingDJProfile.last_name]
          .filter(Boolean).join(' ') || invitation.email;
        await supabase.from('staff_notifications').insert({
          venue_id: invitation.venue_id,
          target_role: 'owner',
          notification_type: 'connection_accepted',
          title: 'Nouveau DJ connecté',
          message: `${djName} a accepté l'invitation et rejoint le club`,
          priority: 'normal',
          reference_type: 'user',
          reference_id: user.id,
          metadata: { role: 'dj', email: invitation.email, dj_name: djName },
        });
      } catch (notifErr) {
        console.error('Owner notif error (dj connection_accepted):', notifErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: isVenueScope
        ? 'Invitation acceptée ! Vous êtes maintenant DJ pour ce club.'
        : 'Invitation acceptée ! Vous êtes maintenant DJ pour cette organisation.',
      venue_name: venueName,
      venue_id: invitation.venue_id,
      organizer_user_id: invitation.organizer_user_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Erreur inconnue' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
