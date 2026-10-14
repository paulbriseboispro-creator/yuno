-- Formulaire de contact de la landing (landing.yunoapp.eu / crm.yunoapp.eu).
--
-- La landing avait son propre projet Supabase pour UNE seule table, demo_leads.
-- Elle écrit désormais dans ce projet-ci (un seul projet Supabase à payer) :
-- la table reprend les colonnes de demo_leads, et l'écriture passe par une RPC
-- publique SECURITY DEFINER (même modèle que submit_links_pro_lead) — la landing
-- n'a donc besoin d'AUCUN secret, seulement de la clé publique.

CREATE TABLE IF NOT EXISTS public.landing_contact_leads (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  segment      text        NOT NULL CHECK (segment IN ('club', 'organizer', 'affiliate', 'other')),
  name         text        NOT NULL,
  email        text        NOT NULL,
  company      text,
  role         text,
  phone        text,
  message      text,
  source       text,
  visitor_hash text
);

CREATE INDEX IF NOT EXISTS idx_landing_contact_leads_created
  ON public.landing_contact_leads (created_at DESC);

ALTER TABLE public.landing_contact_leads ENABLE ROW LEVEL SECURITY;

-- Lecture / gestion : super admin seul. Aucune policy INSERT : tout passe par la RPC.
DROP POLICY IF EXISTS "landing_leads_admin_select" ON public.landing_contact_leads;
CREATE POLICY "landing_leads_admin_select"
  ON public.landing_contact_leads FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "landing_leads_admin_update" ON public.landing_contact_leads;
CREATE POLICY "landing_leads_admin_update"
  ON public.landing_contact_leads FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "landing_leads_admin_delete" ON public.landing_contact_leads;
CREATE POLICY "landing_leads_admin_delete"
  ON public.landing_contact_leads FOR DELETE TO authenticated
  USING (public.is_super_admin());

REVOKE ALL ON public.landing_contact_leads FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.landing_contact_leads TO authenticated;
GRANT ALL ON public.landing_contact_leads TO service_role;

CREATE OR REPLACE FUNCTION public.submit_landing_contact_lead(
  p_segment text,
  p_name    text,
  p_email   text,
  p_company text DEFAULT NULL,
  p_role    text DEFAULT NULL,
  p_phone   text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_source  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx    record;
  v_recent integer;
  v_id     uuid;
  v_seg    text := lower(trim(coalesce(p_segment, 'other')));
  v_name   text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email  text := lower(trim(coalesce(p_email, '')));
BEGIN
  IF v_seg NOT IN ('club', 'organizer', 'affiliate', 'other') THEN v_seg := 'other'; END IF;
  IF v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF v_email = '' OR length(v_email) > 255
     OR v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_company, '')) > 160 OR length(coalesce(p_role, '')) > 120
     OR length(coalesce(p_phone, '')) > 40 OR length(coalesce(p_message, '')) > 2000
     OR length(coalesce(p_source, '')) > 120 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();

  -- Anti-flood : 5 demandes / heure / visiteur.
  SELECT count(*) INTO v_recent
  FROM landing_contact_leads
  WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO landing_contact_leads (segment, name, email, company, role, phone, message, source, visitor_hash)
  VALUES (
    v_seg, v_name, v_email,
    nullif(trim(coalesce(p_company, '')), ''),
    nullif(trim(coalesce(p_role, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_message, '')), ''),
    nullif(trim(coalesce(p_source, '')), ''),
    v_ctx.o_hash
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_landing_contact_lead(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_landing_contact_lead(text, text, text, text, text, text, text, text) TO anon, authenticated;
