-- Billets externes : ce que le CRM lisait dans `raw` devient des colonnes.
--
-- Pourquoi : chaque écran de la Console CRM appelle `_crm_ticket_is_sale` /
-- `_crm_ticket_gl_kind` sur chaque billet de la portée, donc relit le billet
-- Shotgun brut (`raw`, ~3 Ko par billet, coordonnées comprises) pour en tirer
-- `deal_channel`. Une colonne typée se lit sans décoder le JSON, et prépare la
-- minimisation de `raw` (plan CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md, §5.3, S5) :
-- une fois tout lu en colonnes, `raw` peut perdre ce qui est extrait.
--
-- Colonnes (noms de l'API Shotgun, docs/designs/SHOTGUN_API_REFERENCE.md) :
--   deal_channel        `deal_channel` tel quel (online, invitation, duplicata…)
--   deal_visibilities   `deal_visibilities` (public, private, promoters…)
--   seating_type        `ticket_seating.type` (Table, Booth, Seat…)
--   payment_method      `payment_method` (card, cash…)
--   org_fee             `deal_service_fee` / 100 : frais organisateur, en euros
--   provider_contact_id `contact_id` (contact détenteur chez la billetterie)
--   provider_user_id    `user_id` (compte du détenteur chez la billetterie)
--
-- Remplies par le connecteur (`mapShotgunTicket`) ET par le trigger ci-dessous,
-- qui les dérive de `raw` quand la clé y est : un billet écrit par une ancienne
-- version du connecteur est donc juste lui aussi, et une clé retirée plus tard
-- de `raw` (minimisation) garde la valeur que le connecteur a écrite.
-- `deal_channel` est copié SANS normalisation : `_crm_ticket_is_sale(status,
-- deal_channel)` rend exactement `_crm_ticket_is_sale(status, raw)`.
--
-- Rattrapage des billets déjà en base : par lots (UPDATE … WHERE id IN lot),
-- joué à part sur la prod le 17/10 ; le dernier UPDATE ci-dessous ne retouche
-- que les lignes encore différentes (aucune sur la prod, toutes sur une base neuve).

ALTER TABLE public.external_tickets
  ADD COLUMN IF NOT EXISTS deal_channel text,
  ADD COLUMN IF NOT EXISTS deal_visibilities text[],
  ADD COLUMN IF NOT EXISTS seating_type text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS org_fee numeric,
  ADD COLUMN IF NOT EXISTS provider_contact_id text,
  ADD COLUMN IF NOT EXISTS provider_user_id text;

COMMENT ON COLUMN public.external_tickets.deal_channel IS
  'Canal du tarif chez la billetterie (Shotgun deal_channel), copié tel quel. invitation / duplicata ne sont pas des ventes (_crm_ticket_is_sale).';
COMMENT ON COLUMN public.external_tickets.org_fee IS
  'Frais organisateur de la billetterie (Shotgun deal_service_fee), en euros.';

CREATE OR REPLACE FUNCTION public.external_tickets_typed_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(NEW.raw) = 'object' THEN
    IF NEW.raw ? 'deal_channel' THEN
      NEW.deal_channel := NEW.raw->>'deal_channel';
    END IF;
    IF NEW.raw ? 'deal_visibilities' THEN
      NEW.deal_visibilities := CASE WHEN jsonb_typeof(NEW.raw->'deal_visibilities') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(NEW.raw->'deal_visibilities')) END;
    END IF;
    IF NEW.raw ? 'ticket_seating' THEN
      NEW.seating_type := CASE WHEN jsonb_typeof(NEW.raw->'ticket_seating') = 'object'
        THEN NEW.raw->'ticket_seating'->>'type' END;
    END IF;
    IF NEW.raw ? 'payment_method' THEN
      NEW.payment_method := NEW.raw->>'payment_method';
    END IF;
    IF NEW.raw ? 'deal_service_fee' THEN
      NEW.org_fee := CASE WHEN jsonb_typeof(NEW.raw->'deal_service_fee') = 'number'
        THEN (NEW.raw->>'deal_service_fee')::numeric / 100 END;
    END IF;
    IF NEW.raw ? 'contact_id' THEN
      NEW.provider_contact_id := NEW.raw->>'contact_id';
    END IF;
    IF NEW.raw ? 'user_id' THEN
      NEW.provider_user_id := NEW.raw->>'user_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.external_tickets_typed_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_external_tickets_typed_fields ON public.external_tickets;
CREATE TRIGGER trg_external_tickets_typed_fields
  BEFORE INSERT OR UPDATE OF raw ON public.external_tickets
  FOR EACH ROW EXECUTE FUNCTION public.external_tickets_typed_fields();

-- Mêmes règles que les versions qui lisaient `raw`, mot pour mot (le canal
-- est la valeur de `raw->>'deal_channel'`). Les versions `jsonb` restent pour
-- les lectures qui n'ont pas encore migré : elles rendent la même chose.
CREATE OR REPLACE FUNCTION public._crm_ticket_is_sale(p_status text, p_channel text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Ni une invitation, ni un duplicata (copie d'un billet déjà vendu).
  SELECT p_status = 'valid' AND COALESCE(p_channel, '') NOT IN ('invitation', 'duplicata');
$function$;

CREATE OR REPLACE FUNCTION public._crm_ticket_gl_kind(p_status text, p_price numeric, p_channel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_status IS DISTINCT FROM 'valid' THEN NULL
    -- Un duplicata est la copie d'un billet existant : ni vente, ni guest list.
    WHEN p_channel = 'duplicata' THEN NULL
    WHEN p_channel = 'invitation' THEN 'inv'
    WHEN p_price = 0 THEN 'free'
  END;
$function$;

-- Mêmes droits que les versions jsonb.
GRANT EXECUTE ON FUNCTION public._crm_ticket_is_sale(text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._crm_ticket_gl_kind(text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_ticket_gl_kind(text, numeric, text) TO authenticated, service_role;

-- Rattrapage (aucune ligne sur la prod, rattrapée par lots avant cette migration).
UPDATE public.external_tickets t
   SET deal_channel = t.raw->>'deal_channel',
       deal_visibilities = CASE WHEN jsonb_typeof(t.raw->'deal_visibilities') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(t.raw->'deal_visibilities')) END,
       seating_type = CASE WHEN jsonb_typeof(t.raw->'ticket_seating') = 'object' THEN t.raw->'ticket_seating'->>'type' END,
       payment_method = t.raw->>'payment_method',
       org_fee = CASE WHEN jsonb_typeof(t.raw->'deal_service_fee') = 'number' THEN (t.raw->>'deal_service_fee')::numeric / 100 END,
       provider_contact_id = t.raw->>'contact_id',
       provider_user_id = t.raw->>'user_id'
 WHERE jsonb_typeof(t.raw) = 'object'
   AND (t.deal_channel IS DISTINCT FROM t.raw->>'deal_channel'
     OR t.payment_method IS DISTINCT FROM t.raw->>'payment_method'
     OR t.provider_contact_id IS DISTINCT FROM t.raw->>'contact_id'
     OR t.provider_user_id IS DISTINCT FROM t.raw->>'user_id'
     OR t.seating_type IS DISTINCT FROM (CASE WHEN jsonb_typeof(t.raw->'ticket_seating') = 'object' THEN t.raw->'ticket_seating'->>'type' END)
     OR t.org_fee IS DISTINCT FROM (CASE WHEN jsonb_typeof(t.raw->'deal_service_fee') = 'number' THEN (t.raw->>'deal_service_fee')::numeric / 100 END)
     OR t.deal_visibilities IS DISTINCT FROM (CASE WHEN jsonb_typeof(t.raw->'deal_visibilities') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(t.raw->'deal_visibilities')) END));
