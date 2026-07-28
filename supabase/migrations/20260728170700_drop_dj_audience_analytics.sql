-- ─────────────────────────────────────────────────────────────────────────────
-- Phase B / item B4 — retirer le doublon dj_audience_analytics.
--
-- DJAnalytics passe désormais par le RPC polymorphe get_audience_analytics
-- (subject_type='dj'), qui renvoie la même forme. dj_audience_analytics est mort.
--
-- ⚠️ COORDINATION : ne DROP qu'APRÈS que le front DJAnalytics migré soit déployé.
-- L'ancien front live appelle encore dj_audience_analytics ; le dropper avant casse
-- sa zone Audience (RPC introuvable → « pas encore d'abonnés »). Comme tout le SQL
-- Phase B, cette migration ship avec le front.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.dj_audience_analytics(uuid);
