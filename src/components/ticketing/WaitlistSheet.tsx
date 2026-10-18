import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { capturePosthog } from '@/lib/posthog';
import { marketProps } from '@/lib/geo';
import { recordConsentGrant } from '@/hooks/useMarketingConsent';

/**
 * Inscription à la liste privée, en fenêtre sur la page soirée : la personne ne
 * quitte jamais l'affiche. Prénom, nom, e-mail, un bouton, une phrase d'accord
 * qui nomme le destinataire. Connecté avec un prénom : un seul bouton.
 *
 * Ce que reçoit la base : `first_name`, `last_name`, `full_name`,
 * `newsletter_opt_in` ; le trigger `auto_subscribe_event_waitlist` verse la
 * personne au registre du club (sinon de l'organisateur) → CRM. La preuve du
 * texte affiché part avec `recordConsentGrant` (source `waitlist`).
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const waitlistJoinedKey = (eventId: string) => `yuno:waitlist:${eventId}`;

interface Props {
  eventId: string;
  eventTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inscription faite (ou déjà existante) : la page soirée met son état à jour. */
  onJoined?: () => void;
  /** Déjà sur la liste (lu par la page soirée) : la fenêtre montre la confirmation. */
  alreadyJoined?: boolean;
}

type Scope = { venueId: string | null; organizerUserId: string | null; name: string };

export function WaitlistSheet({ eventId, eventTitle, open, onOpenChange, onJoined, alreadyJoined }: Props) {
  const { t, language } = useLanguage();
  const [scope, setScope] = useState<Scope | null>(null);
  const [market, setMarket] = useState<Record<string, string>>({});
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [other, setOther] = useState(false);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  const loadedFor = useRef<string | null>(null);

  // Lecture au premier affichage : destinataire de l'accord (club, sinon
  // organisateur — MIROIR du trigger) et compte éventuel.
  useEffect(() => {
    if (!open || loadedFor.current === eventId) return;
    loadedFor.current = eventId;
    let cancelled = false;
    (async () => {
      try {
        const { data: ev } = await supabase
          .from('events')
          .select('timezone, location_city, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
          .eq('id', eventId)
          .single();
        if (!ev || cancelled) return;
        setMarket(marketProps({ timezone: ev.timezone, city: ev.location_city, eventId, venueId: ev.venue_id, organizerUserId: ev.organizer_user_id }));
        const venueId = ev.venue_id ?? ev.partner_venue_id;
        const orgId = ev.organizer_user_id ?? ev.partner_organizer_id;
        if (venueId) {
          const { data } = await supabase.from('venues').select('name').eq('id', venueId).maybeSingle();
          if (data?.name && !cancelled) setScope({ venueId, organizerUserId: null, name: data.name });
        } else if (orgId) {
          const { data } = await supabase.from('organizer_profiles').select('display_name').eq('user_id', orgId).maybeSingle();
          if (data?.display_name && !cancelled) setScope({ venueId: null, organizerUserId: orgId, name: data.display_name });
        }
      } catch { /* sans nom, pas d'accord marketing : la liste reste utilisable */ }
    })();
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u || cancelled) return;
      const { data: p } = await supabase.from('profiles').select('first_name, last_name').eq('id', u.id).maybeSingle();
      if (cancelled) return;
      setUser({ id: u.id, email: u.email || '' });
      setFirstName(p?.first_name || '');
      setLastName(p?.last_name || '');
      setEmail(u.email || '');
    })();
    return () => { cancelled = true; };
  }, [open, eventId]);

  let storedEmail = '';
  try { storedEmail = localStorage.getItem(waitlistJoinedKey(eventId)) || ''; } catch { /* sans stockage */ }
  const shownDone = doneEmail ?? (alreadyJoined ? (storedEmail || user?.email || '') : null);

  const oneTap = !!user && !other && !!firstName.trim();

  const join = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const mail = (oneTap ? user!.email : email).trim().toLowerCase();
    setTried(true);
    if (!first) { toast.error(t('waitlist.p.needFirstName')); return; }
    if (!EMAIL_RE.test(mail)) { toast.error(t('waitlist.invalidEmail')); return; }

    const accountId = user && mail === user.email.toLowerCase() ? user.id : null;
    const consent = !!scope;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('event_waitlist').insert({
        event_id: eventId,
        email: mail,
        first_name: first,
        last_name: last || null,
        full_name: [first, last].filter(Boolean).join(' '),
        user_id: accountId,
        show_in_orders: !!accountId,
        newsletter_opt_in: consent,
      });
      if (error && error.code !== '23505') throw error;

      try { localStorage.setItem(waitlistJoinedKey(eventId), mail); } catch { /* sans stockage */ }
      setDoneEmail(mail);
      onJoined?.();
      if (error) return; // déjà inscrit : rien d'autre à écrire

      capturePosthog('waitlist_joined', { pillar: 'tickets', has_account: !!accountId, ...marketProps({ eventId }), ...market });
      if (consent && scope) {
        void recordConsentGrant({
          channel: 'email',
          wordingText: t('waitlist.p.consent').replace('{{name}}', scope.name),
          wordingKey: 'waitlist.p.consent',
          venueId: scope.venueId,
          organizerUserId: scope.organizerUserId,
          email: mail,
          locale: language,
          source: 'waitlist',
        });
      }
      supabase.functions.invoke('notify-event-waitlist', { body: { eventId, type: 'confirmation', email: mail } }).catch(() => {});
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'h-[52px] w-full rounded-[4px] border bg-transparent px-4 text-base text-white outline-none transition-colors placeholder:text-[var(--tx-5a5a5e)] focus:border-primary';
  const inputStyle = (invalid: boolean) => ({
    borderColor: invalid ? 'hsl(var(--primary))' : 'rgb(var(--ink)/0.14)',
    background: 'rgb(var(--ink)/0.04)',
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="z-[200] mx-auto max-w-md border-0 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="px-5 pb-2 pt-5">
          {shownDone !== null ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/40">
                <Check className="h-7 w-7 text-primary" strokeWidth={2.5} />
              </div>
              <DrawerTitle className="font-display text-[24px] font-bold tracking-[-0.03em] text-white">
                {t('waitlist.p.doneTitle')}
              </DrawerTitle>
              <DrawerDescription className="mt-2 text-[14px]" style={{ color: 'var(--tx-9a9a9a)' }}>
                {t('waitlist.p.doneSub').replace('{{email}}', shownDone || '…')}
              </DrawerDescription>
              <button
                onClick={() => onOpenChange(false)}
                className="mt-6 h-[50px] w-full rounded-[4px] border font-display text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
                style={{ borderColor: 'rgb(var(--ink)/0.14)' }}
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void join(); }} noValidate className="space-y-3">
              <div className="pb-1">
                <p className="mb-1 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  {t('waitlist.p.kicker')}
                </p>
                <DrawerTitle className="font-display text-[24px] font-bold leading-[1.05] tracking-[-0.03em] text-white">
                  {t('waitlist.p.headline')}
                </DrawerTitle>
                <DrawerDescription className="mt-1.5 line-clamp-1 text-[13px]" style={{ color: 'var(--tx-9a9a9a)' }}>
                  {eventTitle}
                </DrawerDescription>
              </div>

              {oneTap ? (
                <div className="flex items-center gap-3 rounded-[4px] border p-3.5" style={{ borderColor: 'rgb(var(--ink)/0.14)', background: 'rgb(var(--ink)/0.04)' }}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-[14px] font-bold text-primary">
                    {(firstName[0] || '').toUpperCase()}{(lastName[0] || '').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-display text-[15px] font-semibold text-white">{[firstName, lastName].filter(Boolean).join(' ')}</p>
                    <p className="truncate text-[13px]" style={{ color: 'var(--tx-9a9a9a)' }}>{user!.email}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text" autoComplete="given-name" enterKeyHint="next" maxLength={100}
                      aria-label={t('waitlist.p.firstName')} placeholder={t('waitlist.p.firstName')}
                      value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      className={inputCls} style={inputStyle(tried && !firstName.trim())}
                    />
                    <input
                      type="text" autoComplete="family-name" enterKeyHint="next" maxLength={100}
                      aria-label={t('waitlist.p.lastName')} placeholder={t('waitlist.p.lastName')}
                      value={lastName} onChange={(e) => setLastName(e.target.value)}
                      className={inputCls} style={inputStyle(false)}
                    />
                  </div>
                  <input
                    type="email" inputMode="email" autoComplete="email" autoCapitalize="none" enterKeyHint="go" maxLength={254}
                    aria-label={t('waitlist.p.email')} placeholder={t('waitlist.p.email')}
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    className={inputCls} style={inputStyle(tried && !EMAIL_RE.test(email.trim()))}
                  />
                </>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-[54px] w-full items-center justify-center rounded-[4px] bg-primary font-display text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-70"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t('waitlist.p.cta')}
              </button>

              <p className="text-center text-[11px] leading-snug" style={{ color: 'var(--tx-5a5a5e)' }}>
                {scope ? t('waitlist.p.consent').replace('{{name}}', scope.name) : t('waitlist.p.consentGeneric')}
              </p>

              {oneTap && (
                <button
                  type="button"
                  onClick={() => { setOther(true); setEmail(''); setFirstName(''); setLastName(''); }}
                  className="block w-full text-center text-[12.5px]"
                  style={{ color: 'var(--tx-9a9a9a)' }}
                >
                  {t('waitlist.p.notYou')}
                </button>
              )}
            </form>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
