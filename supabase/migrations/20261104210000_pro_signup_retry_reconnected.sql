-- ═══════════════════════════════════════════════════════════════════════════
-- Inscription pro « retry » : l'alerte dit ce que le formulaire a proposé, et
-- se tait quand le pro est rentré (Poupée, 19/10/2026).
--
-- Depuis le 20/10, la landing reconnaît une adresse qui a déjà un compte
-- PENDANT la saisie (RPC email_has_account) et remplace le mot de passe par
-- deux choix : « Me connecter » et « Recevoir un lien de connexion » (lien
-- sans mot de passe, qui couvre aussi le mot de passe oublié). D'où :
--   • un pro qui s'est connecté APRÈS son parcours (last_sign_in_at >
--     updated_at) est rentré : pas d'alerte (Pascal s'est reconnecté à 10 h 15
--     après son parcours de 10 h 13, il n'était pas bloqué) ;
--   • sinon le corps dit ce qui lui a été proposé et depuis quand il ne s'est
--     plus connecté : à appeler pour l'aider à entrer ;
--   • un parcours Yuno CRM arrêté à l'étape e-mail n'a pas encore de type
--     (club / organisateur) : il alerte quand même, en « retry » seulement
--     (une adresse inconnue sans type n'est pas une inscription commencée).
-- Réécrite depuis la définition de la prod (20261104200000), rien d'autre ne
-- change : une alerte par parcours, pas deux en 20 h pour la même adresse.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pro_signup_stalled_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_user record;
  v_kind text;
  v_step text;
  v_who  text;
  v_last text;
  v_n    integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (lower(ps.email)) ps.*
      FROM public.pro_signups ps
     WHERE ps.email IS NOT NULL
       AND (ps.kind IN ('club', 'organizer') OR ps.kind IS NULL)
       AND ps.user_id IS NULL
       AND ps.account_created_at IS NULL
       AND ps.updated_at < now() - interval '20 minutes'
       AND ps.updated_at > now() - interval '48 hours'
       AND NOT public._pro_signup_invited(ps.id)
     ORDER BY lower(ps.email), ps.updated_at DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.admin_notifications n
       WHERE n.notification_type = 'admin_pro_signup_stalled'
         AND lower(n.metadata->>'email') = lower(r.email)
         AND (n.created_at > now() - interval '20 hours' OR n.reference_id = r.id::text)
    ) THEN
      CONTINUE;
    END IF;

    SELECT u.id, u.created_at, u.last_sign_in_at INTO v_user
      FROM auth.users u
     WHERE lower(u.email) = lower(r.email)
     LIMIT 1;
    IF v_user.id IS NOT NULL AND v_user.created_at >= r.created_at THEN
      CONTINUE;
    END IF;
    -- Rentré après son parcours (connexion ou lien reçu) : il n'est pas bloqué.
    IF v_user.id IS NOT NULL AND v_user.last_sign_in_at > r.updated_at THEN
      CONTINUE;
    END IF;
    -- Sans type, ce n'est une alerte que si l'adresse a déjà un compte.
    IF r.kind IS NULL AND v_user.id IS NULL THEN
      CONTINUE;
    END IF;
    v_kind := CASE WHEN v_user.id IS NOT NULL THEN 'retry' ELSE 'stalled' END;
    v_step := public._pro_signup_furthest_step(r.steps);
    v_who := coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), r.email);
    v_last := CASE WHEN v_user.last_sign_in_at IS NULL THEN 'jamais connecté'
                   ELSE 'dernière connexion le '
                        || to_char(v_user.last_sign_in_at AT TIME ZONE 'Europe/Paris', 'DD/MM à HH24"h"MI') END;

    IF public.emit_admin_notification(
      'admin_pro_signup_stalled',
      CASE WHEN v_kind = 'retry'
           THEN 'Un pro inscrit retente de s''inscrire'
           ELSE 'Inscription pro bloquée' END,
      coalesce(r.org_name, '?') || coalesce(' (' || r.city || ')', '') || ' · ' || v_who
        || coalesce(' · ' || r.phone, '')
        || CASE WHEN v_kind = 'retry'
                THEN ' · a déjà un compte : le formulaire lui a proposé « Me connecter » et un lien de connexion par e-mail, '
                     || 'il ne s''est pas reconnecté depuis (' || v_last || '). À appeler pour l''aider à entrer.'
                ELSE ' · arrêté à l''étape « ' || coalesce(v_step, 'opened') || ' ».' END,
      'high', 'pro_signup', r.id::text,
      jsonb_build_object('kind', v_kind, 'step', v_step, 'email', lower(r.email),
                         'phone', r.phone, 'org_name', r.org_name, 'city', r.city,
                         'signup_kind', r.kind, 'product', r.product, 'user_id', v_user.id,
                         'last_sign_in_at', v_user.last_sign_in_at),
      'pro_signup_stalled:' || r.id::text
    ) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pro_signup_stalled_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_signup_stalled_sweep() TO service_role;
