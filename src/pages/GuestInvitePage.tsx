/**
 * GuestInvitePage — /h/:token
 *
 * L'INVITATION à l'espace d'une soirée (décision de Paul, 21/10) : le lien de
 * l'e-mail ou de WhatsApp porte un jeton à usage unique qui ne fait que
 * RATTACHER l'accès à un compte Yuno simple (`redeem_event_guest_pass`).
 * Déconnecté : on présente l'invitation et on envoie créer son compte (ou se
 * connecter) avec l'adresse de l'invitation pré-remplie, retour ici. Connecté
 * avec le bon compte : rattachement puis l'espace, `/invite/<id>`. Le jeton
 * n'ouvre jamais l'espace lui-même.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Wordmark } from '@/components/brand/Wordmark';
import { Seo } from '@/components/Seo';
import { OrgButton, T1, T2, T3, BORDER, CARD_BG } from '@/components/org-ui';
import {
  guestErrorCode, guestSpaceLocale, guestSpacePath, guestSpaceWords, isGuestToken, loadGuestInvite, redeemGuestInvite,
  toGuestSpaceLanguage, type GuestInvite,
} from '@/lib/guestSpace';

export default function GuestInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { language: visitorLanguage } = useLanguage();
  const [invite, setInvite] = useState<GuestInvite | null>(null);
  const [problem, setProblem] = useState<'mismatch' | 'error' | null>(null);
  const redeeming = useRef(false);

  const lang = toGuestSpaceLanguage(invite?.language, toGuestSpaceLanguage(visitorLanguage));
  const w = useMemo(() => guestSpaceWords(lang), [lang]);
  const back = `/h/${token ?? ''}`;

  // L'état de l'invitation se lit une fois la session connue (« mine » dépend du compte).
  useEffect(() => {
    if (authLoading) return;
    if (!isGuestToken(token)) { setInvite({ state: 'not_found' }); return; }
    loadGuestInvite(token).then(setInvite).catch(() => setInvite({ state: 'not_found' }));
  }, [authLoading, token, user?.id]);

  useEffect(() => {
    if (!invite) return;
    if (invite.state === 'mine' && invite.pass_id) { navigate(guestSpacePath(invite.pass_id), { replace: true }); return; }
    if (invite.state !== 'valid' || !user || !token || redeeming.current) return;
    redeeming.current = true;
    redeemGuestInvite(token)
      .then((r) => navigate(guestSpacePath(r.pass_id), { replace: true }))
      .catch((err) => {
        const code = guestErrorCode(err);
        if (code === 'email_mismatch') setProblem('mismatch');
        else if (code === 'already_linked' || code === 'invite_expired') {
          redeeming.current = false;
          void loadGuestInvite(token).then(setInvite);
        } else setProblem('error');
      });
  }, [invite, user, token, navigate]);

  const authUrl = (signup: boolean) => {
    const q = new URLSearchParams({ redirect: back });
    if (invite?.invite_email) q.set('email', invite.invite_email);
    if (signup) q.set('signup', 'true');
    return `/auth?${q.toString()}`;
  };
  const switchAccount = () => {
    void supabase.auth.signOut({ scope: 'local' }).then(() => navigate(authUrl(false), { replace: true }));
  };

  const page: React.CSSProperties = { minHeight: '100dvh', background: 'var(--sf-000000, #000)', color: T1 };
  const org = invite?.inviter_name ?? '';
  const shell = (children: React.ReactNode) => (
    <div style={page} lang={lang}>
      <Seo title="Yuno" noindex />
      <div className="mx-auto max-w-[480px] px-4 py-10">
        <Wordmark height={20} tone="white" alt="Yuno" />
        {children}
      </div>
    </div>
  );
  const message = (title: string, body: string, action?: React.ReactNode) => shell(
    <>
      <h1 className="mt-10" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h1>
      <p className="mt-2" style={{ color: T2, fontSize: 14, lineHeight: 1.55 }}>{body}</p>
      {action && <div className="mt-5 flex flex-wrap gap-2">{action}</div>}
    </>,
  );

  if (!invite || (invite.state === 'valid' && user && !problem) || invite.state === 'mine') {
    return shell(
      <div className="mt-16 flex items-center gap-3" style={{ color: T3, fontSize: 13 }}>
        <Loader2 className="h-5 w-5 animate-spin" /> {invite && user ? w('guestSpace.invite.opening') : null}
      </div>,
    );
  }

  if (problem === 'mismatch') {
    return message(w('guestSpace.invite.mismatchTitle'),
      w('guestSpace.invite.mismatchBody', { email: invite.invite_email ?? '', current: user?.email ?? '' }),
      <OrgButton variant="primary" onClick={switchAccount}>{w('guestSpace.invite.switch')}</OrgButton>);
  }
  if (problem === 'error') {
    return message(w('guestSpace.state.errorTitle'), w('guestSpace.state.errorBody'),
      <OrgButton onClick={() => { setProblem(null); redeeming.current = false; setInvite({ ...invite }); }}>{w('guestSpace.state.retry')}</OrgButton>);
  }
  if (invite.state === 'taken') {
    return message(w('guestSpace.invite.takenTitle'), w('guestSpace.invite.takenBody', { org }),
      user ? <OrgButton onClick={switchAccount}>{w('guestSpace.invite.switch')}</OrgButton>
        : <OrgButton variant="primary" onClick={() => navigate(authUrl(false))}>{w('guestSpace.state.signIn')}</OrgButton>);
  }
  if (invite.state === 'expired') return message(w('guestSpace.invite.expiredTitle'), w('guestSpace.invite.expiredBody', { org }));
  if (invite.state === 'revoked') return message(w('guestSpace.invite.revokedTitle'), w('guestSpace.invite.revokedBody', { org }));
  if (invite.state === 'closed') return message(w('guestSpace.state.closedTitle'), w('guestSpace.state.closedBody', { event: invite.event_title ?? '' }));
  if (invite.state !== 'valid') return message(w('guestSpace.state.notFoundTitle'), w('guestSpace.invite.notFoundBody'));

  // Invitation valide, personne de connecté : on présente, puis compte.
  const when = invite.event_start_at
    ? new Intl.DateTimeFormat(guestSpaceLocale(lang), {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: invite.timezone || 'Europe/Paris',
    }).format(new Date(invite.event_start_at))
    : null;
  const place = [invite.location_name, invite.location_city].filter(Boolean).join(', ');
  return shell(
    <>
      <div className="mt-10 overflow-hidden rounded-[18px]" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
        {invite.poster_url && (
          <img src={invite.poster_url} alt="" className="block aspect-square w-full object-cover" />
        )}
        <div className="p-5">
          <div style={{ color: T3, fontSize: 11, fontWeight: 650, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{w('guestSpace.invite.kicker')}</div>
          <h1 className="mt-1.5" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            {w('guestSpace.invite.title', { inviter: org, guest: invite.guest_name ?? '', event: invite.event_title ?? '' })}
          </h1>
          {(when || place) && (
            <p className="mt-1.5" style={{ color: T2, fontSize: 13.5 }}>{[when, place].filter(Boolean).join(' · ')}</p>
          )}
          <p className="mt-3" style={{ color: T2, fontSize: 14, lineHeight: 1.55 }}>{w('guestSpace.invite.body')}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <OrgButton variant="primary" onClick={() => navigate(authUrl(true))}>{w('guestSpace.invite.create')}</OrgButton>
        <OrgButton onClick={() => navigate(authUrl(false))}>{w('guestSpace.invite.signIn')}</OrgButton>
      </div>
      {invite.invite_email && (
        <p className="mt-4" style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{w('guestSpace.invite.emailNote', { email: invite.invite_email })}</p>
      )}
      <p className="mt-2" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>{w('guestSpace.invite.simple')}</p>
    </>,
  );
}
