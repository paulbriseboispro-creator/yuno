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
          guest_list_token?: string;
          guest_list_event_id?: string;
          event_host?: string;
          event_slug?: string;
        };

        if (!error && res.found && res.tracked_link_id) {
          const linkId = res.tracked_link_id;
          // Promoter links carry a promo code so the existing commission flow
          // (record_promoter_conversion) still fires via the ?ref= param.
          const refParam = res.promo_code ? `&ref=${encodeURIComponent(res.promo_code)}` : '';
          // Base canonique du tunnel : /events/:host/:slug quand le serveur
          // résout les deux (règle portée par event_host_slug). L'ancienne
          // forme /club/:slug/event/:id ne sert plus que de repli, et une
          // soirée d'organisateur SANS club n'y a pas de slug à donner : ne
          // jamais en inventer un, c'est ce qui produisait `/club/event/...`
          // et un bouton de retour vers un club inexistant.
          const cleanBase = res.event_host && res.event_slug
            ? `/events/${res.event_host}/${res.event_slug}`
            : null;
          if (res.target_kind === 'event' && res.event_id) {
            setTrackedLinkForEvent(res.event_id, linkId);
            // Le chemin d'un lien suivi est résolu ICI : l'appelant ne peut pas
            // le rallonger, il passe donc son intention en `?to=`. Allowlist
            // stricte — un lien public ne doit jamais pouvoir composer une
            // route arbitraire.
            const wantsSelection = new URLSearchParams(window.location.search).get('to') === 'billets';
            const deepBase = cleanBase
              || (res.event_venue_id ? `/club/${res.event_venue_id}/event/${res.event_id}` : null);
            // `/event/<uuid>` est le repli quand le slug d'hôte n'est pas
            // résolu : il n'a PAS de `/billets`. On reste alors sur la soirée
            // plutôt que d'envoyer sur un 404.
            const base = deepBase || `/event/${res.event_id}`;
            const path = wantsSelection && deepBase ? `${deepBase}/billets` : base;
            target = `${path}?tl=${linkId}${refParam}`;
          } else if (res.target_kind === 'guestlist' && res.guest_list_token && res.guest_list_event_id) {
            // Le token de la part est indispensable : une part déléguée (DJ,
            // promoteur) n'est pas listée sur la page publique de la soirée.
            // `tl` suit pour que l'inscription soit attribuée à ce canal.
            setTrackedLinkForEvent(res.guest_list_event_id, linkId);
            const base = cleanBase
              || (res.event_venue_id
                ? `/club/${res.event_venue_id}/event/${res.guest_list_event_id}`
                : null);
            target = base
              ? `${base}/guestlist?token=${encodeURIComponent(res.guest_list_token)}&tl=${linkId}${refParam}`
              : `/event/${res.guest_list_event_id}?tl=${linkId}${refParam}`;
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
