-- ============================================================================
-- « Cet email a-t-il déjà un compte Yuno ? » — la question posée AVANT le mot
-- de passe, pas après.
--
-- Vécu : un invité s'inscrit sur une guest list avec un email qui a déjà un
-- compte, remplit nom / email / téléphone, puis le mot de passe, et c'est
-- seulement au moment de valider que `auth.signUp` renvoie « User already
-- registered ». Tout le formulaire pour rien. Le front n'avait aucun moyen de
-- savoir plus tôt : `profiles` n'a aucune policy anon (et ne doit pas en
-- avoir), et `auth.users` est hors de portée du client.
--
-- Cette fonction ne renvoie QU'UN BOOLÉEN, jamais une ligne, jamais un nom.
-- Elle ne crée aucune fuite nouvelle : `auth.signUp` révèle déjà l'existence
-- d'un compte à quiconque tente l'email (c'est exactement le message qu'on
-- reçoit trop tard aujourd'hui). Elle rend juste la réponse consultable au
-- bon moment, sans créer d'utilisateur ni envoyer d'email.
--
-- Elle ne décide RIEN côté vente : aucun achat, aucune inscription guest list
-- n'est bloqué par sa réponse — le tunnel d'achat reste sans mur. Elle ne
-- gouverne que la proposition de création de compte.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.email_has_account(_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND lower(u.email) = lower(btrim(coalesce(_email, '')))
      AND u.deleted_at IS NULL
  )
  -- Garde-fou : une saisie en cours ('marg', 'marg@') ne doit jamais partir en
  -- requête utile. `false` = « on ne sait pas » et le front n'affiche rien.
  AND btrim(coalesce(_email, '')) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

COMMENT ON FUNCTION public.email_has_account(text) IS
  'Booléen seul : un compte Yuno existe-t-il sur cet email ? Sert à proposer la connexion au lieu du formulaire de création. Ne bloque aucun achat.';

GRANT EXECUTE ON FUNCTION public.email_has_account(text) TO anon, authenticated;
