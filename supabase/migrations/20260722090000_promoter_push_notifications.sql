-- ============================================================================
-- Notifications push du promoteur (app Yuno Pro).
--
-- Un promoteur ne recevait RIEN sur son telephone. Tout ce qui le concerne —
-- une vente, une annonce du club, une soiree qui lui est confiee, sa page
-- validee, une commission annulee par un remboursement — n'existait que s'il
-- pensait a ouvrir l'app. Le tableau de bord affiche bien un toast temps reel
-- sur une nouvelle vente, mais uniquement tant que l'ecran est ouvert : sur un
-- telephone verrouille, rien.
--
-- ── Pourquoi une FILE et pas un push direct ────────────────────────────────
--
-- Le probleme central n'est pas d'envoyer, c'est de NE PAS envoyer. Un
-- promoteur qui fait 50 ventes un samedi soir ne doit pas recevoir 50 push :
-- il aurait desinstalle l'app avant minuit. Les push transactionnels echappent
-- d'ailleurs a tous les plafonds anti-spam existants (ceux-ci ne comptent que
-- 'marketing'/'campaign'/'reminder'), donc rien n'aurait retenu le flot.
--
-- On ecrit donc l'intention dans une file, et la coalescence se fait A
-- L'INSERTION via `dedup_key` : deux evenements de meme cle non encore envoyes
-- fusionnent en une seule ligne dont les compteurs s'additionnent. Trente
-- ventes d'equipe dans la soiree = une ligne, « +240€ ». C'est la meme logique
-- que l'anti-spam du bar (« le push sert a REVEILLER quand rien n'attendait »),
-- appliquee au promoteur.
--
-- Deuxieme raison : les declencheurs sont des triggers, donc dans la meme
-- transaction que l'ecriture metier. Un INSERT dans une table locale ne peut
-- pas faire echouer une vente ni la ralentir, la ou un appel HTTP le pourrait.
--
-- Troisieme raison : le cap de fonctions edge Supabase renvoie 402 sur tout
-- nouveau deploiement. La file est vidangee par `dispatchPromoterPushes()`,
-- branche sur le cron `process-scheduled-campaigns` qui tourne deja toutes les
-- 5 minutes — exactement ce que fait live-ops-alerts pour la meme raison.
--
-- ── Ce qui est notifie, et ce qui ne l'est pas ─────────────────────────────
--
--   promoter_sale_first          premiere vente apres 4 h de calme (reveil)
--   promoter_night_digest        le lendemain matin : le bilan de la soiree
--   promoter_goal_reached        objectif d'une soiree atteint
--   promoter_team_override       commission d'equipe du jour (cumulee)
--   promoter_announcement        le club ecrit a ses promoteurs
--   promoter_event_assigned      une soiree lui est confiee
--   promoter_linktree_reviewed   sa page publique validee / a revoir
--   promoter_commission_cancelled un remboursement annule une commission
--
-- Volontairement PAS notifie : chaque vente (c'est le digest qui raconte la
-- nuit), chaque invite qui passe la porte (jusqu'a 40 par soiree).
-- ============================================================================

-- ── 1. La file ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promoter_push_queue (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promoter_id uuid REFERENCES public.promoters(id) ON DELETE CASCADE,
  -- Correspond a une cle du registre AUTO_PUSH (_shared/auto-push.ts).
  push_key    text NOT NULL,
  variant     text NOT NULL DEFAULT 'default',
  vars        jsonb NOT NULL DEFAULT '{}'::jsonb,
  url         text NOT NULL DEFAULT '/promoter',
  -- Cle de coalescence. NULL = jamais fusionne (chaque evenement compte).
  dedup_key   text,
  -- Permet de differer un envoi a une heure civile : personne n'a besoin
  -- d'apprendre a 3 h du matin qu'un remboursement a annule une commission.
  not_before  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

-- Coalescence : tant qu'une ligne n'est pas partie, une nouvelle occurrence de
-- la meme cle la met a jour au lieu d'en creer une seconde.
CREATE UNIQUE INDEX IF NOT EXISTS promoter_push_queue_dedup_uniq
  ON public.promoter_push_queue (dedup_key)
  WHERE dedup_key IS NOT NULL AND sent_at IS NULL;

-- La vidange ne lit que ce qui est du.
CREATE INDEX IF NOT EXISTS idx_promoter_push_queue_pending
  ON public.promoter_push_queue (not_before)
  WHERE sent_at IS NULL;

-- Sert le garde-fou de delai minimum : « quand ai-je pousse cette cle a cette
-- personne pour la derniere fois ? ».
CREATE INDEX IF NOT EXISTS idx_promoter_push_queue_last_sent
  ON public.promoter_push_queue (user_id, push_key, sent_at DESC)
  WHERE sent_at IS NOT NULL;

ALTER TABLE public.promoter_push_queue ENABLE ROW LEVEL SECURITY;
-- Aucune policy : file purement interne. Les triggers l'alimentent en
-- SECURITY DEFINER, le cron la vide en service_role. Un client n'a rien a y
-- lire — le contenu utile lui arrive par le push lui-meme.

COMMENT ON TABLE public.promoter_push_queue IS
  'File des push promoteur. La coalescence par dedup_key evite le flot de push un soir de grosse vente.';

-- ── 2. Mise en file ─────────────────────────────────────────────────────────
-- Additionne `count` et `amount` quand la ligne existe deja : c'est ce qui
-- transforme trente evenements en une notification « 30 ventes, 240€ ».
--
-- `p_min_interval` est le second garde-fou, et il est indispensable : la
-- coalescence par `dedup_key` ne vaut que TANT QUE la ligne n'est pas partie.
-- Sans delai minimum, la vidange (toutes les 5 min) enverrait une ligne, une
-- nouvelle se creerait aussitot, et un chef d'equipe dont l'equipe vend toute
-- la nuit recevrait un push tous les quarts d'heure. Avec un delai, la ligne
-- suivante attend son tour en continuant d'accumuler : un seul push, avec le
-- total complet.
CREATE OR REPLACE FUNCTION public.enqueue_promoter_push(
  p_user_id      uuid,
  p_promoter_id  uuid,
  p_push_key     text,
  p_vars         jsonb DEFAULT '{}'::jsonb,
  p_url          text DEFAULT '/promoter',
  p_dedup_key    text DEFAULT NULL,
  p_variant      text DEFAULT 'default',
  p_not_before   timestamptz DEFAULT NULL,
  p_min_interval interval DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_not_before timestamptz;
  v_last_sent  timestamptz;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  v_not_before := COALESCE(p_not_before, now());

  IF p_min_interval IS NOT NULL THEN
    SELECT max(sent_at) INTO v_last_sent
    FROM promoter_push_queue
    WHERE user_id = p_user_id AND push_key = p_push_key AND sent_at IS NOT NULL;

    IF v_last_sent IS NOT NULL THEN
      v_not_before := GREATEST(v_not_before, v_last_sent + p_min_interval);
    END IF;
  END IF;

  INSERT INTO promoter_push_queue (
    user_id, promoter_id, push_key, variant, vars, url, dedup_key, not_before
  ) VALUES (
    p_user_id, p_promoter_id, p_push_key, COALESCE(p_variant, 'default'),
    COALESCE(p_vars, '{}'::jsonb), COALESCE(p_url, '/promoter'),
    p_dedup_key, v_not_before
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL AND sent_at IS NULL
  DO UPDATE SET
    -- On repart des variables les plus recentes (libelles a jour), puis on
    -- reinjecte les compteurs cumules.
    vars = EXCLUDED.vars || jsonb_build_object(
      'count',  COALESCE((promoter_push_queue.vars->>'count')::numeric, 0)
              + COALESCE((EXCLUDED.vars->>'count')::numeric, 0),
      'amount', COALESCE((promoter_push_queue.vars->>'amount')::numeric, 0)
              + COALESCE((EXCLUDED.vars->>'amount')::numeric, 0)
    ),
    -- La fenetre de silence eventuelle est conservee (on ne rapproche jamais
    -- un envoi differe en le re-declenchant).
    not_before = GREATEST(promoter_push_queue.not_before, EXCLUDED.not_before);
END;
$fn$;

-- ── 3. Ventes : reveiller, puis se taire ────────────────────────────────────
-- Trois evenements se lisent sur la ligne de commission elle-meme, sans jamais
-- toucher au moteur de calcul (record_promoter_conversion) : c'est le chemin de
-- l'argent, on ne le reecrit pas pour poser une notification.
CREATE OR REPLACE FUNCTION public.promoter_push_on_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id uuid;
  v_leader_promoter uuid;
  v_leader_user uuid;
  v_recent int;
  v_event_count int;
  v_goal int;
  v_event_title text;
BEGIN
  IF COALESCE(NEW.commission, 0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;

  SELECT user_id INTO v_user_id FROM promoters WHERE id = NEW.promoter_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  -- ── Commission d'equipe : c'est le chef d'equipe qu'on previent, une fois
  -- par jour, montant cumule. Trente ventes de son equipe = un push.
  IF NEW.conversion_type = 'override' THEN
    PERFORM public.enqueue_promoter_push(
      v_user_id, NEW.promoter_id, 'promoter_team_override',
      jsonb_build_object('count', 1, 'amount', NEW.commission),
      '/promoter',
      'override:' || NEW.promoter_id || ':' || to_char(now(), 'YYYYMMDD'),
      'default', NULL,
      -- Une equipe qui vend toute la nuit ne doit reveiller son chef qu'une
      -- fois : le cumul continue de grossir dans la ligne en attente.
      interval '12 hours'
    );
    RETURN NEW;
  END IF;

  -- ── Premiere vente apres une accalmie : le push sert a REVEILLER. Au-dela,
  -- le promoteur a l'app ouverte (toast temps reel) et recevra le bilan le
  -- lendemain matin. Meme logique que le bar qu'on ne reveille que si la file
  -- etait vide.
  SELECT count(*) INTO v_recent
  FROM promoter_conversions pc
  WHERE pc.promoter_id = NEW.promoter_id
    AND pc.id <> NEW.id
    AND pc.conversion_type <> 'override'
    AND pc.status <> 'cancelled'
    AND pc.created_at > now() - interval '4 hours';

  IF v_recent = 0 THEN
    PERFORM public.enqueue_promoter_push(
      v_user_id, NEW.promoter_id, 'promoter_sale_first',
      jsonb_build_object('amount', NEW.commission),
      '/promoter',
      'salefirst:' || NEW.promoter_id || ':' || to_char(now(), 'YYYYMMDD'),
      'default', NULL,
      -- Un seul reveil par nuit, meme si l'activite s'interrompt plusieurs fois.
      interval '8 hours'
    );
  END IF;

  -- ── Objectif de la soiree atteint. L'egalite stricte fait que ca ne part
  -- qu'une fois, sans avoir a memoriser quoi que ce soit.
  IF NEW.event_id IS NOT NULL THEN
    SELECT goal_target INTO v_goal
    FROM promoter_event_assignments
    WHERE promoter_id = NEW.promoter_id AND event_id = NEW.event_id;

    IF COALESCE(v_goal, 0) > 0 THEN
      SELECT count(*) INTO v_event_count
      FROM promoter_conversions pc
      WHERE pc.promoter_id = NEW.promoter_id
        AND pc.event_id = NEW.event_id
        AND pc.conversion_type <> 'override'
        AND pc.status <> 'cancelled';

      IF v_event_count = v_goal THEN
        SELECT title INTO v_event_title FROM events WHERE id = NEW.event_id;
        PERFORM public.enqueue_promoter_push(
          v_user_id, NEW.promoter_id, 'promoter_goal_reached',
          jsonb_build_object('event', COALESCE(v_event_title, ''), 'goal', v_goal),
          '/promoter/event/' || NEW.event_id,
          'goal:' || NEW.promoter_id || ':' || NEW.event_id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promoter_push_on_conversion ON public.promoter_conversions;
CREATE TRIGGER trg_promoter_push_on_conversion
  AFTER INSERT ON public.promoter_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.promoter_push_on_conversion();

-- ── 4. Commission annulee par un remboursement ──────────────────────────────
-- De l'argent disparait du solde sans un mot : c'est exactement le genre de
-- silence qui detruit la confiance. On cumule sur la journee et on ne livre
-- pas en pleine nuit.
CREATE OR REPLACE FUNCTION public.promoter_push_on_conversion_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id uuid;
  -- SANS fuseau, volontairement : on raisonne en heure murale parisienne, et la
  -- conversion en instant reel n'a lieu qu'au moment de l'appel, une seule fois.
  -- Declare en timestamptz, la valeur naive serait d'abord lue comme de l'UTC,
  -- puis reconvertie — et la notification tombait a 14 h au lieu de 10 h.
  v_due timestamp;
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN RETURN NEW; END IF;
  IF COALESCE(OLD.commission, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT user_id INTO v_user_id FROM promoters WHERE id = NEW.promoter_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  -- Prochain 10 h (heure de Paris) : une annulation constatee a 3 h du matin
  -- attend le matin.
  v_due := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '10 hours';
  IF v_due <= (now() AT TIME ZONE 'Europe/Paris') THEN
    v_due := v_due + interval '1 day';
  END IF;

  PERFORM public.enqueue_promoter_push(
    v_user_id, NEW.promoter_id, 'promoter_commission_cancelled',
    jsonb_build_object('count', 1, 'amount', OLD.commission),
    '/promoter',
    'cancelled:' || NEW.promoter_id || ':' || to_char(now(), 'YYYYMMDD'),
    'default',
    v_due AT TIME ZONE 'Europe/Paris',
    interval '12 hours'
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promoter_push_on_conversion_cancelled ON public.promoter_conversions;
CREATE TRIGGER trg_promoter_push_on_conversion_cancelled
  AFTER UPDATE OF status ON public.promoter_conversions
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.promoter_push_on_conversion_cancelled();

-- ── 5. Le club ecrit a ses promoteurs ───────────────────────────────────────
-- Geste humain delibere, volume naturellement faible : un push par annonce,
-- sans coalescence.
CREATE OR REPLACE FUNCTION public.promoter_push_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sender text;
  r RECORD;
BEGIN
  IF NEW.venue_id IS NOT NULL THEN
    SELECT name INTO v_sender FROM venues WHERE id = NEW.venue_id;
  ELSIF NEW.organizer_user_id IS NOT NULL THEN
    SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      INTO v_sender FROM profiles WHERE id = NEW.organizer_user_id;
  END IF;

  FOR r IN
    SELECT p.id, p.user_id
    FROM promoters p
    WHERE p.is_active
      AND p.user_id IS NOT NULL
      AND ((NEW.venue_id IS NOT NULL AND p.venue_id = NEW.venue_id)
        OR (NEW.organizer_user_id IS NOT NULL AND p.organizer_user_id = NEW.organizer_user_id))
  LOOP
    PERFORM public.enqueue_promoter_push(
      r.user_id, r.id, 'promoter_announcement',
      jsonb_build_object(
        'sender', COALESCE(NULLIF(v_sender, ''), 'Le club'),
        'title', COALESCE(NEW.title, '')
      ),
      '/promoter',
      'announcement:' || NEW.id || ':' || r.id
    );
  END LOOP;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promoter_push_on_announcement ON public.promoter_announcements;
CREATE TRIGGER trg_promoter_push_on_announcement
  AFTER INSERT ON public.promoter_announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.promoter_push_on_announcement();

-- ── 6. Une soiree lui est confiee ───────────────────────────────────────────
-- Couvre l'assignation manuelle ET l'auto-assignation (trigger sur events) :
-- on ecoute la table d'assignation, donc peu importe qui a ecrit.
CREATE OR REPLACE FUNCTION public.promoter_push_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id uuid;
  v_title text;
  v_start timestamptz;
BEGIN
  SELECT user_id INTO v_user_id FROM promoters WHERE id = NEW.promoter_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT title, start_at INTO v_title, v_start FROM events WHERE id = NEW.event_id;
  -- Une soiree deja passee (rattrapage, reprise de donnees) n'a aucun interet
  -- a etre poussee.
  IF v_start IS NULL OR v_start < now() THEN RETURN NEW; END IF;

  PERFORM public.enqueue_promoter_push(
    v_user_id, NEW.promoter_id, 'promoter_event_assigned',
    jsonb_build_object(
      'event', COALESCE(v_title, ''),
      'date', to_char(v_start AT TIME ZONE 'Europe/Paris', 'DD/MM')
    ),
    '/promoter/event/' || NEW.event_id,
    'assigned:' || NEW.promoter_id || ':' || NEW.event_id
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promoter_push_on_assignment ON public.promoter_event_assignments;
CREATE TRIGGER trg_promoter_push_on_assignment
  AFTER INSERT ON public.promoter_event_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.promoter_push_on_assignment();

-- ── 7. Sa page publique est validee, ou renvoyee en brouillon ───────────────
-- Sans notification, la page reste hors ligne et le promoteur ne le sait pas :
-- il partage un lien mort en soiree.
CREATE OR REPLACE FUNCTION public.promoter_push_on_linktree_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.linktree_status = 'approved' THEN
    PERFORM public.enqueue_promoter_push(
      NEW.user_id, NEW.id, 'promoter_linktree_reviewed',
      jsonb_build_object('slug', COALESCE(NEW.promo_code, '')),
      '/promoter',
      'linktree:' || NEW.id || ':approved:' || to_char(now(), 'YYYYMMDDHH24MI'),
      'approved'
    );
  ELSIF NEW.linktree_status = 'draft' AND OLD.linktree_status = 'pending_review' THEN
    PERFORM public.enqueue_promoter_push(
      NEW.user_id, NEW.id, 'promoter_linktree_reviewed',
      '{}'::jsonb,
      '/promoter',
      'linktree:' || NEW.id || ':changes:' || to_char(now(), 'YYYYMMDDHH24MI'),
      'changes'
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promoter_push_on_linktree_review ON public.promoters;
CREATE TRIGGER trg_promoter_push_on_linktree_review
  AFTER UPDATE OF linktree_status ON public.promoters
  FOR EACH ROW
  WHEN (NEW.linktree_status IS DISTINCT FROM OLD.linktree_status)
  EXECUTE FUNCTION public.promoter_push_on_linktree_review();

-- ── 8. Le bilan du lendemain ────────────────────────────────────────────────
-- C'est LUI qui raconte la nuit, une seule fois, plutot que cinquante push
-- pendant la soiree. Seuil a 2 ventes : en dessous, `promoter_sale_first` a
-- deja tout dit.
CREATE OR REPLACE FUNCTION public.enqueue_promoter_night_digests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id AS promoter_id, p.user_id,
           count(*) AS sales,
           SUM(COALESCE(pc.commission, 0)) AS total
    FROM promoter_conversions pc
    JOIN promoters p ON p.id = pc.promoter_id
    WHERE pc.created_at > now() - interval '18 hours'
      AND pc.conversion_type <> 'override'
      AND pc.status <> 'cancelled'
      AND p.user_id IS NOT NULL
    GROUP BY p.id, p.user_id
    HAVING count(*) >= 2 AND SUM(COALESCE(pc.commission, 0)) > 0
  LOOP
    PERFORM public.enqueue_promoter_push(
      r.user_id, r.promoter_id, 'promoter_night_digest',
      jsonb_build_object('count', r.sales, 'amount', r.total),
      '/promoter',
      'digest:' || r.promoter_id || ':' || to_char(now(), 'YYYYMMDD')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('queued', v_count);
END;
$fn$;

-- ── 9. Relance de l'accuse de reception d'un reglement ──────────────────────
-- La cle `promoter_payout_reminder` existait dans le registre sans aucun
-- appelant : un lot pouvait basculer en litige sans que le promoteur ait ete
-- relance une seule fois. On relance a 48 h de l'echeance.
CREATE OR REPLACE FUNCTION public.enqueue_promoter_payout_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT pp.id, pp.amount, p.id AS promoter_id, p.user_id,
           COALESCE(
             v.name,
             NULLIF(trim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
             'Le club'
           ) AS payer
    FROM promoter_payouts pp
    JOIN promoters p ON p.id = pp.promoter_id
    LEFT JOIN venues v ON v.id = pp.venue_id
    LEFT JOIN profiles pr ON pr.id = pp.organizer_user_id
    WHERE pp.status = 'approved'
      AND pp.confirm_due_at IS NOT NULL
      AND pp.confirm_due_at > now()
      AND pp.confirm_due_at < now() + interval '48 hours'
      AND p.user_id IS NOT NULL
  LOOP
    PERFORM public.enqueue_promoter_push(
      r.user_id, r.promoter_id, 'promoter_payout_reminder',
      jsonb_build_object('payer', r.payer, 'amount', r.amount),
      '/promoter',
      'payoutreminder:' || r.id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('queued', v_count);
END;
$fn$;

-- ── 10. Purge ───────────────────────────────────────────────────────────────
-- La file est un tampon, pas un journal : `auto_push_events` garde deja la
-- trace de ce qui est parti.
CREATE OR REPLACE FUNCTION public.purge_promoter_push_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted int;
BEGIN
  WITH gone AS (
    DELETE FROM promoter_push_queue
    WHERE (sent_at IS NOT NULL AND sent_at < now() - interval '7 days')
       -- Filet : une ligne jamais partie (cle inconnue, promoteur sans app)
       -- ne doit pas s'accumuler indefiniment.
       OR (sent_at IS NULL AND created_at < now() - interval '30 days')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM gone;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_promoter_push(uuid, uuid, text, jsonb, text, text, text, timestamptz, interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_promoter_night_digests() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_promoter_payout_reminders() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_promoter_push_queue() FROM public, anon, authenticated;

-- ── 11. Planification ───────────────────────────────────────────────────────
-- Les trois taches ne font qu'ALIMENTER la file ; c'est le cron edge
-- (process-scheduled-campaigns, toutes les 5 min) qui envoie reellement.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('promoter-night-digest')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promoter-night-digest');
    PERFORM cron.unschedule('promoter-payout-reminders')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promoter-payout-reminders');
    PERFORM cron.unschedule('promoter-push-queue-purge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promoter-push-queue-purge');

    -- 09:00 UTC ≈ 11 h a Paris : le bilan arrive au reveil, pas a 4 h du matin
    -- quand le promoteur rentre a peine.
    PERFORM cron.schedule('promoter-night-digest', '0 9 * * *',
      $cron$ SELECT public.enqueue_promoter_night_digests(); $cron$);

    PERFORM cron.schedule('promoter-payout-reminders', '0 10 * * *',
      $cron$ SELECT public.enqueue_promoter_payout_reminders(); $cron$);

    PERFORM cron.schedule('promoter-push-queue-purge', '20 4 * * *',
      $cron$ SELECT public.purge_promoter_push_queue(); $cron$);
  END IF;
END $$;

-- ── 12. Registre super admin ────────────────────────────────────────────────
-- Chaque cle reste coupable d'un clic depuis /admin/notifications.
INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('promoter_sale_first',           'engagement'),
  ('promoter_night_digest',         'engagement'),
  ('promoter_goal_reached',         'engagement'),
  ('promoter_team_override',        'engagement'),
  ('promoter_announcement',         'transactional'),
  ('promoter_event_assigned',       'engagement'),
  ('promoter_linktree_reviewed',    'transactional'),
  ('promoter_commission_cancelled', 'transactional')
ON CONFLICT (notification_key) DO NOTHING;
