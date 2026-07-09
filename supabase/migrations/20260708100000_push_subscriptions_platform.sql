-- Native push (Capacitor iOS) : la table push_subscriptions accueille désormais
-- deux types de lignes, discriminées par `platform` :
--   - 'web' : abonnement Web Push classique (endpoint https://, clés p256dh/auth)
--   - 'ios' : token APNs (endpoint 'apns:<deviceToken>', pas de clés de chiffrement)
-- Android/FCM (v2) ajoutera 'android' au CHECK le moment venu.

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web', 'ios'));

-- Les lignes APNs n'ont pas de clés web-push.
ALTER TABLE public.push_subscriptions
  ALTER COLUMN p256dh DROP NOT NULL,
  ALTER COLUMN auth DROP NOT NULL;

-- Une ligne web reste valide seulement avec ses deux clés.
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_web_keys_check
  CHECK (platform <> 'web' OR (p256dh IS NOT NULL AND auth IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_platform
  ON public.push_subscriptions (user_id, platform);

-- L'upsert onConflict(user_id,endpoint) du client fait un INSERT ... ON CONFLICT
-- DO UPDATE : il faut une policy UPDATE self-service (absente jusqu'ici).
CREATE POLICY "Users can update own push subscriptions"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
