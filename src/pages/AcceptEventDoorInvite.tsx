/**
 * /accept-staff-invitation?door=<jeton> — accepter de tenir la porte d'UNE
 * soirée (staff du club invité, `event_door_staff`, migration 20261105230000).
 *
 * La personne n'a souvent pas de compte : l'edge `accept-staff-invitation`
 * (action `accept_event_door`) le crée sur l'adresse de l'invitation, ou sur
 * celle qu'elle donne quand l'invitation est partie par WhatsApp, pose le rôle
 * `bouncer` et la rattache à la seule soirée. Ensuite : mot de passe par email,
 * puis Yuno Pro et son code PIN, comme tout staff.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { guestSpaceWords, isGuestToken, toGuestSpaceLanguage } from '@/lib/guestSpace';

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

export default function AcceptEventDoorInvite() {
  const [params] = useSearchParams();
  const token = params.get('door');
  const { language } = useLanguage();
  const [inv, setInv] = useState<DoorInvite | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'created' | 'existing' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isGuestToken(token)) { setInv({ found: false }); return; }
    supabase.rpc('get_event_door_invite' as never, { p_token: token } as never)
      .then(({ data }) => setInv((data ?? { found: false }) as DoorInvite));
  }, [token]);

  const lang = toGuestSpaceLanguage(inv?.language, toGuestSpaceLanguage(language));
  const w = useMemo(() => guestSpaceWords(lang), [lang]);

  const accept = async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: fnError } = await invokeEdgeFunction<{ success?: boolean; account_created?: boolean; error?: string }>(
        'accept-staff-invitation', { body: { action: 'accept_event_door', token, email: email.trim() || undefined, language: lang } },
      );
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setDone(data?.account_created ? 'created' : 'existing');
    } catch (err) {
      const code = /([a-z_]+)$/.exec(String((err as Error)?.message ?? ''))?.[1] ?? 'generic';
      setError(code === 'email_mismatch' ? w('guestSpace.doorInvite.mismatch', { email: inv?.email_hint ?? '' })
        : code === 'event_closed' ? w('guestSpace.doorInvite.closed')
          : w(`guestSpace.err.${code}` as Parameters<typeof w>[0]) === `guestSpace.err.${code}` ? w('guestSpace.err.generic') : w(`guestSpace.err.${code}` as Parameters<typeof w>[0]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4" lang={lang}
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
      <Card className="w-full max-w-md p-6">
        {!inv ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !inv.found ? (
          <div className="py-4 text-center">
            <XCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <p className="font-semibold">{w('guestSpace.state.notFoundTitle')}</p>
          </div>
        ) : done ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />
            <p className="text-sm leading-relaxed">{done === 'created' ? w('guestSpace.doorInvite.done') : w('guestSpace.doorInvite.doneExisting')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><ScanLine className="h-5 w-5" /></span>
              <h1 className="text-lg font-semibold">{w('guestSpace.doorInvite.title', { event: inv.event_title ?? '' })}</h1>
            </div>
            <p className="text-sm text-muted-foreground">{w('guestSpace.doorInvite.body', { inviter: inv.inviter_name ?? 'Yuno' })}</p>
            {!inv.open ? (
              <p className="text-sm">{w('guestSpace.doorInvite.closed')}</p>
            ) : (
              <>
                {!inv.has_email && (
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={w('guestSpace.doorInvite.emailPh')} />
                )}
                {inv.has_email && inv.email_hint && <p className="text-xs text-muted-foreground">{inv.email_hint}</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="h-11 w-full" disabled={busy || (!inv.has_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))} onClick={() => void accept()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{w('guestSpace.doorInvite.accept')}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
