import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyTOTP } from '../_shared/totp.ts';
import { encode } from "https://deno.land/std@0.190.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateRecoveryCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hexBytes = encode(bytes);
  return new TextDecoder().decode(hexBytes).toUpperCase();
}

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hexBytes = encode(new Uint8Array(hashBuffer));
  return new TextDecoder().decode(hexBytes);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    
    if (!code || !/^\d{6}$/.test(code)) {
      throw new Error('Code invalide (6 chiffres requis)');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Non authentifié');
    }

    // Client pour l'authentification
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

    // Client admin pour les opérations DB
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Récupérer le secret temporaire (avec admin)
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from('mfa_pending')
      .select('secret, created_at')
      .eq('user_id', user.id)
      .single();

    console.log('🔍 Secret récupéré depuis mfa_pending:', pending ? 'OUI' : 'NON');
    if (pending) {
      console.log('🔍 Longueur du secret:', pending.secret.length);
      console.log('🔍 Premiers caractères du secret:', pending.secret.substring(0, 8));
    }

    if (pendingError || !pending) {
      console.error('❌ Erreur récupération secret:', pendingError);
      throw new Error('Aucun secret en attente. Veuillez recommencer le setup.');
    }

    // Vérifier que le secret n'a pas expiré (15 min)
    const createdAt = new Date(pending.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / 1000 / 60;
    
    console.log('🕐 Secret créé il y a', diffMinutes.toFixed(2), 'minutes');
    
    if (diffMinutes > 15) {
      await supabaseAdmin.from('mfa_pending').delete().eq('user_id', user.id);
      throw new Error('Le secret a expiré. Veuillez recommencer le setup.');
    }

    // Vérifier le code TOTP
    console.log('🔑 Vérification du code:', code);
    const isValid = await verifyTOTP(code, pending.secret);
    console.log('✓ Code valide:', isValid);

    if (!isValid) {
      // Log échec (avec admin)
      await supabaseAdmin.from('security_logs').insert({
        user_id: user.id,
        action: 'mfa_setup_failed',
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
        user_agent: req.headers.get('user-agent'),
        success: false,
      });

      throw new Error('Code incorrect. Veuillez réessayer.');
    }

    // Générer 10 codes de récupération
    const recoveryCodes: string[] = [];
    const recoveryHashes: Array<{ user_id: string; code_hash: string }> = [];

    for (let i = 0; i < 10; i++) {
      const code = generateRecoveryCode();
      recoveryCodes.push(code);
      
      const hash = await hashCode(code);
      recoveryHashes.push({
        user_id: user.id,
        code_hash: hash,
      });
    }

    // Stocker le secret dans Supabase Vault (AES-256 via pgsodium)
    const { error: secretError } = await supabaseAdmin
      .rpc('store_mfa_totp_secret', { p_user_id: user.id, p_secret: pending.secret });

    if (secretError) throw secretError;

    // Supprimer les anciens recovery codes et insérer les nouveaux
    await supabaseAdmin.from('mfa_recovery_codes').delete().eq('user_id', user.id);
    
    const { error: recoveryError } = await supabaseAdmin
      .from('mfa_recovery_codes')
      .insert(recoveryHashes);

    if (recoveryError) throw recoveryError;

    // Activer MFA dans profiles
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        mfa_enabled: true,
        mfa_verified_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (profileError) throw profileError;

    // Supprimer le secret temporaire
    await supabaseAdmin.from('mfa_pending').delete().eq('user_id', user.id);

    // Log succès (avec admin)
    await supabaseAdmin.from('security_logs').insert({
      user_id: user.id,
      action: 'mfa_setup_completed',
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      user_agent: req.headers.get('user-agent'),
      success: true,
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        recoveryCodes,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Erreur mfa-verify-setup:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erreur inconnue' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
