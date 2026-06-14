import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { generateSecret, generateOTPAuthURL } from '../_shared/totp.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Non authentifié');
    }

    // Client pour l'authentification (avec JWT utilisateur)
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      throw new Error('Non authentifié');
    }

    // Vérifier le rôle owner ou affiliate (les deux ont la 2FA obligatoire)
    const { data: roles } = await supabaseAuth
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles || !roles.some(r => r.role === 'owner' || r.role === 'affiliate')) {
      throw new Error('Accès refusé : seuls les owners et affiliés peuvent activer la 2FA');
    }

    // Client admin pour les opérations DB (bypass RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Générer un secret TOTP
    const secret = generateSecret();
    
    // Créer l'URI otpauth pour le QR code
    const otpauthUrl = generateOTPAuthURL(
      'Yuno App',
      user.email || user.id,
      secret
    );

    console.log('🔹 Nettoyage anciens secrets pour:', user.id);
    
    // Nettoyer les anciens secrets pending (avec admin)
    await supabaseAdmin.rpc('cleanup_expired_mfa_pending');
    const { error: deleteError } = await supabaseAdmin
      .from('mfa_pending')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('⚠️ Erreur nettoyage:', deleteError);
    }

    console.log('🔹 Insertion nouveau secret (longueur:', secret.length, ')');
    console.log('🔹 Premiers caractères:', secret.substring(0, 8));

    // Stocker temporairement le secret (avec admin)
    const { error: insertError } = await supabaseAdmin
      .from('mfa_pending')
      .insert({
        user_id: user.id,
        secret: secret,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('❌ Erreur insertion:', insertError);
      throw new Error('Impossible de sauvegarder le secret: ' + insertError.message);
    }

    console.log('✅ Secret sauvegardé');

    // Log de sécurité (avec admin)
    await supabaseAdmin.from('security_logs').insert({
      user_id: user.id,
      action: 'mfa_secret_generated',
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      user_agent: req.headers.get('user-agent'),
      success: true,
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        otpauthUrl,
        secret, // Retourner le secret pour configuration manuelle
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Erreur mfa-generate-secret:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erreur inconnue' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
