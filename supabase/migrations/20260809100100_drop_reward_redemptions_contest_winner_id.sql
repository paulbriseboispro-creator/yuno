-- Final leaderboard residue: reward_redemptions.contest_winner_id.
-- Its FK to leaderboard_contest_winners was cascade-dropped along with the
-- leaderboard tables in 20260809100000. The column is now always NULL and
-- referenced by nothing; drop it so the shared loyalty table carries no trace
-- of the removed consumption-contest feature.
ALTER TABLE public.reward_redemptions DROP COLUMN IF EXISTS contest_winner_id;
