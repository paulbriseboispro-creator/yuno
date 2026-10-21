/**
 * GuestSpacePage — /invite/:passId
 *
 * L'ESPACE INVITÉ d'une soirée : un club ou une organisation invités sur UNE
 * soirée en collab (maquette validée par Paul,
 * `docs/designs/mockups/espace-invite-soiree.html`). La coquille de la Console
 * Yuno Tickets (barre latérale, en-tête, cartes sombres) réduite à cette
 * soirée, six onglets : Vue d'ensemble, Ventes, Marketing, Argent, Porte,
 * Infos & contrat. L'espace s'ouvre avec le compte Yuno RATTACHÉ à l'accès
 * (get_event_guest_space par l'id, session obligatoire ; l'équipe de
 * l'organisateur peut le regarder). L'invitation /h/<jeton> ne fait que
 * rattacher (GuestInvitePage). Agrégats seulement ; l'invité ne voit que SA part.
 *
 * Langue : celle choisie par l'organisateur, jamais celle du téléphone.
 * Conversion : une ligne au pied de la barre latérale, rien d'autre.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Banknote, Info, LayoutGrid, Loader2, Lock, Megaphone, ScanLine, Ticket,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Wordmark } from '@/components/brand/Wordmark';
import { Seo } from '@/components/Seo';
import { OrgButton, OrgPill, RED, POS, T1, T2, T3, BORDER, CARD_BG } from '@/components/org-ui';
import { capturePosthog } from '@/lib/posthog';
import {
  GUEST_TABS, daysToNight, guestErrorCode, guestErrorText, guestSignupUrl, guestSpaceLocale, guestSpaceWords, isGuestPassId, loadGuestSpace,
  loadGuestNotifications, markGuestNotificationsRead, readGuestLang, rememberGuestClaim, toGuestNotifications, toGuestSpaceLanguage,
  trackGuestSpace, writeGuestLang, type GuestNotificationRow, type GuestSpaceData, type GuestSpaceLanguage, type GuestTab,
} from '@/lib/guestSpace';
import { GuestAvatar, GuestAvatarButton } from '@/components/guest-space/GuestPhoto';
import { saveGuestPhoto } from '@/components/guest-space/guestPhotoActions';
import type { GuestTabProps } from '@/components/guest-space/context';
import { HomeTab, SalesTab } from '@/components/guest-space/HomeSalesTabs';
import { MarketingTab, MoneyTab } from '@/components/guest-space/MarketingMoneyTabs';
import { DoorTab, InfoTab } from '@/components/guest-space/DoorInfoTabs';
import { GuestTopBar } from '@/components/guest-space/TopBar';

const ICONS: Record<GuestTab, typeof LayoutGrid> = {
  home: LayoutGrid, sales: Ticket, mkt: Megaphone, money: Banknote, door: ScanLine, info: Info,
};
const REFRESH_MS = 60_000;
const LIVE_REFRESH_MS = 20_000;

export default function GuestSpacePage() {
  // `token` = l'id de l'accès (adresse /invite/<id>) : les gestes de l'espace le passent tel quel.
  const { passId: token } = useParams<{ passId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { language: visitorLanguage } = useLanguage();
  const [data, setData] = useState<GuestSpaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const opened = useRef(false);

  const tabParam = search.get('tab') as GuestTab | null;
  const tab: GuestTab = tabParam && GUEST_TABS.includes(tabParam) ? tabParam : 'home';
  const go = useCallback((t: GuestTab) => {
    setSearch((s) => { const n = new URLSearchParams(s); if (t === 'home') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });
    window.scrollTo({ top: 0 });
  }, [setSearch]);

  const [notifRows, setNotifRows] = useState<GuestNotificationRow[]>([]);
  const load = useCallback(async () => {
    if (!isGuestPassId(token)) { setData({ found: false }); setLoading(false); return; }
    if (!user) return;
    try {
      const d = await loadGuestSpace(token);
      setFailed(false);
      setData(d ?? { found: false });
      // La cloche du compte rattaché (l'équipe de l'organisateur n'en a pas).
      if (d?.found && !d.is_team) {
        loadGuestNotifications(token).then((rows) => setNotifRows(rows ?? [])).catch(() => { /* la cloche attend le passage suivant */ });
      }
      if (!opened.current && d?.found && !d.closed && !d.is_team) {
        opened.current = true;
        capturePosthog('guest_space_opened', { phase: d.phase ?? null, guest_kind: d.guest?.kind ?? null, is_demo: !!d.is_demo });
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  // Sans session, l'espace ne s'ouvre pas : connexion puis retour ici.
  useEffect(() => {
    if (!authLoading && !user && isGuestPassId(token)) {
      navigate(`/auth?redirect=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
    }
  }, [authLoading, user, token, navigate]);

  useEffect(() => { void load(); }, [load]);
  const live = data?.phase === 'live';
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, live ? LIVE_REFRESH_MS : REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, live]);
  useEffect(() => {
    if (!toastMsg) return;
    const id = window.setTimeout(() => setToastMsg(null), 2200);
    return () => window.clearTimeout(id);
  }, [toastMsg]);

  // La langue part de celle choisie par l'organisateur ; l'invité la change pour lui (son appareil).
  const [langPick, setLangPick] = useState<GuestSpaceLanguage | null>(() => (token ? readGuestLang(token) : null));
  const lang = langPick ?? toGuestSpaceLanguage(data?.language, toGuestSpaceLanguage(visitorLanguage));
  const w = useMemo(() => guestSpaceWords(lang), [lang]);
  const loc = guestSpaceLocale(lang);
  const tz = data?.event?.timezone || 'Europe/Paris';
  const fmt = useMemo(() => new Intl.NumberFormat(loc), [loc]);
  const eurFmt = useMemo(() => new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 }), [loc]);

  const page: React.CSSProperties = { minHeight: '100dvh', background: 'var(--sf-000000, #000)', color: T1 };

  if (loading) {
    return (
      <div style={page} className="flex items-center justify-center" lang={lang}>
        <Seo title="Yuno" noindex />
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  if (failed || !data?.found || data.closed) {
    const title = failed ? w('guestSpace.state.errorTitle') : data?.closed ? w('guestSpace.state.closedTitle') : w('guestSpace.state.notFoundTitle');
    const body = failed ? w('guestSpace.state.errorBody')
      : data?.closed ? w('guestSpace.state.closedBody', { event: data.event_title ?? '' }) : w('guestSpace.state.notFoundBody');
    return (
      <div style={page} lang={lang}>
        <Seo title="Yuno" noindex />
        <div className="mx-auto max-w-[480px] px-4 py-10">
          <Wordmark height={20} tone="white" alt="Yuno" />
          <h1 className="mt-10" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h1>
          <p className="mt-2" style={{ color: T2, fontSize: 14, lineHeight: 1.55 }}>{body}</p>
          {failed && <div className="mt-5"><OrgButton onClick={() => { setLoading(true); void load(); }}>{w('guestSpace.state.retry')}</OrgButton></div>}
          {!failed && !data?.closed && (
            <div className="mt-5">
              <OrgButton onClick={() => {
                void supabase.auth.signOut({ scope: 'local' }).then(() =>
                  navigate(`/auth?redirect=${encodeURIComponent(`/invite/${token ?? ''}`)}`, { replace: true }));
              }}>{w('guestSpace.state.otherAccount')}</OrgButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  const ev = data.event!;
  const guest = data.guest!;
  const date = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...opts, timeZone: tz }).format(new Date(iso));
  const notifications = toGuestNotifications(notifRows, lang, (n) => eurFmt.format(n), tz);
  const props: GuestTabProps = {
    d: data, w, lang, token: token!, num: (n) => fmt.format(n), eur: (n) => eurFmt.format(n), date,
    reload: load, go, toast: (text, tone = 'ok') => setToastMsg({ text, tone }),
  };
  const toNight = daysToNight(ev.start_at, tz);
  const phasePill = data.phase === 'before'
    ? (toNight > 0 ? w('guestSpace.shell.phase.before', { n: toNight }) : w('guestSpace.shell.phase.today'))
    : w(`guestSpace.shell.phase.${data.phase ?? 'before'}` as Parameters<typeof w>[0]);
  const gc = data.money?.mode === 'guest_contract' ? data.money.contract ?? null : null;
  const deal = data.money?.mode === 'contract' || gc?.status === 'signed' ? w('guestSpace.shell.deal.contract')
    : gc ? w('guestSpace.shell.deal.toSign') : w('guestSpace.shell.deal.external');
  const tabs = GUEST_TABS;
  const tag = (t: GuestTab): { label: string; tone: 'warn' | 'success' } | null => {
    if (t === 'money' && gc?.status === 'proposed') return { label: w('guestSpace.contract.toSign'), tone: 'warn' };
    if (t === 'money' && gc && data.money?.transfer?.status === 'sent') return { label: w('guestSpace.tag.toCheck'), tone: 'warn' };
    if (t === 'money' && data.phase === 'after' && !data.money?.response && (data.money?.mode === 'contract' || data.money?.my_share)) {
      return { label: w('guestSpace.tag.toCheck'), tone: 'warn' };
    }
    if (t === 'door' && data.phase === 'live') return { label: w('guestSpace.tag.live'), tone: 'success' };
    return null;
  };
  const claimed = guest.party && guest.claim_status === 'accepted';
  const signupHref = guestSignupUrl(lang, { kind: guest.kind, name: guest.name, email: guest.contact_email });
  const place = ev.location_name || guest.name;

  const convert = (
    <div className="px-2 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
      {claimed ? (
        <>
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{w('guestSpace.shell.claimed', { name: guest.party_name ?? guest.name })}</p>
          <Link to={guest.kind === 'venue' ? '/owner/collaborations' : '/organizer-app/collaborations'}
            className="mt-1 inline-flex items-center gap-1" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
            {w('guestSpace.shell.openConsole')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      ) : (
        <>
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{w('guestSpace.shell.convertLine')}</p>
          <a href={signupHref} onClick={() => { rememberGuestClaim(token!); trackGuestSpace(token!, 'signup'); capturePosthog('guest_space_cta_clicked', { cta: 'signup' }); }}
            className="mt-1 inline-flex items-center gap-1" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
            {w('guestSpace.shell.convertCta', { name: guest.name })} <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </>
      )}
    </div>
  );

  const View = { home: HomeTab, sales: SalesTab, mkt: MarketingTab, money: MoneyTab, door: DoorTab, info: InfoTab }[tab];

  return (
    <div style={page} lang={lang}>
      <Seo title={`${ev.title} · ${guest.name}`} noindex />
      <div className="mx-auto grid max-w-[1360px] gap-7 px-4 pb-14 pt-4 lg:grid-cols-[240px_minmax(0,1fr)]"
        style={{ paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
        {/* Barre latérale (ordinateur) */}
        <aside className="hidden flex-col gap-4 self-start rounded-[18px] p-2.5 pt-3.5 lg:sticky lg:top-4 lg:flex" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-2.5 px-1.5 pb-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {/* Le compte rattaché change sa photo ; l'équipe de l'organisateur la voit seulement. */}
            {guest.account_email
              ? <GuestAvatarButton url={guest.photo_url} name={guest.name} kind={guest.kind} size={34} radius={9}
                  label={guest.photo_url ? w('guestSpace.photo.change') : w('guestSpace.photo.add')}
                  onFile={(f) => void saveGuestPhoto(props, f, (err) => guestErrorText(guestErrorCode(err), w))} />
              : <GuestAvatar url={guest.photo_url} name={guest.name} kind={guest.kind} size={34} radius={9} />}
            <div className="min-w-0">
              <div className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 650 }}>{guest.name}</div>
              <div style={{ color: T3, fontSize: 11 }}>{w('guestSpace.shell.invitedOn')}</div>
            </div>
          </div>
          <div className="px-1.5">
            <div className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{ev.title}</div>
            <div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{w('guestSpace.shell.nightOf', { org: ev.organizer_name, place })}</div>
          </div>
          <nav className="flex flex-col gap-0.5">
            {tabs.map((t) => {
              const Icon = ICONS[t];
              const tg = tag(t);
              const active = t === tab;
              return (
                <button key={t} type="button" onClick={() => go(t)} aria-current={active ? 'page' : undefined}
                  className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
                  style={{ background: active ? 'rgb(var(--ink)/0.07)' : 'transparent', color: active ? T1 : T2, fontSize: 13.5, fontWeight: active ? 620 : 540 }}>
                  <Icon className="h-4 w-4 flex-none" style={{ color: active ? RED : T3 }} />
                  <span className="flex-1">{w(`guestSpace.tab.${t}` as Parameters<typeof w>[0])}</span>
                  {tg && <OrgPill tone={tg.tone}>{tg.label}</OrgPill>}
                </button>
              );
            })}
          </nav>
          {convert}
        </aside>

        <main className="min-w-0">
          <GuestTopBar w={w} lang={lang} go={go} date={date}
            onLang={(l) => { setLangPick(l); if (token) writeGuestLang(token, l); }}
            notifications={notifications}
            onOpenBell={() => {
              if (!token || !notifRows.some((r) => !r.read)) return;
              setNotifRows((rows) => rows.map((r) => ({ ...r, read: true })));
              void markGuestNotificationsRead(token).catch(() => { /* reste non lu au prochain passage */ });
            }} />
          <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              {ev.poster_url && <img src={ev.poster_url} alt="" className="h-14 w-14 flex-none rounded-xl object-cover" style={{ border: `1px solid ${BORDER}` }} />}
              <div className="min-w-0">
                <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  {w('guestSpace.shell.nightOf', { org: ev.organizer_name, place })}
                </div>
                <h1 className="truncate" style={{ color: T1, fontSize: 'clamp(22px,2.6vw,30px)', fontWeight: 720, letterSpacing: '-0.02em' }}>{ev.title}</h1>
                <div className="truncate" style={{ color: T2, fontSize: 13 }}>
                  {date(ev.start_at, { weekday: 'short', day: 'numeric', month: 'short' })} · {date(ev.start_at, { hour: '2-digit', minute: '2-digit' })}
                  {ev.end_at ? ` → ${date(ev.end_at, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  {[ev.location_name, ev.location_city].filter(Boolean).length ? ` · ${[ev.location_name, ev.location_city].filter(Boolean).join(', ')}` : ''}
                  {` · ${w('guestSpace.shell.ledBy', { org: ev.organizer_name })}`}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <OrgPill tone={data.phase === 'before' ? 'default' : data.phase === 'live' ? 'success' : 'muted'}>{phasePill}</OrgPill>
              <OrgPill tone="muted">{deal}</OrgPill>
            </div>
          </header>
          {data.is_team && (
            <p className="mb-3" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.shell.teamNote')}</p>
          )}
          {/* Onglets (téléphone) */}
          <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden" role="tablist">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => go(t)}
                className="flex-none rounded-full px-3.5 py-2"
                style={{ fontSize: 13, fontWeight: 600, color: t === tab ? T1 : T2, background: t === tab ? 'rgb(var(--ink)/0.09)' : 'transparent', border: `1px solid ${t === tab ? 'rgb(var(--ink)/0.16)' : BORDER}` }}>
                {w(`guestSpace.tab.${t}` as Parameters<typeof w>[0])}
                {tag(t) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: tag(t)!.tone === 'success' ? POS : 'var(--acc-fcd34d)' }} />}
              </button>
            ))}
          </div>

          <View {...props} />

          <div className="mt-8 lg:hidden">{convert}</div>
        </main>
      </div>
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5" role="status"
          style={{ background: 'var(--sf-141416)', border: `1px solid ${toastMsg.tone === 'err' ? 'rgba(255,92,99,0.4)' : BORDER}`, color: T1, fontSize: 13, boxShadow: '0 12px 30px -10px rgb(0 0 0/0.6)' }}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}
