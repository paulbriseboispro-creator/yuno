-- Yunits : les campagnes ENFANTS d'un compte Yuno CRM paient aussi.
--
-- Une campagne manuelle débite ses Yunits dans `enqueue_campaign_recipients`
-- (migration 20261004220000). Mais un renvoi aux non-ouvreurs, une relance
-- après clic ou une automatisation remplit sa file DIRECTEMENT, contact par
-- contact, sans passer par cette fonction : ces e-mails partaient gratuits.
--
-- Ce déclencheur, posé sur la file, débite à l'insertion les destinataires
-- en attente d'une campagne enfant (`child_kind` renseigné) d'une portée au
-- produit `crm`. Les campagnes manuelles (`child_kind` vide) sont ignorées :
-- elles sont déjà débitées par la mise en file. Solde insuffisant : rien
-- n'est débité et les destinataires passent en `skipped` (`yunits`) — le
-- collecteur ne tombe jamais, il ne part simplement rien. Les refus du
-- fournisseur sont remboursés par `mark_campaign_recipients_failed`, comme
-- pour une campagne manuelle.

CREATE OR REPLACE FUNCTION public._crm_yunits_debit_child_recipients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_debit jsonb;
BEGIN
  FOR r IN
    SELECT n.campaign_id, count(*)::integer AS k,
           public.crm_scope_key(c.venue_id, c.organizer_user_id) AS scope, c.name
      FROM new_rows n
      JOIN public.email_campaigns c ON c.id = n.campaign_id
     WHERE n.status = 'pending' AND c.child_kind IS NOT NULL
     GROUP BY n.campaign_id, c.venue_id, c.organizer_user_id, c.name
  LOOP
    IF r.scope IS NULL OR NOT public.crm_scope_is_crm(r.scope) THEN
      CONTINUE;
    END IF;
    v_debit := public.crm_yunits_debit(r.scope, r.k, 'email', 'email_campaign', r.campaign_id::text, r.name, '{}'::jsonb);
    IF NOT COALESCE((v_debit->>'ok')::boolean, false) THEN
      UPDATE public.email_campaign_recipients q
         SET status = 'skipped', error_message = 'yunits'
       WHERE q.campaign_id = r.campaign_id AND q.status = 'pending'
         AND q.id IN (SELECT n.id FROM new_rows n WHERE n.campaign_id = r.campaign_id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_yunits_debit_child_recipients() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_yunits_child_recipients ON public.email_campaign_recipients;
CREATE TRIGGER trg_crm_yunits_child_recipients
  AFTER INSERT ON public.email_campaign_recipients
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._crm_yunits_debit_child_recipients();
