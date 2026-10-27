/**
 * /accept-staff-invitation?door=<jeton> — tenir la porte d'UNE soirée (staff
 * du club invité, `event_door_staff`, migration 20261105230000).
 *
 * Refait le 27/10 pour des gens qui n'ont jamais vu Yuno et qui travaillent ce
 * soir : dans Yuno Pro, la page demande un code envoyé à l'adresse de
 * l'invitation (le compte Yuno naît à ce moment s'il n'existe pas), la
 * personne le tape, elle est connectée à SON compte, l'invitation s'accepte et
 * l'app ouvre le scanner. Ni mot de passe, ni code PIN. Pour se reconnecter
 * plus tard : la même page, ou « Recevoir un code » sur la connexion de Yuno Pro.
 *
 * Dans un navigateur, la page dit d'abord d'installer Yuno Pro puis d'y ouvrir
 * l'invitation (schéma `yunopro://`, qui marche même si le lien universel
 * n'a pas ouvert l'app) ; le scan au navigateur reste possible.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StaffCodeSignIn } from '@/components/staff/StaffCodeSignIn';
import { guestSpaceWords, isGuestToken, toGuestSpaceLanguage } from '@/lib/guestSpace';
import { isProApp, openProApp } from '@/lib/native';

/** Yuno Pro sur l'App Store (eu.yunoapp.pro). */
const YUNO_PRO_APP_STORE_URL = 'https://apps.apple.com/app/id6800022179';

interface DoorInvite {
  found: boolean;
  status?: 'pending' | 'accepted';
  name?: string;
  has_email?: boolean;
  email_hint?: string | null;
  open?: boolean;
  event_title?: string;
  inviter_name?: string;
  language?: string;
}

const errorCode = (err: unknown) => /([a-z_]+)$/.exec(String((err as Error)?.message ?? ''))?.[1] ?? 'generic';

export default function AcceptEventDoorInvite() {
  const [params] = useSearchParams();
  const token = params.get('door');
  const { language } = useLanguage();
  const inPro = isProApp();
  const [inv, setInv] = useState<DoorInvite | null>(null);
  const [signedEmail, setSignedEmail] = useState<string | null | undefined>(undefined);
  const [webChosen, setWebChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isGuestToken(token)) { setInv({ found: false }); return; }
    supabase.rpc('get_event_door_invite' as never, { p_token: token } as never)
      .then(({ data }) => setInv((data ?? { found: false }) as DoorInvite));
    supabase.auth.getUser().then(({ data }) => setSignedEmail(data.user?.email ?? null));
  }, [token]);

  const lang = toGuestSpaceLanguage(inv?.language, toGuestSpaceLanguage(language));
  const w = useMemo(() => guestSpaceWords(lang), [lang]);

  const goScanner = () => {
    // Rechargement complet : les rôles de la session sont relus (le poste de
    // videur vient d'être posé), sinon la garde du scanner renverrait ailleurs.
    window.location.assign('/bouncer');
  };

  const accept = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: fnError } = await invokeEdgeFunction<{ success?: boolean; error?: string }>(
        'accept-staff-invitation', { body: { action: 'accept_event_door', token, language: lang } },
      );
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setDone(true);
      if (inPro) goScanner();
    } catch (err) {
      const code = errorCode(err);
      setError(code === 'email_mismatch' ? w('guestSpace.doorInvite.mismatch', { email: inv?.email_hint ?? '' })
        : code === 'event_closed' ? w('guestSpace.doorInvite.closed')
          : code === 'already_accepted' ? w('guestSpace.doorInvite.taken')
            : w('guestSpace.err.generic'));
    } finally {
      setBusy(false);
    }
  }, [token, lang, inPro, w, inv?.email_hint]);

  const requestCode = async (email: string) => {
    const { data, error: fnError } = await invokeEdgeFunction<{ success?: boolean; email?: string; error?: string }>(
      'accept-staff-invitation', { body: { action: 'accept_event_door', step: 'send_code', token, email: email || undefined, language: lang } },
    );
    if (fnError) return { error: errorCode(fnError) };
    if (data?.error || !data?.email) return { error: data?.error ?? 'generic' };
    return { email: data.email };
  };

  const switchAccount = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    setSignedEmail(null);
    setError(null);
  };

  // Dans un navigateur, l'app d'abord ; le scan au navigateur reste un choix.
  const showAppFirst = !inPro && !webChosen && !done;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4" lang={lang}
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
      <Card className="w-full max-w-md p-6">
        {!inv || signedEmail === undefined ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !inv.found ? (
          <div className="py-4 text-center">
            <XCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <p className="font-semibold">{w('guestSpace.state.notFoundTitle')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary/10 text-primary"><ScanLine className="h-5 w-5" /></span>
              <h1 className="text-lg font-semibold">{w('guestSpace.doorInvite.title', { event: inv.event_title ?? '' })}</h1>
            </div>
            <p className="text-sm text-muted-foreground">{w('guestSpace.doorInvite.body', { inviter: inv.inviter_name ?? 'Yuno' })}</p>

            {!inv.open ? (
              <p className="text-sm">{w('guestSpace.doorInvite.closed')}</p>
            ) : done ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
                <p className="text-sm leading-relaxed">{w('guestSpace.doorInvite.ready')}</p>
                <Button className="h-12 w-full text-base" onClick={goScanner}>{w('guestSpace.doorInvite.openScanner')}</Button>
                {!inPro && (
                  <Button variant="secondary" className="h-12 w-full text-base" onClick={() => openProApp('/bouncer')}>
                    {w('guestSpace.doorInvite.openInApp').replace(/^\d\.\s*/, '')}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">{w('guestSpace.doorInvite.later')}</p>
              </div>
            ) : showAppFirst ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">{w('guestSpace.doorInvite.needApp')}</p>
                <Button asChild className="h-12 w-full text-base">
                  <a href={YUNO_PRO_APP_STORE_URL} target="_blank" rel="noreferrer">{w('guestSpace.doorInvite.getApp')}</a>
                </Button>
                <Button variant="secondary" className="h-12 w-full text-base"
                  onClick={() => openProApp(`/accept-staff-invitation?door=${token}`)}>
                  {w('guestSpace.doorInvite.openInApp')}
                </Button>
                <button type="button" className="w-full pt-1 text-center text-sm text-muted-foreground underline" onClick={() => setWebChosen(true)}>
                  {w('guestSpace.doorInvite.continueWeb')}
                </button>
              </div>
            ) : signedEmail ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{w('guestSpace.doorInvite.signedAs', { email: signedEmail })}</p>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="h-12 w-full text-base" disabled={busy} onClick={() => void accept()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{w('guestSpace.doorInvite.accept')}
                </Button>
                <button type="button" className="w-full text-center text-sm text-muted-foreground underline" onClick={() => void switchAccount()}>
                  {w('guestSpace.doorInvite.switchAccount')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">{w('guestSpace.doorInvite.signIn')}</p>
                <StaffCodeSignIn
                  lang={lang}
                  fixedEmailHint={inv.has_email ? (inv.email_hint ?? null) : null}
                  requestCode={requestCode}
                  onSignedIn={async () => {
                    const { data } = await supabase.auth.getUser();
                    setSignedEmail(data.user?.email ?? null);
                    await accept();
                  }}
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
