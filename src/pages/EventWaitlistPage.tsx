import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEventRoute } from '@/hooks/useEventRoute';
import { ArrowLeft, BellRing, Zap, ShieldCheck, Check, Loader2, Share2, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { capturePosthog } from '@/lib/posthog';
import { marketProps } from '@/lib/geo';
import { recordConsentGrant } from '@/hooks/useMarketingConsent';
import { motion, useReducedMotion } from 'framer-motion';
import { PublicPage } from '@/components/PublicPage';
import { EventWaitlistSkeleton } from '@/components/skeletons/EventWaitlistSkeleton';

/**
 * Liste privée d'une soirée — « Rejoindre la liste », sans compte.
 *
 * Une seule colonne, dans la langue de la page soirée : l'affiche et le titre
 * rappellent POUR QUOI on s'inscrit, trois champs (prénom, nom, e-mail) pour
 * s'inscrire, une phrase de consentement qui NOMME le destinataire. Un compte
 * Yuno n'est jamais demandé : connecté, c'est un seul bouton.
 *
 * Ce que la base reçoit (migration 20261017220000) : `first_name`, `last_name`,
 * `full_name` et `newsletter_opt_in`. Le trigger `auto_subscribe_event_waitlist`
 * verse la personne dans le registre du club (sinon de l'organisateur), d'où
 * elle apparaît dans le CRM avec prénom, nom et e-mail. La preuve du texte
 * affiché est écrite à côté (`recordConsentGrant`, source `waitlist`).
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const joinedKey = (eventId: string) => `yuno:waitlist:${eventId}`;

type ConsentScope = { venueId: string | null; organizerUserId: string | null; name: string };

interface EventSummary {
  title: string;
  startAt: string | null;
  timezone: string;
  place: string;
  poster: string | null;
}

export default function EventWaitlistPage() {
  // `resolving` : sur une URL propre /events/:host/:slug, l'id de la soirée
  // n'est connu qu'après une résolution serveur. Conclure pendant ce temps
  // affichait « Événement introuvable » à qui arrive par un lien de partage.
  const { eventId, basePath, resolving } = useEventRoute();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();

  // La fiche soirée garde son bundle 5 minutes en cache : sans cette
  // invalidation, qui vient de s'inscrire revoyait « Être notifié ».
  const markEventStale = () => {
    if (eventId) queryClient.invalidateQueries({ queryKey: ['event-details', eventId] });
  };

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [joinedEmail, setJoinedEmail] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [consentScope, setConsentScope] = useState<ConsentScope | null>(null);
  // Marché de la soirée (analytics), lu avec le titre.
  const [eventMarket, setEventMarket] = useState<Record<string, string>>({});

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  // Connecté mais « ce n'est pas moi » : le formulaire complet revient.
  const [useOther, setUseOther] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  useEffect(() => {
    // Sans id résolu il n'y a rien à charger : on attend plutôt que d'aller
    // interroger la base avec `undefined`.
    if (eventId) void fetchData();
    else if (!resolving) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, resolving]);

  const fetchData = async () => {
    try {
      const { data: ev } = await supabase
        .from('events')
        .select('title, start_at, timezone, location_name, location_city, poster_url, image_url, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
        .eq('id', eventId!)
        .single();

      if (ev) {
        setEvent({
          title: ev.title,
          startAt: ev.start_at,
          timezone: ev.timezone || 'Europe/Paris',
          place: [ev.location_name, ev.location_city].filter(Boolean).join(' · '),
          poster: ev.poster_url || ev.image_url || null,
        });
        setEventMarket(marketProps({
          timezone: ev.timezone,
          city: ev.location_city,
          eventId: eventId!,
          venueId: ev.venue_id,
          organizerUserId: ev.organizer_user_id,
        }));

        // Destinataire de l'accord marketing : le club, sinon l'organisateur.
        // MIROIR EXACT du trigger auto_subscribe_event_waitlist — la phrase
        // nomme qui recevra vraiment la personne.
        const hostVenueId = ev.venue_id ?? ev.partner_venue_id;
        const hostOrganizerId = ev.organizer_user_id ?? ev.partner_organizer_id;
        try {
          if (hostVenueId) {
            const { data: venue } = await supabase.from('venues').select('name').eq('id', hostVenueId).maybeSingle();
            if (venue?.name) setConsentScope({ venueId: hostVenueId, organizerUserId: null, name: venue.name });
          } else if (hostOrganizerId) {
            const { data: org } = await supabase.from('organizer_profiles').select('display_name').eq('user_id', hostOrganizerId).maybeSingle();
            if (org?.display_name) setConsentScope({ venueId: null, organizerUserId: hostOrganizerId, name: org.display_name });
          }
        } catch { /* sans nom, pas d'accord marketing : la liste reste utilisable */ }
      }

      // Déjà inscrit sur cet appareil (invité) : la page le dit au lieu de
      // reproposer le formulaire.
      try {
        const saved = localStorage.getItem(joinedKey(eventId!));
        if (saved) { setJoinedEmail(saved); setRegistered(true); }
      } catch { /* Safari sans stockage */ }

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', authUser.id)
          .maybeSingle();

        setUser({ id: authUser.id, email: authUser.email || '' });
        setFirstName(profile?.first_name || '');
        setLastName(profile?.last_name || '');
        setEmail(authUser.email || '');

        // Déjà inscrit (par compte OU par e-mail)
        const normalizedEmail = authUser.email?.toLowerCase().trim();
        const filters = [`user_id.eq.${authUser.id}`];
        if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);
        const { data: existing } = await supabase
          .from('event_waitlist')
          .select('id, user_id')
          .eq('event_id', eventId!)
          .or(filters.join(','))
          .maybeSingle();

        if (existing) {
          // Rattache le compte à une inscription faite avant la connexion.
          if (!existing.user_id) {
            await supabase.from('event_waitlist').update({ user_id: authUser.id }).eq('id', existing.id);
          }
          setJoinedEmail(authUser.email || '');
          setRegistered(true);
          markEventStale();
          await loadPosition();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadPosition = async () => {
    const { count } = await supabase
      .from('event_waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId!);
    // Un invité ne lit pas la table : 0 = non lisible, pas « personne ».
    setPosition(count && count > 0 ? count : null);
  };

  const oneTap = !!user && !useOther && !!firstName.trim();

  const join = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const mail = (oneTap ? user!.email : email).trim().toLowerCase();

    setTriedSubmit(true);
    if (!first) { toast.error(t('waitlist.p.needFirstName')); return; }
    if (!EMAIL_RE.test(mail)) { toast.error(t('waitlist.invalidEmail')); return; }

    const accountId = user && mail === user.email.toLowerCase() ? user.id : null;
    // L'accord n'est demandé qu'à un destinataire NOMMÉ (EDPB 05/2020 §65).
    const consent = !!consentScope;

    setSubmitting(true);
    try {
      const { error } = await supabase.from('event_waitlist').insert({
        event_id: eventId!,
        email: mail,
        first_name: first,
        last_name: last || null,
        full_name: [first, last].filter(Boolean).join(' '),
        user_id: accountId,
        // Une personne connectée retrouve la soirée dans « Mes commandes ».
        show_in_orders: !!accountId,
        newsletter_opt_in: consent,
      });

      if (error && error.code !== '23505') throw error;

      const already = error?.code === '23505';
      setJoinedEmail(mail);
      setRegistered(true);
      markEventStale();
      try { localStorage.setItem(joinedKey(eventId!), mail); } catch { /* sans stockage */ }
      if (already) {
        toast.info(t('waitlist.alreadyRegistered'));
        return;
      }

      if (accountId) await loadPosition();
      capturePosthog('waitlist_joined', { pillar: 'tickets', has_account: !!accountId, ...marketProps({ eventId }), ...eventMarket });

      // Preuve du texte exact affiché (art. 7(1) RGPD), jamais bloquante.
      if (consent && consentScope) {
        void recordConsentGrant({
          channel: 'email',
          wordingText: t('waitlist.p.consent').replace('{{name}}', consentScope.name),
          wordingKey: 'waitlist.p.consent',
          venueId: consentScope.venueId,
          organizerUserId: consentScope.organizerUserId,
          email: mail,
          locale: language,
          source: 'waitlist',
        });
      }

      // Confirmation par e-mail (fire-and-forget)
      supabase.functions.invoke('notify-event-waitlist', {
        body: { eventId, type: 'confirmation', email: mail },
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const dateLabel = useMemo(() => {
    if (!event?.startAt) return '';
    try {
      return new Intl.DateTimeFormat(language, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: event.timezone,
      }).format(new Date(event.startAt));
    } catch { return ''; }
  }, [event, language]);

  const share = async () => {
    const url = `${window.location.origin}${basePath}`;
    const text = t('waitlist.p.shareText').replace('{{event}}', event?.title ?? '');
    try {
      if (navigator.share) await navigator.share({ title: event?.title, text, url });
      else { await navigator.clipboard.writeText(url); toast.success('✓'); }
    } catch { /* partage annulé */ }
  };

  if (loading || resolving) return <EventWaitlistSkeleton />;

  const rise = (delay = 0) => reduced
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay, ease: [0.23, 1, 0.32, 1] as const } };

  const backBtn = (
    <button
      onClick={() => navigate(-1)}
      aria-label={t('common.back')}
      className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-transform active:scale-95"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );

  // Halo : l'affiche floutée, fondue dans le fond de la page.
  const halo = (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden" aria-hidden>
      {event?.poster && (
        <img src={event.poster} alt="" className="h-full w-full scale-125 object-cover opacity-40 blur-3xl" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/60 to-background" />
    </div>
  );

  const eventHeader = (
    <div className="flex items-center gap-4">
      {event?.poster && (
        <img
          src={event.poster}
          alt=""
          className="h-[104px] w-[84px] shrink-0 rounded-[4px] object-cover"
          style={{ boxShadow: '0 12px 32px -8px rgba(0,0,0,0.7), 0 0 0 1px rgb(var(--ink)/0.10)' }}
        />
      )}
      <div className="min-w-0">
        <p className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          {t('waitlist.p.kicker')}
        </p>
        <h2 className="font-display text-[19px] font-bold leading-[1.1] tracking-[-0.02em] text-white line-clamp-2">
          {event?.title}
        </h2>
        {(dateLabel || event?.place) && (
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--tx-9a9a9a)' }}>
            {[dateLabel, event?.place].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );

  // ── Inscrit ────────────────────────────────────────────────────────────────
  if (registered) {
    return (
      <div className="relative min-h-screen bg-background">
        {halo}
        {backBtn}
        <PublicPage variant="flow">
          <div className="relative mx-auto flex max-w-md flex-col items-center px-6 pt-[22vh] text-center">
            <motion.div
              initial={reduced ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className="mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/40"
            >
              <Check className="h-8 w-8 text-primary" strokeWidth={2.5} />
            </motion.div>
            <motion.h1 {...rise(0.1)} className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-white">
              {t('waitlist.p.doneTitle')}
            </motion.h1>
            <motion.p {...rise(0.16)} className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--tx-9a9a9a)' }}>
              {t('waitlist.p.doneSub').replace('{{email}}', joinedEmail || '…')}
            </motion.p>
            {position && (
              <motion.p {...rise(0.2)} className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--tx-9a9a9a)' }}>
                {t('waitlist.position')} <span className="font-bold text-white">#{position}</span>
              </motion.p>
            )}
            <motion.div {...rise(0.26)} className="mt-9 w-full space-y-3 text-left">
              <div className="rounded-[4px] border p-4" style={{ borderColor: 'rgb(var(--ink)/0.10)', background: 'rgb(var(--ink)/0.03)' }}>
                {eventHeader}
              </div>
              <button
                onClick={share}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[4px] bg-primary font-display text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
              >
                <Share2 className="h-4 w-4" />
                {t('waitlist.p.share')}
              </button>
              <button
                onClick={() => navigate(basePath, { state: { eventId } })}
                className="flex h-[52px] w-full items-center justify-center rounded-[4px] border font-display text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
                style={{ borderColor: 'rgb(var(--ink)/0.14)' }}
              >
                {t('waitlist.p.backToEvent')}
              </button>
            </motion.div>
          </div>
        </PublicPage>
      </div>
    );
  }

  // ── Formulaire ─────────────────────────────────────────────────────────────
  const inputCls =
    'h-[54px] w-full rounded-[4px] border bg-transparent px-4 text-base text-white outline-none transition-colors placeholder:text-[var(--tx-5a5a5e)] focus:border-primary';
  const inputStyle = (invalid: boolean) => ({
    borderColor: invalid ? 'hsl(var(--primary))' : 'rgb(var(--ink)/0.14)',
    background: 'rgb(var(--ink)/0.04)',
  });
  const labelCls = 'mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.14em]';
  const labelStyle = { color: 'var(--tx-9a9a9a)' } as const;

  const perks = [
    { icon: BellRing, label: t('waitlist.p.perk1') },
    { icon: Zap, label: t('waitlist.p.perk2') },
    { icon: ShieldCheck, label: t('waitlist.p.perk3') },
  ];

  const consentText = consentScope
    ? t('waitlist.p.consent').replace('{{name}}', consentScope.name)
    : t('waitlist.p.consentGeneric');

  return (
    <div className="relative min-h-screen bg-background pb-16">
      {halo}
      {backBtn}
      <PublicPage variant="flow">
        <div className="relative mx-auto max-w-md px-5 pt-[88px]">
          <motion.div {...rise(0)}>{eventHeader}</motion.div>

          <motion.div {...rise(0.06)} className="mt-9">
            <h1 className="font-display text-[34px] font-bold leading-[1.02] tracking-[-0.035em] text-white">
              {t('waitlist.p.headline')}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--tx-9a9a9a)' }}>
              {t('waitlist.p.sub').replace('{{event}}', event?.title ?? '')}
            </p>
          </motion.div>

          <motion.form
            {...rise(0.12)}
            className="mt-7 space-y-4"
            onSubmit={(e) => { e.preventDefault(); void join(); }}
            noValidate
          >
            {oneTap ? (
              <div
                className="flex items-center gap-3 rounded-[4px] border p-4"
                style={{ borderColor: 'rgb(var(--ink)/0.14)', background: 'rgb(var(--ink)/0.04)' }}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-[15px] font-bold text-primary">
                  {(firstName[0] || '').toUpperCase()}{(lastName[0] || '').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-semibold text-white">
                    {[firstName, lastName].filter(Boolean).join(' ')}
                  </p>
                  <p className="truncate text-[13px]" style={{ color: 'var(--tx-9a9a9a)' }}>{user!.email}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="wl-first" className={labelCls} style={labelStyle}>{t('waitlist.p.firstName')}</label>
                    <input
                      id="wl-first"
                      type="text"
                      autoComplete="given-name"
                      enterKeyHint="next"
                      maxLength={100}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={inputCls}
                      style={inputStyle(triedSubmit && !firstName.trim())}
                    />
                  </div>
                  <div>
                    <label htmlFor="wl-last" className={labelCls} style={labelStyle}>{t('waitlist.p.lastName')}</label>
                    <input
                      id="wl-last"
                      type="text"
                      autoComplete="family-name"
                      enterKeyHint="next"
                      maxLength={100}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className={inputCls}
                      style={inputStyle(false)}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="wl-email" className={labelCls} style={labelStyle}>{t('waitlist.p.email')}</label>
                  <input
                    id="wl-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    enterKeyHint="go"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className={inputCls}
                    style={inputStyle(triedSubmit && !EMAIL_RE.test(email.trim()))}
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-[56px] w-full items-center justify-center gap-2 rounded-[4px] bg-primary font-display text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-70"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  {oneTap ? t('waitlist.p.ctaAccount') : t('waitlist.p.cta')}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            <p className="text-center text-[11.5px] leading-relaxed" style={{ color: 'var(--tx-5a5a5e)' }}>
              {consentText}
            </p>

            {oneTap ? (
              <button
                type="button"
                onClick={() => { setUseOther(true); setEmail(''); setFirstName(''); setLastName(''); }}
                className="block w-full pt-1 text-center text-[13px] transition-colors hover:text-white"
                style={{ color: 'var(--tx-9a9a9a)' }}
              >
                {t('waitlist.p.notYou')}
              </button>
            ) : !user && (
              <button
                type="button"
                onClick={() => navigate(`/auth?redirect=${basePath}/waitlist`)}
                className="block w-full pt-1 text-center text-[13px] transition-colors hover:text-white"
                style={{ color: 'var(--tx-9a9a9a)' }}
              >
                {t('waitlist.p.haveAccount')}
              </button>
            )}
          </motion.form>

          <motion.ul {...rise(0.18)} className="mt-10 space-y-3 border-t pt-6" style={{ borderColor: 'rgb(var(--ink)/0.08)' }}>
            {perks.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-[14px] text-white/90">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </span>
                {label}
              </li>
            ))}
          </motion.ul>
        </div>
      </PublicPage>
    </div>
  );
}
