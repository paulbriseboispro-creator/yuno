-- ─────────────────────────────────────────────────────────────────────────────
-- Audience Intelligence — Phase 0 : capture (1/4) — les tables.
--
-- L'audience abonnée (clubs, DJs, organisateurs) est la métrique centrale de la
-- marketplace, et elle FUIT aujourd'hui : `favorites` / `organizer_profile_followers`
-- portent la date d'abonnement (created_at), mais un désabonnement SUPPRIME la
-- ligne. On peut donc compter les abonnés à l'instant T, mais jamais reconstruire
-- la courbe NETTE ni le churn passé. Chaque jour sans journal = un jour d'histoire
-- perdu à jamais.
--
-- Deux tables :
--   1. audience_follow_events — journal append-only. La seule source qui capture
--      les départs. À partir de son démarrage, chaque follow/unfollow est tracé.
--   2. audience_daily_snapshots — rollup quotidien (rempli par un cron) : stock +
--      flux + joignables par sujet et par jour. C'est ce que lira la courbe
--      d'évolution, sans recalculer le journal brut à chaque affichage.
--
-- subject_id est TEXTE (polymorphe) : venue.id (déjà text), djs.user_id (la
-- PERSONNE, jamais une fiche par club — corrige le conflit de grain DJ), ou
-- organizer_user_id.
--
-- Sécurité : ces tables contiennent du cross-user (qui suit qui). RLS ACTIVÉE
-- SANS AUCUNE POLICY — modèle promoter_push_queue : purement interne. Aucun rôle
-- client (anon/authenticated) n'y accède. La lecture pro passera par des RPC
-- SECURITY DEFINER avec garde d'ownership (Phase 1), jamais en direct.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Journal append-only ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_follow_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_type     text NOT NULL CHECK (subject_type IN ('venue', 'dj', 'organizer')),
  subject_id       text NOT NULL,
  follower_user_id uuid NOT NULL,
  action           text NOT NULL CHECK (action IN ('follow', 'unfollow')),
  source           text,                                  -- best-effort : 'trigger' | 'backfill' | UI plus tard
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Lecture type : « le flux d'un sujet, du plus récent au plus ancien ».
CREATE INDEX IF NOT EXISTS idx_afe_subject
  ON public.audience_follow_events (subject_type, subject_id, created_at DESC);
-- Lecture type : « tous les événements d'un jour » (le cron snapshot).
CREATE INDEX IF NOT EXISTS idx_afe_created
  ON public.audience_follow_events (created_at);

ALTER TABLE public.audience_follow_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audience_follow_events FROM anon, authenticated;

COMMENT ON TABLE public.audience_follow_events IS
  'Journal append-only des follow/unfollow (venue/dj/organizer). Seule source du churn. RLS sans policy = interne (triggers SECURITY DEFINER + service_role).';

-- ── 2. Snapshots quotidiens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_daily_snapshots (
  subject_type     text NOT NULL CHECK (subject_type IN ('venue', 'dj', 'organizer')),
  subject_id       text NOT NULL,
  snapshot_date    date NOT NULL,
  followers_total  int NOT NULL DEFAULT 0,   -- STOCK : compte vivant (autoritaire, s'auto-corrige)
  follows_gained   int NOT NULL DEFAULT 0,   -- FLUX du jour (depuis le journal)
  follows_lost     int NOT NULL DEFAULT 0,
  net_change       int NOT NULL DEFAULT 0,   -- gained - lost
  reachable_count  int NOT NULL DEFAULT 0,   -- abonnés avec un token push client actif
  PRIMARY KEY (subject_type, subject_id, snapshot_date)
);

ALTER TABLE public.audience_daily_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audience_daily_snapshots FROM anon, authenticated;

COMMENT ON TABLE public.audience_daily_snapshots IS
  'Rollup quotidien par sujet : stock (followers_total, autoritaire) + flux (gained/lost/net) + joignables. Lu par la courbe d''évolution. Rempli par run_audience_snapshot().';
