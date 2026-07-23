-- =====================================================================
-- Guest list — deux compléments aux canaux de distribution :
--
--   1. `guest_list_invites.label` : un nom donné AU LIEN privé (ex. « Ana +1 »,
--      « Table anniversaire »), distinct du nom de l'invité destinataire. Sans
--      lui, une liste de liens uniques est illisible pour son détenteur.
--
--   2. `guest_list_share_links` : plusieurs liens PUBLICS pour une même part,
--      un par canal de diffusion (Instagram, WhatsApp, story…). Même offre que
--      le lien public principal (les types choisis par le détenteur) mais token
--      distinct, pour savoir quel canal amène les inscriptions — et donc les
--      revenus quand la part est celle d'un promoteur.
--      L'entrée porte `share_link_id` : l'attribution se fait à l'inscription.
-- =====================================================================

-- ── 1) Nom du lien d'invitation privé ────────────────────────────────────
ALTER TABLE public.guest_list_invites
  ADD COLUMN IF NOT EXISTS label text;

COMMENT ON COLUMN public.guest_list_invites.label IS
  'Nom du LIEN, affiché au détenteur pour s''y retrouver (distinct de guest_name, le nom du destinataire).';

-- ── 2) Liens publics segmentés par canal ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_list_share_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id uuid NOT NULL REFERENCES public.guest_lists(id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  token         text UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_list_share_links_list
  ON public.guest_list_share_links (guest_list_id);

ALTER TABLE public.guest_list_share_links ENABLE ROW LEVEL SECURITY;

-- Même porte que les invitations : le détenteur de la part, et la partie qui
-- la lui a accordée. La résolution publique n'a besoin d'AUCUN select : le
-- lien segmenté voyage à côté du token de la part (?token=…&s=…), et
-- l'attribution est faite côté service_role par l'edge function.
DROP POLICY IF EXISTS "Holders manage their part share links" ON public.guest_list_share_links;
CREATE POLICY "Holders manage their part share links"
ON public.guest_list_share_links FOR ALL TO authenticated
USING (public.can_manage_guest_list_part(auth.uid(), guest_list_id))
WITH CHECK (public.can_manage_guest_list_part(auth.uid(), guest_list_id));

-- Attribution de l'inscription au canal qui l'a amenée.
ALTER TABLE public.guest_list_entries
  ADD COLUMN IF NOT EXISTS share_link_id uuid REFERENCES public.guest_list_share_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_list_entries_share_link
  ON public.guest_list_entries (share_link_id) WHERE share_link_id IS NOT NULL;

-- ── 3) Compteur d'inscriptions par canal ─────────────────────────────────
-- SECURITY DEFINER : le détenteur lit SES compteurs quel que soit son rôle
-- (owner, orga, DJ, promoteur), sans dépendre des policies de lecture des
-- entrées, qui diffèrent d'un rôle à l'autre.
CREATE OR REPLACE FUNCTION public.get_guest_list_share_link_stats(_guest_list_id uuid)
RETURNS TABLE(share_link_id uuid, signups integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.share_link_id, count(*)::int AS signups
  FROM public.guest_list_entries e
  WHERE e.guest_list_id = _guest_list_id
    AND e.status <> 'cancelled'
    AND e.share_link_id IS NOT NULL
    AND public.can_manage_guest_list_part(auth.uid(), _guest_list_id)
  GROUP BY e.share_link_id
$$;

REVOKE ALL ON FUNCTION public.get_guest_list_share_link_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_list_share_link_stats(uuid) TO authenticated;
