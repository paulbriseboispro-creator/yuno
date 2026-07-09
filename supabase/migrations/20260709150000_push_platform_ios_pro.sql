-- App « Yuno Pro » (eu.yunoapp.pro) : ses tokens APNs sont distincts de ceux
-- de l'app B2C — nouveau discriminant platform='ios_pro'. Le relay
-- send-push-notification choisit le topic APNs par abonnement
-- (APNS_TOPIC_PRO vs APNS_TOPIC). Un même utilisateur (ex. un videur) peut
-- avoir les DEUX apps : les purges de tokens sont scopées par plateforme.

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_check;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_platform_check
  CHECK (platform IN ('web', 'ios', 'ios_pro'));

-- push_subscriptions_web_keys_check ("platform <> 'web' OR clés non nulles")
-- couvre déjà ios_pro sans modification.
