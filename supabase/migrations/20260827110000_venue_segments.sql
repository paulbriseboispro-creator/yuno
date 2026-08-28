-- ───────────────────────────────────────────────────────────────────────────
-- Segments clients sauvegardés (CRM club) — la table.
--
-- Un segment = un nom + une définition jsonb versionnée :
--   {"version": 1, "match": "all", "conditions": [ {type, ...}, ... ]}
-- v1 : liste plate de conditions en AND ("match" est réservé pour un futur
-- "any"/groupes OR sans casser le schéma). La définition est RÉSOLUE À
-- L'ENVOI par resolve_venue_segment (membership dynamique, jamais de
-- snapshot) — un client qui sort des critères sort du segment tout seul.
-- Une condition de type inconnu s'évalue à FAUX : l'audience rétrécit,
-- elle ne s'élargit jamais (mode de défaillance sûr pour du ciblage).
--
-- v1 venue-only ; le jumeau organisateur est un fast-follow documenté.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE public.venue_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  definition jsonb NOT NULL DEFAULT '{"version":1,"match":"all","conditions":[]}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un nom par club (insensible à la casse) — évite les doublons "VIP" / "vip".
CREATE UNIQUE INDEX uq_venue_segments_name ON public.venue_segments (venue_id, lower(name));
CREATE INDEX idx_venue_segments_venue ON public.venue_segments (venue_id, created_at DESC);

ALTER TABLE public.venue_segments ENABLE ROW LEVEL SECURITY;

-- Même périmètre que l'envoi de push club : owner, manager CRM, super admin.
CREATE POLICY "Venue CRM managers manage segments"
  ON public.venue_segments FOR ALL
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.user_id = auth.uid() AND mp.venue_id = venue_segments.venue_id AND mp.can_manage_crm = true
    )
  )
  WITH CHECK (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.manager_permissions mp
      WHERE mp.user_id = auth.uid() AND mp.venue_id = venue_segments.venue_id AND mp.can_manage_crm = true
    )
  );

CREATE TRIGGER update_venue_segments_updated_at
  BEFORE UPDATE ON public.venue_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
