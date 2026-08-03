-- ============================================================================
-- P2 Cahier de conversions — Yuno devient le grand livre de l'agence.
--
-- La vente réelle se passe sur la billetterie externe (Fourvenues…) : Yuno ne
-- la voit pas. Mais l'agence REÇOIT les chiffres des clubs. Cette table lui
-- donne la saisie des ventes par soirée (billets attribués, CA optionnel,
-- commission due) rapprochée des clics tracés → funnel vues→clics→ventes et
-- registre des commissions dues par club (réglées / en attente / en retard —
-- « en retard » est dérivé à l'affichage : due depuis > 14 j après la soirée).
--
-- Un seul rapport par soirée (UNIQUE affiliate_event_id) : la saisie est un
-- upsert. Écriture réservée au chef d'agence (RLS user_id) ; pas de policy
-- anon ni membre — v1 admin-only, les managers lisent via l'admin.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.affiliate_reported_sales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id       uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  affiliate_event_id uuid NOT NULL UNIQUE REFERENCES affiliate_events(id) ON DELETE CASCADE,
  tickets_sold       integer NOT NULL DEFAULT 0 CHECK (tickets_sold >= 0),
  revenue_amount     numeric(10,2) CHECK (revenue_amount IS NULL OR revenue_amount >= 0),
  commission_due     numeric(10,2) NOT NULL DEFAULT 0 CHECK (commission_due >= 0),
  commission_status  text NOT NULL DEFAULT 'pending' CHECK (commission_status IN ('pending', 'settled')),
  settled_at         timestamptz,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_reported_sales_affiliate
  ON affiliate_reported_sales(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_aff_reported_sales_status
  ON affiliate_reported_sales(affiliate_id, commission_status);

CREATE TRIGGER trg_aff_reported_sales_updated_at
  BEFORE UPDATE ON affiliate_reported_sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE affiliate_reported_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aff_reported_sales_owner" ON affiliate_reported_sales
  FOR ALL USING (
    affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
  )
  WITH CHECK (
    affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
  );
