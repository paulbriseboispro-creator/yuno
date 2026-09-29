import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { invalidateOrgMemberships, rememberActingOrganizer } from '@/hooks/useActingOrganizer';
import {
  getCohostEmailInvite, acceptCohostEmailInvite, declineCohostEmailInvite, coorgErrorCode,
  type CohostEmailInviteView,
} from '@/lib/coorg';
import { useCoorgErrorText } from '@/components/coorg/coorgUi';
import { capturePosthog } from '@/lib/posthog';

/**
 * Invitation à CO-ORGANISER une soirée, reçue par email par une structure qui
 * n'avait pas (forcément) de compte Yuno. DA publique : la personne sort de sa
 * boîte mail, elle n'est pas encore dans un dashboard.
 *
 * Trois cas : pas connecté (créer un compte avec CETTE adresse, ou se
 * connecter), connecté avec une autre adresse (changer de compte), connecté
 * avec la bonne (choisir au titre de quelle structure, puis rejoindre).
 * Toute règle vit dans `accept_cohost_email_invite` ; cette page ne décide rien.
 */

const BLACK = '#0A0A0A';
const CARD = '#141414';
const RED = '#E8192C';
const WHITE = '#FFFFFF';
const GRAY_1 = '#E5E5E5';
const GRAY_2 = '#9A9A9A';
const BORDER = 'rgba(255,255,255,0.08)';

const PAGE = 'min-h-[100dvh] flex items-center justify-center px-5';
const PAGE_SAFE = {
  background: BLACK,
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
};

function Panel({ children }: { children: React.ReactNode }) {
  return <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '22px 20px' }}>{children}</div>;
}

export default function AcceptCohostInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const errText = useCoorgErrorText();
  const [inv, setInv] = useState<CohostEmailInviteView | null>(null);
  const [loading, setLoading] = useState(true);
  const [party, setParty] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      const v = await getCohostEmailInvite(token);
      setInv(v);
      const first = v.options?.[0]?.party;
      setParty((p) => p || first || '');
    } catch {
      setInv(null);
    } finally {
      setLoading(false);
    }
  }, [token]);
  // Relire quand la session change (connexion depuis cette page).
  useEffect(() => { if (!authLoading) void load(); }, [load, authLoading, user?.id]);

  const here = `/accept-cohost?token=${encodeURIComponent(token)}`;
  const authUrl = (signup: boolean) =>
    `/auth?${signup ? 'signup=true&' : ''}email=${encodeURIComponent(inv?.email ?? '')}&redirect=${encodeURIComponent(here)}`;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await acceptCohostEmailInvite(token, party || null);
      if (!r?.ok) throw new Error(r?.reason ?? 'error');
      capturePosthog('coorg_cohost_responded', { event_id: r.event_id, accepted: true, via: 'email' });
      const key = r.party ?? party;
      invalidateOrgMemberships();
      if (key.startsWith('org:')) rememberActingOrganizer(key.slice(4));
      // Rechargement complet : la session en mémoire n'a pas encore le rôle
      // organisateur ni l'appartenance, une garde renverrait sur l'accueil.
      window.location.assign(key.startsWith('venue:') ? `/owner/coorg/${r.event_id}` : `/organizer-app/coorg/${r.event_id}`);
    } catch (err) {
      setError(errText(coorgErrorCode(err)));
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await declineCohostEmailInvite(token);
      setDeclined(true);
    } catch (err) {
      setError(errText(coorgErrorCode(err)));
    } finally {
      setBusy(false);
    }
  };

  const signOutAndStay = async () => {
    setBusy(true);
    // Local seulement : jamais couper les autres sessions du compte.
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* session déjà morte */ }
    window.location.reload();
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });

  if (loading || authLoading) {
    return <div className={PAGE} style={PAGE_SAFE}><Loader2 className="h-6 w-6 animate-spin" style={{ color: GRAY_2 }} /></div>;
  }

  const outcome = (ok: boolean, body: string) => (
    <div className={PAGE} style={PAGE_SAFE}>
      <div className="w-full" style={{ maxWidth: 440 }}>
        <Panel>
          {ok
            ? <CheckCircle2 className="h-11 w-11 mb-5" style={{ color: '#22C55E' }} aria-hidden="true" />
            : <XCircle className="h-11 w-11 mb-5" style={{ color: RED }} aria-hidden="true" />}
          <p style={{ color: GRAY_1, fontSize: 15, lineHeight: 1.6 }}>{body}</p>
          <button className="btn btn--ghost w-full mt-6" onClick={() => navigate('/')}>{t('Retour à l’accueil', 'Back to home', 'Volver al inicio')}</button>
        </Panel>
      </div>
    </div>
  );

  if (!inv?.ok || !inv.event) return outcome(false, t('Ce lien d’invitation n’existe pas ou plus.', 'This invitation link does not exist anymore.', 'Este enlace de invitación ya no existe.'));
  if (declined || inv.status === 'declined') return outcome(true, t('Invitation déclinée. L’organisateur en est informé.', 'Invitation declined. The organizer has been told.', 'Invitación rechazada. El organizador ha sido avisado.'));
  if (inv.status === 'accepted') return outcome(true, t('Cette invitation est déjà acceptée : la soirée t’attend dans ta Console.', 'This invitation was already accepted: the event is waiting in your Console.', 'Esta invitación ya fue aceptada: el evento te espera en tu Consola.'));
  if (inv.status === 'cancelled') return outcome(false, t('Cette invitation a été annulée par la personne qui l’a envoyée.', 'This invitation was cancelled by its sender.', 'Esta invitación fue cancelada por quien la envió.'));
  if (inv.status === 'expired') return outcome(false, t('Cette invitation est expirée. Demande un nouveau lien à l’organisateur.', 'This invitation has expired. Ask the organizer for a new link.', 'Esta invitación ha caducado. Pide un nuevo enlace al organizador.'));
  if (inv.event.closed) return outcome(false, t('La soirée est terminée ou annulée.', 'The event is over or cancelled.', 'El evento terminó o fue cancelado.'));

  const options = inv.options ?? [];
  return (
    <div className={PAGE} style={PAGE_SAFE}>
      <div className="w-full" style={{ maxWidth: 460 }}>
        <header className="mb-7">
          <p className="section-label-ruled mb-4">{t('Invitation à co-organiser', 'Co-organization invitation', 'Invitación a coorganizar')}</p>
          <h1 className="font-display uppercase" style={{ color: WHITE, fontSize: 'clamp(30px, 8vw, 44px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 0.95, wordBreak: 'break-word' }}>
            {inv.event.title}
          </h1>
          <p className="font-mono uppercase mt-4" style={{ color: GRAY_2, fontSize: 11, letterSpacing: '0.1em' }}>
            {fmtDate(inv.event.start_at)}{inv.event.venue_name ? ` · ${inv.event.venue_name}` : ''}{inv.event.city ? ` · ${inv.event.city}` : ''}
          </p>
        </header>

        <Panel>
          <p style={{ color: GRAY_1, fontSize: 15, lineHeight: 1.6 }}>
            {t(
              `${inv.inviter_name ?? 'Un organisateur'} t’invite à co-organiser cette soirée sur Yuno : elle apparaîtra dans ta Console, avec tes propres liens (lien direct, Instagram, WhatsApp…), tes ventes et tes emails à ta base. L’argent se règle entre vous, ou par un accord Yuno si vous le choisissez.`,
              `${inv.inviter_name ?? 'An organizer'} invites you to co-organize this event on Yuno: it will appear in your Console, with your own links (direct link, Instagram, WhatsApp…), your sales and your emails to your list. Money is settled between you, or through a Yuno agreement if you choose.`,
              `${inv.inviter_name ?? 'Un organizador'} te invita a coorganizar este evento en Yuno: aparecerá en tu Consola, con tus propios enlaces (enlace directo, Instagram, WhatsApp…), tus ventas y tus emails a tu base. El dinero lo arregláis entre vosotros, o con un acuerdo Yuno si lo elegís.`,
            )}
          </p>
          {inv.message && <p className="mt-3" style={{ color: GRAY_2, fontSize: 14, fontStyle: 'italic' }}>« {inv.message} »</p>}
          <div className="mt-5" style={{ border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4, padding: '14px 16px', background: 'rgba(232,25,44,0.04)' }}>
            <p className="font-mono uppercase" style={{ fontSize: 9, color: RED, letterSpacing: '0.14em', fontWeight: 600 }}>
              {inv.access === 'editor' ? t('Co-gestion', 'Co-manager', 'Cogestión') : t('Partenaire', 'Partner', 'Socio')}
            </p>
            <p className="font-mono" style={{ fontSize: 11, color: GRAY_2, marginTop: 8, wordBreak: 'break-all' }}>{inv.email}</p>
          </div>

          {!user ? (
            <>
              <p className="mt-5" style={{ color: GRAY_2, fontSize: 13.5, lineHeight: 1.55 }}>
                {t(
                  'Crée ton compte gratuit avec cette adresse email (2 minutes), ou connecte-toi si tu en as déjà un. Aucun compte Stripe exigé.',
                  'Create your free account with this email address (2 minutes), or sign in if you already have one. No Stripe account required.',
                  'Crea tu cuenta gratuita con esta dirección de email (2 minutos), o inicia sesión si ya tienes una. Sin cuenta de Stripe.',
                )}
              </p>
              <button className="btn btn--primary w-full mt-5" onClick={() => navigate(authUrl(true))}>{t('Créer mon compte', 'Create my account', 'Crear mi cuenta')}</button>
              <button className="btn btn--ghost w-full mt-3" onClick={() => navigate(authUrl(false))}>{t('J’ai déjà un compte', 'I already have an account', 'Ya tengo una cuenta')}</button>
            </>
          ) : !inv.email_matches ? (
            <>
              <p className="mt-5" style={{ color: GRAY_1, fontSize: 14, lineHeight: 1.55 }}>
                {t(
                  `Tu es connecté avec ${user.email}. Cette invitation est réservée à ${inv.email} : change de compte pour l’accepter.`,
                  `You are signed in as ${user.email}. This invitation is for ${inv.email}: switch account to accept it.`,
                  `Has iniciado sesión como ${user.email}. Esta invitación es para ${inv.email}: cambia de cuenta para aceptarla.`,
                )}
              </p>
              <button className="btn btn--primary w-full mt-5" onClick={signOutAndStay} disabled={busy}>{t('Changer de compte', 'Switch account', 'Cambiar de cuenta')}</button>
            </>
          ) : (
            <>
              {options.length > 1 && (
                <fieldset className="mt-5 space-y-2">
                  <legend className="font-mono uppercase mb-2" style={{ fontSize: 9.5, color: GRAY_2, letterSpacing: '0.12em' }}>
                    {t('Rejoindre au nom de', 'Join as', 'Unirse como')}
                  </legend>
                  {options.map((o) => (
                    <label key={o.party} className="flex cursor-pointer items-center gap-3" style={{ border: `1px solid ${party === o.party ? RED : BORDER}`, borderRadius: 4, padding: '10px 12px' }}>
                      <input type="radio" name="party" checked={party === o.party} onChange={() => setParty(o.party)} />
                      <span style={{ color: WHITE, fontSize: 14 }}>{o.name}</span>
                      <span className="ml-auto font-mono uppercase" style={{ color: GRAY_2, fontSize: 9.5, letterSpacing: '0.1em' }}>
                        {o.kind === 'venue' ? t('Club', 'Club', 'Club') : o.exists ? t('Organisateur', 'Organizer', 'Organizador') : t('Espace à créer', 'New space', 'Espacio nuevo')}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {options.length === 1 && !options[0].exists && (
                <p className="mt-5" style={{ color: GRAY_2, fontSize: 13.5, lineHeight: 1.55 }}>
                  {t(
                    `Ton espace organisateur « ${options[0].name} » sera créé en rejoignant la soirée.`,
                    `Your organizer space "${options[0].name}" will be created when you join the event.`,
                    `Tu espacio de organizador «${options[0].name}» se creará al unirte al evento.`,
                  )}
                </p>
              )}
              <button className="btn btn--primary w-full mt-5" onClick={accept} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Rejoindre la soirée', 'Join the event', 'Unirme al evento')}
              </button>
              <button className="btn btn--ghost w-full mt-3" onClick={decline} disabled={busy}>{t('Décliner', 'Decline', 'Rechazar')}</button>
            </>
          )}
          {error && <p className="mt-4" style={{ color: RED, fontSize: 13.5 }}>{error}</p>}
        </Panel>
      </div>
    </div>
  );
}
