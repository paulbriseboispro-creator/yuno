-- ═══════════════════════════════════════════════════════════════════════════
-- Leads pro — formulaire « Ouvrir un club » de l'Explore faible densité.
--
-- Un gérant de club (ou une orga) qui tombe sur une ville vide laisse ses
-- coordonnées SANS créer de compte : /pro redirige vers /auth, ce qui tuait
-- le lead. INSERT public borné par des CHECKs ; lecture réservée au super
-- admin ; chaque dépôt émet une alerte plateforme (cloche /admin/alerts) via
-- emit_admin_notification, corps enveloppé d'un EXCEPTION WHEN OTHERS pour ne
-- jamais faire échouer le dépôt du lead.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.pro_contact_leads (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email      text        NOT NULL CHECK (email ~ '^\S+@\S+\.\S+$' AND char_length(email) <= 255),
  phone      text        CHECK (phone IS NULL OR char_length(phone) <= 40),
  club_name  text        CHECK (club_name IS NULL OR char_length(club_name) <= 160),
  city       text        CHECK (city IS NULL OR char_length(city) <= 120),
  message    text        CHECK (message IS NULL OR char_length(message) <= 2000),
  source     text        NOT NULL DEFAULT 'explore',
  status     text        NOT NULL DEFAULT 'new'
);

ALTER TABLE public.pro_contact_leads ENABLE ROW LEVEL SECURITY;

-- Dépôt ouvert (le formulaire vit sur une page publique, souvent déconnectée).
CREATE POLICY "pro_contact_leads_insert_public"
  ON public.pro_contact_leads FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Lecture : super admin uniquement (les coordonnées sont des données perso).
CREATE POLICY "pro_contact_leads_admin_select"
  ON public.pro_contact_leads FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "pro_contact_leads_admin_update"
  ON public.pro_contact_leads FOR UPDATE
  USING (public.is_super_admin());

-- ── Alerte plateforme à chaque lead ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_pro_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_pro_lead',
    'Un pro veut ouvrir son club',
    NEW.name
      || COALESCE(' (' || NEW.club_name || ')', '')
      || COALESCE(' à ' || NEW.city, '')
      || ' — ' || NEW.email
      || COALESCE(' · ' || NEW.phone, '')
      || COALESCE(E'\n« ' || NEW.message || ' »', ''),
    'high', 'pro_lead', NEW.id::text,
    jsonb_build_object(
      'lead_id', NEW.id, 'name', NEW.name, 'email', NEW.email,
      'phone', NEW.phone, 'club_name', NEW.club_name, 'city', NEW.city
    ),
    NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_pro_lead ON public.pro_contact_leads;
CREATE TRIGGER trg_notify_admin_pro_lead
  AFTER INSERT ON public.pro_contact_leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_pro_lead();
