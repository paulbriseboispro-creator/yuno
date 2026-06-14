-- Linktree sort mode: affiliate admin controls default sort, can allow promoters to override
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS linktree_sort_mode text NOT NULL DEFAULT 'by_day'
    CHECK (linktree_sort_mode IN ('by_day', 'by_genre', 'by_price', 'custom')),
  ADD COLUMN IF NOT EXISTS allow_promoter_sort boolean NOT NULL DEFAULT false;

-- Per-member sort mode override (only effective when allow_promoter_sort = true on parent affiliate)
ALTER TABLE affiliate_members
  ADD COLUMN IF NOT EXISTS linktree_sort_mode text DEFAULT NULL
    CHECK (linktree_sort_mode IN ('by_day', 'by_genre', 'by_price', 'custom'));
