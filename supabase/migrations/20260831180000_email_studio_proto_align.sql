-- ───────────────────────────────────────────────────────────────────────────
-- Email Studio — alignement sur le prototype claude.design.
--
-- 1. get_recipient_block_conds : résolution PAR LOT des règles de visibilité
--    des blocs (« Afficher ce bloc pour… ») au moment de l'envoi. Un bloc
--    conditionnel s'efface pour les destinataires hors règle. Une requête par
--    tranche de 100, jamais par destinataire. Règles :
--      • vip_table       : a déjà réservé une table chez CE club/organisateur
--      • buyers          : a déjà acheté un billet chez CE club/organisateur
--      • new_subscribers : abonné newsletter depuis moins de 30 jours
--    Fail-closed volontaire côté worker : si la RPC échoue, les blocs
--    conditionnels sont masqués (on n'affiche jamais par erreur une offre
--    ciblée à toute la liste).
-- 2. Fenêtre A/B par défaut : 4 h (copie prototype « le gagnant part au reste
--    après 4 h »). Les brouillons existants (feature déployée aujourd'hui,
--    aucun envoi A/B parti) sont réalignés.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_recipient_block_conds(
  p_campaign_id uuid,
  p_emails text[]
)
RETURNS TABLE(email text, cond text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'get_recipient_block_conds: service_role only';
  END IF;

  SELECT venue_id, organizer_user_id INTO c
    FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- vip_table : a déjà réservé une table chez ce sender
  SELECT lower(e2.addr)::text, 'vip_table'::text
    FROM unnest(p_emails) AS e2(addr)
   WHERE EXISTS (
     SELECT 1 FROM public.table_reservations tr
       JOIN public.events ev ON ev.id = tr.event_id
      WHERE lower(tr.user_email) = lower(e2.addr)
        AND tr.status IN ('paid', 'confirmed')
        AND ((c.venue_id IS NOT NULL AND (ev.venue_id = c.venue_id OR ev.partner_venue_id = c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND (ev.organizer_user_id = c.organizer_user_id OR ev.partner_organizer_id = c.organizer_user_id))))

  UNION ALL

  -- buyers : a déjà acheté un billet chez ce sender
  SELECT lower(e2.addr)::text, 'buyers'::text
    FROM unnest(p_emails) AS e2(addr)
   WHERE EXISTS (
     SELECT 1 FROM public.tickets t
       JOIN public.events ev ON ev.id = t.event_id
      WHERE lower(t.user_email) = lower(e2.addr)
        AND t.status = 'paid'
        AND ((c.venue_id IS NOT NULL AND (ev.venue_id = c.venue_id OR ev.partner_venue_id = c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND (ev.organizer_user_id = c.organizer_user_id OR ev.partner_organizer_id = c.organizer_user_id))))

  UNION ALL

  -- new_subscribers : abonné newsletter depuis moins de 30 jours
  SELECT lower(e2.addr)::text, 'new_subscribers'::text
    FROM unnest(p_emails) AS e2(addr)
   WHERE EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = lower(e2.addr)
        AND ns.created_at > now() - interval '30 days'
        AND ((c.venue_id IS NOT NULL AND ns.venue_id = c.venue_id)
          OR (c.organizer_user_id IS NOT NULL AND ns.organizer_user_id = c.organizer_user_id)));
END;
$$;

REVOKE ALL ON FUNCTION public.get_recipient_block_conds(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recipient_block_conds(uuid, text[]) TO service_role;

-- ── Fenêtre A/B : 4 h par défaut ─────────────────────────────────────────────
ALTER TABLE public.email_campaigns
  ALTER COLUMN ab_window_minutes SET DEFAULT 240;

-- Réaligne les lignes encore sur l'ancien défaut (aucune campagne A/B partie :
-- la colonne existe depuis ce matin).
UPDATE public.email_campaigns
   SET ab_window_minutes = 240
 WHERE ab_window_minutes = 60
   AND status IN ('draft', 'scheduled');
