/**
 * Tracked link redirect: /l/:code
 *
 * Records a click on a named tracked link (instagram, tiktok, newsletter…)
 * via the `record_tracked_link_click` RPC, stores the attribution so a later
 * purchase can be tied back to the link, then forwards the visitor to the
 * target event / venue / organizer page.
 *
 * Public route — no auth required. No new edge function (RPC only) so this
 * stays clear of the Supabase edge-function spend cap.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { setTrackedLinkForEvent, setActiveTrackedLink } from '@/hooks/usePurchaseSourceTracking';

const VISITOR_ID_KEY = 'yuno_aff_visitor_id';

function detectDevice(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getVisitorId(): string | null {
  try {
    return localStorage.getItem(VISITOR_ID_KEY);
  } catch {
    return null;
  }
}

export default function TrackedLinkRedirect() {
  const { code } = useParams<{ code: string }>();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-mount guard
    ran.current = true;

    let cancelled = false;

    (async () => {
      if (!code) {
        setFailed(true);
        return;
      }

      let target: string | null = null;
      try {
        const { data, error } = await supabase.rpc('record_tracked_link_click', {
          p_code: code,
          p_visitor_id: getVisitorId(),
          p_device_type: detectDevice(),
          p_referrer: document.referrer || null,
          p_user_agent: navigator.userAgent || null,
          p_ip_hash: null,
        });

        const res = (data ?? {}) as {
          found?: boolean;
          tracked_link_id?: string;
          target_kind?: string;
          event_id?: string;
          event_venue_id?: string;
          target_venue_id?: string;
          organizer_slug?: string;
          promo_code?: string;
        };

        if (!error && res.found && res.tracked_link_id) {
          const linkId = res.tracked_link_id;
          // Promoter links carry a promo code so the existing commission flow
          // (record_promoter_conversion) still fires via the ?ref= param.
          const refParam = res.promo_code ? `&ref=${encodeURIComponent(res.promo_code)}` : '';
          if (res.target_kind === 'event' && res.event_id) {
            setTrackedLinkForEvent(res.event_id, linkId);
            target = res.event_venue_id
              ? `/club/${res.event_venue_id}/event/${res.event_id}?tl=${linkId}${refParam}`
              : `/event/${res.event_id}?tl=${linkId}${refParam}`;
          } else if (res.target_kind === 'venue' && res.target_venue_id) {
            setActiveTrackedLink(linkId);
            target = `/club/${res.target_venue_id}`;
          } else if (res.target_kind === 'organizer' && res.organizer_slug) {
            setActiveTrackedLink(linkId);
            target = `/o/${res.organizer_slug}`;
          }
        }
      } catch {
        // ignore — fall through to fallback below
      }

      if (cancelled) return;

      if (target) {
        // Hard navigation so the destination page boots cleanly with the param.
        window.location.replace(target);
      } else {
        setFailed(true);
        window.location.replace('/');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="text-sm tracking-wide text-white/60">
        {failed ? 'Redirecting…' : 'Loading…'}
      </div>
    </div>
  );
}
