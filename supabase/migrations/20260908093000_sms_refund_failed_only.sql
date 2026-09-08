-- Politique de remboursement des crédits SMS : seuls les messages REFUSÉS
-- (jamais remis à l'opérateur, non facturés par Twilio) sont remboursés. Un
-- message « non délivré » a été facturé à Yuno et reste décompté au pro, comme
-- chez tous les fournisseurs SMS. Sans cette règle, 5 % de non délivrés sur un
-- pack Scale absorbaient toute la marge du pack.
CREATE OR REPLACE FUNCTION public.apply_sms_delivery_status(
  p_twilio_sid text, p_status text, p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_log        public.sms_logs%ROWTYPE;
  v_new        public.sms_status;
  v_rec_id     uuid;
  v_rec_status text;
  v_campaign   uuid;
  v_balance    uuid;
  v_refunded   boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'apply_sms_delivery_status: service_role only';
  END IF;

  SELECT * INTO v_log FROM public.sms_logs WHERE twilio_sid = p_twilio_sid LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_new := CASE p_status
             WHEN 'delivered'   THEN 'delivered'::public.sms_status
             WHEN 'failed'      THEN 'failed'::public.sms_status
             WHEN 'undelivered' THEN 'undelivered'::public.sms_status
             WHEN 'sent'        THEN 'sent'::public.sms_status
             ELSE NULL
           END;

  IF v_new IS NOT NULL THEN
    -- Un « sent » tardif ne doit jamais écraser un « delivered » déjà reçu.
    UPDATE public.sms_logs
       SET status = CASE WHEN v_new = 'sent' AND status IN ('delivered','failed','undelivered') THEN status ELSE v_new END,
           delivered_at = CASE WHEN v_new = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
           error_code = COALESCE(p_error_code, error_code),
           error_message = COALESCE(p_error_message, error_message)
     WHERE id = v_log.id;
  END IF;

  -- Ligne de file correspondante (campagnes uniquement ; les SMS transactionnels
  -- n'en ont pas).
  SELECT r.id, r.status, r.campaign_id INTO v_rec_id, v_rec_status, v_campaign
    FROM public.sms_campaign_recipients r
   WHERE r.twilio_sid = p_twilio_sid
   LIMIT 1;

  IF v_rec_id IS NOT NULL AND v_new IS NOT NULL AND v_new <> 'sent'
     AND v_rec_status NOT IN ('delivered','failed','undelivered') THEN
    UPDATE public.sms_campaign_recipients
       SET status = v_new::text,
           delivered_at = CASE WHEN v_new = 'delivered' THEN now() ELSE delivered_at END,
           error_code = COALESCE(p_error_code, error_code),
           error_message = COALESCE(p_error_message, error_message)
     WHERE id = v_rec_id;

    UPDATE public.sms_campaigns
       SET delivered_count   = delivered_count   + CASE WHEN v_new = 'delivered'   THEN 1 ELSE 0 END,
           undelivered_count = undelivered_count + CASE WHEN v_new = 'undelivered' THEN 1 ELSE 0 END,
           failed_count      = failed_count      + CASE WHEN v_new = 'failed'      THEN 1 ELSE 0 END
     WHERE id = v_campaign;
  END IF;

  -- Remboursement UNIQUEMENT sur 'failed' (message jamais parti : Twilio ne le
  -- facture pas). Un 'undelivered' a été remis à l'opérateur et EST facturé à
  -- Yuno : il reste à la charge du pro, comme chez tout fournisseur SMS
  -- (décision produit 2026-09-08, cf. docs/SMS_MARKETING.md).
  IF v_new = 'failed' AND NOT v_log.refunded THEN
    SELECT id INTO v_balance FROM public.sms_credit_balances
     WHERE (v_log.venue_id IS NOT NULL AND venue_id = v_log.venue_id)
        OR (v_log.organizer_id IS NOT NULL AND organizer_id = v_log.organizer_id)
     LIMIT 1;
    IF v_balance IS NOT NULL THEN
      PERFORM public.refund_sms_credits(v_balance, GREATEST(1, v_log.credits_consumed), v_log.id,
        'Auto-refund: Twilio ' || v_new::text || ' (' || COALESCE(p_error_code, 'no code') || ')');
      v_refunded := true;
      IF v_campaign IS NOT NULL THEN
        UPDATE public.sms_campaigns
           SET credits_refunded = credits_refunded + GREATEST(1, v_log.credits_consumed)
         WHERE id = v_campaign;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('found', true, 'status', v_new, 'refunded', v_refunded, 'campaign_id', v_campaign);
END;
$$;
