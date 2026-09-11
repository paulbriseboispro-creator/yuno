-- ═══════════════════════════════════════════════════════════════════════════
-- « Complet » posé À LA MAIN sur les trois piliers d'une soirée.
--
-- Les billets avaient ça PALIER PAR PALIER depuis 20260629150000
-- (ticket_rounds.manually_sold_out) : fermer un palier sans attendre que la capacité
-- soit atteinte. Rien au niveau de la soirée, et rien du tout sur les deux autres
-- piliers. Pour fermer les tables d'une soirée, il fallait
-- désactiver la vente (`events.tables_enabled = false`, la section disparaît de la
-- page publique) ou désactiver chaque formule (`table_packs.is_active`, venue-scopé
-- pour un club — donc sur TOUTES ses soirées). Aucune des deux n'est « complet » :
-- une soirée pleine doit continuer à s'afficher, pleine.
--
-- Portée : TOUT est event-scopé, club comme organisateur. Les formules d'un club
-- sont venue-scopées (réutilisées d'une soirée à l'autre) : marquer « complet »
-- sur `table_packs` fermerait la formule partout. C'est pourquoi la liste des
-- formules complètes vit sur l'ÉVÉNEMENT, jamais sur le pack. Une seule mécanique
-- pour les deux portées.
--
-- Ce drapeau ne ferme QUE la vente en libre-service (page publique, checkout,
-- inscription guest list). Le club garde la main : ajout manuel d'un invité,
-- réservation walk-in, placement — rien de tout ça n'est concerné.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Soirée : les trois interrupteurs event-scopés ─────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tickets_sold_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tables_sold_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_list_sold_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_out_pack_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.events.tickets_sold_out IS
  'Toute la billetterie de la soirée marquée complète. Interrupteur de SOIRÉE, réversible : il ne touche pas ticket_rounds.is_active, contrairement au drapeau par palier (ticket_rounds.manually_sold_out) qui referme le palier et ouvre le suivant.';

COMMENT ON COLUMN public.events.tables_sold_out IS
  'Toutes les tables VIP de la soirée marquées complètes par le club/organisateur. Bloque le checkout table + grise la section publique. N''éteint PAS tables_enabled : la soirée reste affichée, complète.';

COMMENT ON COLUMN public.events.sold_out_pack_ids IS
  'Formules (table_packs.id) marquées complètes POUR CETTE SOIRÉE. Event-scopé exprès : les packs d''un club sont venue-scopés et réutilisés d''une soirée à l''autre.';

COMMENT ON COLUMN public.events.guest_list_sold_out IS
  'Toute la guest list de la soirée (toutes les parts : maison, DJ, promoteurs, agence) est fermée aux nouvelles inscriptions. L''ajout manuel par le club reste possible.';

-- ── 2) Part de guest list : fermer UNE liste ────────────────────────────────
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS manually_sold_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.guest_lists.manually_sold_out IS
  'Part complète forcée (indépendante du quota). Bloque l''inscription publique ET par lien d''invitation ; is_active reste true pour que la part et ses invités restent visibles côté pro.';

-- ── 3) Le lien d'invitation nominatif doit connaître le drapeau ─────────────
-- Sans ça, le porteur d'un lien `?invite=` voyait le formulaire, le remplissait,
-- et n'apprenait qu'au clic « Confirmer » que la liste est fermée. Le lien par
-- share_token n'a pas ce problème : get_guest_list_by_token rend SETOF guest_lists.
CREATE OR REPLACE FUNCTION public.get_guest_list_invite(_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'invite', jsonb_build_object(
      'id',         i.id,
      'entry_type', i.entry_type,
      'max_uses',   i.max_uses,
      'used_count', i.used_count,
      'guest_name', i.guest_name,
      'revoked',    (i.revoked_at IS NOT NULL)
    ),
    'guest_list', jsonb_build_object(
      'id',                 gl.id,
      'event_id',           gl.event_id,
      'holder_type',        gl.holder_type,
      'quota',              gl.quota,
      'quota_female',       gl.quota_female,
      'quota_male',         gl.quota_male,
      'show_remaining',     gl.show_remaining,
      'free_before_time',   gl.free_before_time,
      'entry_deadline',     gl.entry_deadline,
      'includes_drink',     gl.includes_drink,
      'is_active',          gl.is_active,
      'manually_sold_out',  gl.manually_sold_out
    )
  )
  FROM public.guest_list_invites i
  JOIN public.guest_lists gl ON gl.id = i.guest_list_id
  WHERE i.token = _token
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_list_invite(text) TO anon, authenticated;
