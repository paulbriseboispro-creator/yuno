import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyTOTP } from '../_shared/totp.ts';
import { encode } from "https://deno.land/std@0.190.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hexBytes = encode(new Uint8Array(hashBuffer));
  return new TextDecoder().decode(hexBytes);
}

// Rate limiting simple en mémoire (en production, utiliser Redis)
const rateLimitMap = new Map<string, { attempts: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(userId);
  
  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(userId, { attempts: 1, resetAt: now + 60000 }); // 1 minute
    return true;
  }
  
  if (limit.attempts >= 5) {
    return false;
  }
  
  limit.attempts++;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code, recoveryCode } = await req.json();
    
    if (!code && !recoveryCode) {
      throw new Error('Code TOTP ou code de récupération requis');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Non authentifié');
    }

    // Client for auth
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

    // Admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Rate limiting
    if (!checkRateLimit(user.id)) {
      throw new Error('Trop de tentatives. Réessayez dans 1 minute.');
    }

    let verified = false;

    if (recoveryCode) {
      // Vérifier le code de récupération
      const codeHash = await hashCode(recoveryCode.toUpperCase());
      
      const { data: recovery, error: recoveryError } = await supabaseAdmin
        .from('mfa_recovery_codes')
        .select('id, used')
        .eq('user_id', user.id)
        .eq('code_hash', codeHash)
        .maybeSingle();

      if (recoveryError || !recovery) {
        throw new Error('Code de récupération invalide');
      }

      if (recovery.used) {
        throw new Error('Ce code de récupération a déjà été utilisé');
      }

      // Marquer le code comme utilisé
      await supabaseAdmin
        .from('mfa_recovery_codes')
        .update({ used: true, used_at: new Date().toISOString() })
        .eq('id', recovery.id);

      verified = true;

      await supabaseAdmin.from('security_logs').insert({
        user_id: user.id,
        action: 'mfa_recovery_code_used',
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
        user_agent: req.headers.get('user-agent'),
        success: true,
      });
    } else {
      // Vérifier le code TOTP
      if (!/^\d{6}$/.test(code)) {
        throw new Error('Code invalide (6 chiffres requis)');
      }

      const { data: secret, error: secretError } = await supabaseAdmin
        .rpc('get_mfa_totp_secret', { p_user_id: user.id });

      if (secretError || !secret) {
        console.error('MFA secret not found for user:', user.id, 'Error:', secretError);
        throw new Error('MFA non configurée');
      }

      // Vérifier le code TOTP avec une fenêtre plus large (±3 périodes = 180 secondes)
      verified = await verifyTOTP(code, secret, 3);

      if (!verified) {
        await supabaseAdmin.from('security_logs').insert({
          user_id: user.id,
          action: 'mfa_login_failed',
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
          user_agent: req.headers.get('user-agent'),
          success: false,
        });

        throw new Error('Code incorrect');
      }

      await supabaseAdmin.from('security_logs').insert({
        user_id: user.id,
        action: 'mfa_login_success',
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
        user_agent: req.headers.get('user-agent'),
        success: true,
      });
    }

    // Mettre à jour mfa_verified_at
    await supabaseAdmin
      .from('profiles')
      .update({ mfa_verified_at: new Date().toISOString() })
      .eq('id', user.id);

    // Reset rate limit on success
    rateLimitMap.delete(user.id);

    return new Response(
      JSON.stringify({ 
        success: true,
        verified: true,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8h
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Erreur mfa-verify-login:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erreur inconnue' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
