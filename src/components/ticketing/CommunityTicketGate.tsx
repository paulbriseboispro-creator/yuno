import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Mail, Lock, LogIn, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useFavorites } from '@/hooks/useFavorites';
import { useLanguage } from '@/contexts/LanguageContext';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { communityAudienceAllows, type TicketAudience } from '@/types/ticketing';

/**
 * Billets communauté — côté client.
 *
 * Un tarif `audience != 'everyone'` est réservé aux abonnés de l'HÔTE de la
 * soirée (le club, ou l'organisateur quand il n'y a pas de club) : abonnés du
 * profil Yuno, abonnés à la newsletter, ou l'un OU l'autre. La porte est
 * SERVEUR (create-ticket-checkout → check_community_access) ; ici on ne fait
 * que montrer le verrou et, surtout, l'action qui le lève — suivre le profil
 * ou s'abonner à la newsletter, en un tap, sans quitter la page.
 *
 * Trois états pour une personne :
 *  - 'open'        : elle a accès (tout le monde, ou membre de la communauté).
 *  - 'locked'      : connectée mais pas membre → CTA suivre / s'abonner.
 *                    Anonyme sur un tarif « abonnés du profil » → CTA connexion.
 *  - 'guest_email' : anonyme sur un tarif qui accepte la newsletter → elle peut
 *                    continuer : l'email saisi au paiement est vérifié serveur
 *                    (c'est ce qui sert une liste importée sans compte Yuno).
 */
export type CommunityStatus = 'open' | 'locked' | 'guest_email';

export interface CommunityAccess {
  hostKind: 'venue' | 'organizer';
  venueId: string | null;
  organizerUserId: string | null;
  hostName: string;
  hostSlug: string | null;
  isFollower: boolean;
  isSubscriber: boolean;
}

interface AccessRow {
  host_kind: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  host_name: string | null;
  host_slug: string | null;
  is_follower: boolean | null;
  is_subscriber: boolean | null;
}

export function communityStatus(
  audience: TicketAudience,
  access: CommunityAccess | null,
  loggedIn: boolean,
): CommunityStatus {
  if (audience === 'everyone') return 'open';
  if (!loggedIn) return audience === 'followers' ? 'locked' : 'guest_email';
  // Statut pas encore lu : on ne verrouille pas à tort, la porte serveur tranche.
  if (!access) return 'open';
  return communityAudienceAllows(audience, access.isFollower, access.isSubscriber) ? 'open' : 'locked';
}

/**
 * Hôte de la communauté + mon statut (RPC get_my_community_access, auth.uid()
 * seulement — jamais d'email en paramètre, sinon le checkout invité servirait à
 * tester si une adresse est cliente d'un club). Relu à chaque changement de
 * compte et après chaque action (follow / abonnement).
 */
export function useCommunityAccess(eventId: string | undefined, enabled: boolean) {
  const { user } = useAuth();
  const [access, setAccess] = useState<CommunityAccess | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!eventId || !enabled) { setAccess(null); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_community_access' as never, { p_event_id: eventId } as never);
    setLoading(false);
    if (error) { console.error('[community] lecture impossible', error); return; }
    const raw: unknown = data;
    const row = (Array.isArray(raw) ? raw[0] : raw) as AccessRow | null | undefined;
    if (!row) { setAccess(null); return; }
    setAccess({
      hostKind: row.host_kind === 'venue' ? 'venue' : 'organizer',
      venueId: row.venue_id,
      organizerUserId: row.organizer_user_id,
      hostName: row.host_name ?? '',
      hostSlug: row.host_slug,
      isFollower: row.is_follower === true,
      isSubscriber: row.is_subscriber === true,
    });
  }, [eventId, enabled, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void refresh(); }, [refresh]);

  return { access, loading, refresh, loggedIn: !!user };
}

interface CommunityCtaProps {
  audience: TicketAudience;
  access: CommunityAccess | null;
  eventId: string;
  /** Après un follow / abonnement réussi : relecture du statut. */
  onChanged: () => Promise<void> | void;
  /** Variante compacte (sous une carte de tarif) ou panneau (checkout). */
  compact?: boolean;
  className?: string;
}

/**
 * Le verrou et ce qui le lève. Chaque bouton EST l'action : suivre l'hôte
 * (favoris 'club' ou follow_organizer) ou s'abonner à sa newsletter
 * (subscribe_my_community_newsletter, preuve RGPD avec le libellé affiché).
 */
export function CommunityCta({ audience, access, eventId, onChanged, compact = false, className }: CommunityCtaProps) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { toggleFavorite } = useFavorites();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState<'follow' | 'newsletter' | null>(null);

  const hostName = access?.hostName || '';
  const wantsFollowers = audience === 'followers' || audience === 'community';
  const wantsNewsletter = audience === 'newsletter' || audience === 'community';

  const lockedText = (
    audience === 'followers' ? t('community.lockedFollowers')
      : audience === 'newsletter' ? t('community.lockedNewsletter')
        : t('community.lockedCommunity')
  ).replace('{name}', hostName);

  const goLogin = () => {
    navigate(`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`);
  };

  const follow = async () => {
    if (!access || busy) return;
    setBusy('follow');
    try {
      if (access.hostKind === 'venue' && access.venueId) {
        // toggleFavorite gère toasts + haptique ; on ne l'appelle que pour
        // S'ABONNER (le statut lu dit qu'on ne suit pas encore).
        await toggleFavorite('club', access.venueId, 'community_ticket');
      } else if (access.organizerUserId) {
        const { error } = await supabase.rpc('follow_organizer' as never, {
          p_organizer_user_id: access.organizerUserId, p_source: 'community_ticket',
        } as never);
        if (error) throw error;
        haptics.success();
      }
      await onChanged();
      toast.success(t('community.unlocked'));
    } catch (e) {
      console.error('[community] follow failed', e);
      haptics.error();
      toast.error(t('subscribe.error'));
    } finally {
      setBusy(null);
    }
  };

  const subscribe = async () => {
    if (!access || busy) return;
    setBusy('newsletter');
    try {
      // Le libellé du bouton est le consentement affiché : c'est lui qui part
      // en preuve (EDPB 05/2020 §108), dans la langue de la personne.
      const wording = t('community.newsletterCta').replace('{name}', hostName);
      const { data, error } = await supabase.rpc('subscribe_my_community_newsletter' as never, {
        p_event_id: eventId, p_wording_text: wording, p_locale: language, p_source: 'community_ticket',
      } as never);
      if (error || data !== true) throw error ?? new Error('subscribe refused');
      haptics.success();
      await onChanged();
      toast.success(t('community.unlocked'));
    } catch (e) {
      console.error('[community] subscribe failed', e);
      haptics.error();
      toast.error(t('community.subscribeError'));
    } finally {
      setBusy(null);
    }
  };

  const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-60';
  const btnSize = compact ? 'h-9 px-3 text-[12px]' : 'h-11 px-4 text-sm';

  return (
    <div
      className={cn('rounded-lg border border-primary/25 p-3', compact ? 'space-y-2.5' : 'space-y-3 p-4', className)}
      style={{ background: 'rgba(232,25,44,0.06)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className={cn('text-white/85 leading-snug', compact ? 'text-[12px]' : 'text-sm')}>{lockedText}</p>
          <p className={cn('text-white/50 leading-snug mt-0.5', compact ? 'text-[11px]' : 'text-xs')}>{t('community.unlockHint')}</p>
        </div>
      </div>

      {!user ? (
        <button type="button" onClick={goLogin} className={cn(btnBase, btnSize, 'w-full text-white')} style={{ background: '#E8192C' }}>
          <LogIn className="h-3.5 w-3.5" />{t('community.loginCta')}
        </button>
      ) : (
        <div className={cn('flex gap-2', compact ? 'flex-wrap' : 'flex-col sm:flex-row')}>
          {wantsFollowers && (
            access?.isFollower ? (
              <span className={cn(btnBase, btnSize, 'flex-1 border border-white/10 text-white/60 cursor-default')}>
                <Check className="h-3.5 w-3.5" />{t('community.followingLabel').replace('{name}', hostName)}
              </span>
            ) : (
              <button type="button" onClick={follow} disabled={!!busy} className={cn(btnBase, btnSize, 'flex-1 text-white')} style={{ background: '#E8192C' }}>
                {busy === 'follow' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                {t('community.followCta').replace('{name}', hostName)}
              </button>
            )
          )}
          {wantsNewsletter && (
            access?.isSubscriber ? (
              <span className={cn(btnBase, btnSize, 'flex-1 border border-white/10 text-white/60 cursor-default')}>
                <Check className="h-3.5 w-3.5" />{t('community.subscribedLabel')}
              </span>
            ) : (
              <button
                type="button"
                onClick={subscribe}
                disabled={!!busy}
                className={cn(btnBase, btnSize, 'flex-1 border text-white', wantsFollowers ? 'border-white/15 bg-white/[0.04]' : '')}
                style={wantsFollowers ? undefined : { background: '#E8192C' }}
              >
                {busy === 'newsletter' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                {t('community.newsletterCta').replace('{name}', hostName)}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
