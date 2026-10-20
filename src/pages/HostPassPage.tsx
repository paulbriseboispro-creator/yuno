/**
 * HostPassPage — /h/:token (chemin provisoire, plan §8)
 *
 * La page du CLUB qui accueille une soirée qu'il n'organise pas : où en sont
 * les ventes, combien de monde prévoir, à quelle heure il arrive, son propre
 * lien pour aider à remplir, puis, en bas, de quoi devenir client Yuno.
 * Sans compte, sans Console, sans conditions pro ni guide : le jeton de l'URL
 * est la clé (RPC get_event_host_pass, migration 20261105200000).
 *
 * DA publique (docs/DESIGN_SYSTEM_PUBLIC.md), téléphone d'abord. Agrégats
 * seulement : jamais un nom d'acheteur. Le CA seulement si l'organisateur le
 * laisse. Langue : celle choisie par l'organisateur (`language`), jamais celle
 * du téléphone ; les mots viennent de `host-pass-words.ts` (hostPass.*).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { ArrowRight, AtSign, Check, Copy, Lock, Mail, MessageCircle, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wordmark } from '@/components/brand/Wordmark';
import { Seo } from '@/components/Seo';
import { capturePosthog } from '@/lib/posthog';
import {
  claimHostPass, hostPassBars, hostPassErrorCode, hostPassHeadline, hostPassLinkUrl, hostPassLocale,
  hostPassNewFacesPct, hostPassSignupUrl, hostPassWhatsappUrl, hostPassWords, isHostPassToken,
  rememberHostPassClaim, toHostPassLanguage, trackHostPass, type HostPassData, type HostPassWords,
} from '@/lib/hostPass';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const RED = '#E8192C';
const GREEN = '#22C55E';
const CARD = '#141414';
const LINE = '#1F1F22';
const MUTED = '#9A9A9A';
const REFRESH_MS = 60_000;
const LIVE_REFRESH_MS = 20_000;

const mono = (size = 10, color = MUTED): React.CSSProperties => ({
  fontFamily: MONO, fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase', color,
});
const card: React.CSSProperties = { background: CARD, border: `1px solid ${LINE}`, borderRadius: 4, padding: 16 };
const pill = (primary: boolean): React.CSSProperties => ({
  height: 46, padding: '0 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none',
  border: primary ? 0 : '1px solid #3A3A3E', background: primary ? '#FFFFFF' : 'transparent', color: primary ? '#0A0A0A' : '#FFFFFF',
});

export default function HostPassPage() {
  const { token } = useParams<{ token: string }>();
  const { language: visitorLanguage } = useLanguage();
  const { user } = useAuth();
  const [data, setData] = useState<HostPassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [claimState, setClaimState] = useState<'idle' | 'busy' | 'accepted' | 'pending' | 'no_venue' | 'error'>('idle');
  const opened = useRef(false);

  const load = useCallback(async () => {
    if (!isHostPassToken(token)) { setData({ found: false }); setLoading(false); return; }
    const { data: res, error } = await supabase.rpc('get_event_host_pass' as never, { p_token: token } as never);
    if (error) { setFailed(true); setLoading(false); return; }
    setFailed(false);
    const d = (res ?? { found: false }) as unknown as HostPassData;
    setData(d);
    setUpdatedAt(new Date());
    setLoading(false);
    if (!opened.current && d.found && !d.closed && !d.is_team) {
      opened.current = true;
      capturePosthog('host_pass_opened', { phase: d.phase ?? null, is_demo: !!d.is_demo });
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const live = data?.phase === 'live';
  useEffect(() => {
    const every = live ? LIVE_REFRESH_MS : REFRESH_MS;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, every);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, live]);

  const lang = toHostPassLanguage(data?.language, toHostPassLanguage(visitorLanguage));
  const w = useMemo(() => hostPassWords(lang), [lang]);
  const loc = hostPassLocale(lang);
  const fmt = useMemo(() => new Intl.NumberFormat(loc), [loc]);
  const money = useMemo(() => new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), [loc]);

  const page: React.CSSProperties = { minHeight: '100dvh', background: '#0A0A0A', color: '#FFFFFF', fontFamily: 'Inter, sans-serif' };
  const shellPad: React.CSSProperties = {
    padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 16px calc(env(safe-area-inset-bottom, 0px) + 48px)',
  };
  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Wordmark height={20} tone="white" alt="Yuno" />
      <span style={{ ...mono(10), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lock size={11} aria-hidden="true" />{w('hostPass.page.private')}
      </span>
    </div>
  );

  if (loading) {
    return (
      <div style={page} lang={lang}>
        <Seo title="Yuno" noindex />
        <div className="mx-auto flex max-w-[480px] flex-col gap-6" style={shellPad}>
          {topBar}
          <div className="animate-pulse" style={{ aspectRatio: '16 / 9', background: CARD, borderRadius: 4 }} />
          <div className="animate-pulse" style={{ height: 44, width: '70%', background: CARD, borderRadius: 4 }} />
          <div className="animate-pulse" style={{ height: 160, background: CARD, borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  if (failed || !data?.found || data.closed) {
    const title = failed ? w('hostPass.page.errorTitle') : data?.closed ? w('hostPass.page.closedTitle') : w('hostPass.page.notFoundTitle');
    const body = failed ? w('hostPass.page.errorBody')
      : data?.closed ? w('hostPass.page.closedBody', { event: data.event_title ?? '' })
        : w('hostPass.page.notFoundBody');
    return (
      <div style={page} lang={lang}>
        <Seo title="Yuno" noindex />
        <div className="mx-auto flex max-w-[480px] flex-col gap-6" style={shellPad}>
          {topBar}
          <div style={{ paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1 style={{ margin: 0, fontFamily: GROTESK, fontWeight: 700, fontSize: 34, lineHeight: 1, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: MUTED }}>{body}</p>
            {failed && (
              <button type="button" onClick={() => { setLoading(true); void load(); }} style={{ ...pill(false), alignSelf: 'flex-start' }}>
                {w('hostPass.page.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const ev = data.event!;
  const t = data.totals!;
  const tz = ev.timezone || 'Europe/Paris';
  const club = data.venue_name ?? '';
  const org = ev.organizer_name;
  const when = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(ev.start_at));
  const startH = formatInTimeZone(new Date(ev.start_at), tz, 'HH:mm');
  const endH = ev.end_at ? formatInTimeZone(new Date(ev.end_at), tz, 'HH:mm') : null;
  const place = [ev.location_name, ev.location_address || ev.location_city].filter(Boolean).join(' · ');
  const closes = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', timeZone: tz }).format(new Date(data.closes_at!));
  const headline = hostPassHeadline(data, w);
  const showRevenue = !!data.show_revenue && !!t.revenue;
  const daysToEvent = Math.max(0, Math.round(
    (Date.parse(formatInTimeZone(new Date(ev.start_at), tz, 'yyyy-MM-dd')) - Date.parse(formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'))) / 86400_000,
  ));
  const bars = hostPassBars(data.series ?? [], data.phase === 'before' ? daysToEvent : 0, 14);
  const maxBar = Math.max(1, ...bars.map((b) => b.people));
  const link = data.link?.code ? hostPassLinkUrl(data.link.code) : '';
  const newFaces = data.phase === 'after' ? hostPassNewFacesPct(data.audience) : null;
  const signupHref = hostPassSignupUrl(lang, { venueName: club, email: data.contact_email ?? null, city: ev.location_city });
  const paulHref = hostPassWhatsappUrl(data.paul_whatsapp, w('hostPass.convert.talkMessage', { club, event: ev.title }));
  const orgWa = hostPassWhatsappUrl(data.organizer_contact?.phone, '');
  const claimed = data.claim?.status === 'accepted' || claimState === 'accepted';

  const today = (n: number) => (n > 0 ? w('hostPass.page.today', { n: fmt.format(n) }) : w('hostPass.page.nothingToday'));
  const tiles: { key: string; label: string; value: string; sub?: string | null; accent?: boolean }[] = [
    { key: 'p', label: w('hostPass.page.paid'), value: fmt.format(t.paid.n), sub: data.phase === 'before' ? today(t.paid.today) : null, accent: t.paid.today > 0 },
    { key: 'f', label: w('hostPass.page.free'), value: fmt.format(t.free.n), sub: data.phase === 'before' ? today(t.free.today) : null },
    data.phase === 'before'
      ? { key: 'e', label: w('hostPass.page.expected'), value: fmt.format(t.expected), sub: t.capacity ? w('hostPass.page.capacity', { n: fmt.format(t.paid.n + t.free.n), cap: fmt.format(t.capacity) }) : null }
      : { key: 'e', label: w('hostPass.page.entered'), value: t.entered > 0 || t.door_measured ? fmt.format(t.entered) : '—', sub: `${w('hostPass.page.expected')} · ${fmt.format(t.expected)}` },
    showRevenue
      ? { key: 'r', label: w('hostPass.page.revenue'), value: money.format(t.revenue!.total), sub: data.phase === 'before' && t.revenue!.today > 0 ? w('hostPass.page.today', { n: money.format(t.revenue!.today) }) : null }
      : { key: 'x', label: w('hostPass.page.expected'), value: fmt.format(t.expected), sub: null },
  ];
  // Sans CA, « attendus » ne se répète pas deux fois avant la soirée.
  const shownTiles = !showRevenue && data.phase === 'before' ? tiles.slice(0, 3) : tiles;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      trackHostPass(token!, 'copy');
      capturePosthog('host_pass_cta_clicked', { cta: 'link_copy' });
    } catch { /* le lien reste affiché, il se sélectionne à la main */ }
  };
  const shareLink = async () => {
    trackHostPass(token!, 'share');
    capturePosthog('host_pass_cta_clicked', { cta: 'link_share' });
    const text = w('hostPass.page.shareText', { event: ev.title });
    if (navigator.share) {
      try { await navigator.share({ title: ev.title, text, url: link }); return; } catch { return; }
    }
    void copyLink();
  };
  const goSignup = () => {
    rememberHostPassClaim(token!);
    trackHostPass(token!, 'signup');
    capturePosthog('host_pass_cta_clicked', { cta: 'signup' });
  };
  const talk = () => {
    trackHostPass(token!, 'whatsapp');
    capturePosthog('host_pass_cta_clicked', { cta: 'whatsapp' });
  };
  const claim = async () => {
    setClaimState('busy');
    capturePosthog('host_pass_cta_clicked', { cta: 'claim' });
    try {
      const r = await claimHostPass(token!);
      setClaimState(r.status === 'accepted' ? 'accepted' : 'pending');
      capturePosthog('host_pass_claimed', { status: r.status, via: 'page' });
      void load();
    } catch (err) {
      setClaimState(hostPassErrorCode(err) === 'no_venue' ? 'no_venue' : 'error');
    }
  };

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ev.poster_url ? (
        <img src={ev.poster_url} alt="" className="w-full lg:hidden"
          style={{ aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 4, border: `1px solid ${LINE}`, background: CARD }} />
      ) : null}
      <span style={mono(11, RED)}>{w('hostPass.page.kicker')} · {club}</span>
      <h1 style={{ margin: '-6px 0 0', fontFamily: GROTESK, fontWeight: 700, fontSize: 'clamp(40px, 6vw, 64px)', lineHeight: 0.95, letterSpacing: '-0.02em', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
        {ev.title}
      </h1>
      <span style={{ ...mono(11), lineHeight: 1.7, letterSpacing: '0.1em' }}>
        {when} · {endH ? w('hostPass.page.hours', { start: startH, end: endH }) : startH}
        {place ? <><br />{place}</> : null}
        <br />{w('hostPass.page.organizedBy', { org })}
      </span>
    </div>
  );

  const answer = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {live && (
        <span style={{ ...mono(11, GREEN), display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: GREEN }} aria-hidden="true" />
          {w('hostPass.page.live')}
        </span>
      )}
      <p style={{ margin: 0, fontFamily: GROTESK, fontSize: 'clamp(22px, 3.2vw, 30px)', lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.01em', color: data.phase === 'cancelled' ? '#F2B23C' : '#FFFFFF' }}>
        {headline}
      </p>
      {data.is_team && <span style={{ fontSize: 12, color: MUTED }}>{w('hostPass.page.teamNote')}</span>}
    </div>
  );

  const numbers = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(2, minmax(0, 1fr))`, gap: 1, background: LINE, border: `1px solid ${LINE}`, borderRadius: 4, overflow: 'hidden' }}>
        {shownTiles.map((tile, i) => (
          <div key={tile.key} style={{ background: '#0F0F10', padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, gridColumn: shownTiles.length === 3 && i === 2 ? 'span 2' : undefined }}>
            <span style={mono(10)}>{tile.label}</span>
            <span style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 36, lineHeight: 1, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.value}</span>
            {tile.sub && <span style={{ fontFamily: MONO, fontSize: 11, color: tile.accent ? RED : MUTED }}>{tile.sub}</span>}
          </div>
        ))}
      </div>
      {(t.guest_list.enabled || t.guest_list.n > 0) && (
        <span style={{ fontSize: 13, color: '#E5E5E5' }}>{w('hostPass.page.guestList', { n: fmt.format(t.guest_list.n) })}</span>
      )}
      {(t.tables.enabled || t.tables.booked > 0) && (
        <span style={{ fontSize: 13, color: '#E5E5E5' }}>{w('hostPass.page.tables', { n: fmt.format(t.tables.booked), g: fmt.format(t.tables.guests) })}</span>
      )}
      {showRevenue && <span style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{w('hostPass.page.revenueHint')}</span>}
      {updatedAt && (
        <span style={{ ...mono(10), letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: GREEN }} aria-hidden="true" />
          {w('hostPass.page.updated', { time: formatInTimeZone(updatedAt, tz, 'HH:mm') })}
        </span>
      )}
    </section>
  );

  const arrivals = (data.arrivals ?? []).length > 0 && (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={mono(10)}>{w('hostPass.page.arrivals')}</span>
      {(() => {
        const total = Math.max(1, ...(data.arrivals ?? []).map((a) => a.heads));
        return (data.arrivals ?? []).map((a) => (
          <div key={a.deadline ?? 'all'} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>{a.deadline ? w('hostPass.page.before', { time: a.deadline }) : w('hostPass.page.allNight')}</span>
              <span style={{ fontFamily: GROTESK, fontWeight: 700 }}>{fmt.format(a.heads)}</span>
            </div>
            <div style={{ height: 6, background: '#232326', borderRadius: 999 }}>
              <div style={{ width: `${Math.round((a.heads / total) * 100)}%`, height: '100%', borderRadius: 999, background: a.deadline ? RED : '#FFFFFF' }} />
            </div>
          </div>
        ));
      })()}
      {(data.arrivals ?? []).some((a) => a.deadline) && (
        <span style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{w('hostPass.page.arrivalsHint')}</span>
      )}
      {(data.drink?.heads ?? 0) > 0 && (
        <span style={{ fontSize: 13, color: '#E5E5E5', lineHeight: 1.5, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
          {data.drink!.cutoff
            ? w('hostPass.page.drink', { n: fmt.format(data.drink!.heads), time: data.drink!.cutoff })
            : w('hostPass.page.drinkNoTime', { n: fmt.format(data.drink!.heads) })}
        </span>
      )}
    </section>
  );

  const curve = data.phase !== 'after' && bars.some((b) => b.people > 0) && (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={mono(10)}>{w('hostPass.page.curve')}</span>
      <div role="img" aria-label={w('hostPass.page.curve')} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96, borderBottom: `1px solid ${LINE}`, paddingBottom: 2 }}>
        {bars.map((b, i) => (
          <div key={b.d} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
            {b.people > 0 && <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED }}>{b.people}</span>}
            <div style={{ width: '100%', height: Math.max(2, Math.round((b.people / maxBar) * 70)), borderRadius: '2px 2px 0 0', background: i === bars.length - 1 ? RED : '#2A2A2E' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...mono(9, '#5A5A5E'), letterSpacing: '0.08em' }}>
        <span>J-{bars[0]?.d}</span>
        <span>{data.phase === 'before' && daysToEvent > 0 ? `J-${daysToEvent}` : w('hostPass.page.curveToday')}</span>
      </div>
    </section>
  );

  const afterBlock = data.phase === 'after' && (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={mono(10)}>{w('hostPass.page.after')}</span>
      <span style={{ fontSize: 15, lineHeight: 1.5 }}>{headline}</span>
      {newFaces !== null && <span style={{ fontSize: 15, lineHeight: 1.5 }}>{w('hostPass.page.newFaces', { pct: newFaces, org })}</span>}
    </section>
  );

  const lines = (data.lines ?? []).length > 0 && (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ ...mono(10), paddingBottom: 8 }}>{w('hostPass.page.tickets')}</span>
      {(data.lines ?? []).map((l, i) => (
        <div key={`${l.name}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: '1px solid #1A1A1C' }}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
            <span style={{ ...mono(9), letterSpacing: '0.08em' }}>
              {w(`hostPass.page.status.${l.status}` as Parameters<HostPassWords>[0])}
              {l.includes_drink ? ` · ${w('hostPass.page.drinkTag')}` : ''}
            </span>
          </div>
          <span style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
            {fmt.format(l.sold)}{l.capacity ? <span style={{ color: '#5A5A5E' }}> / {fmt.format(l.capacity)}</span> : null}
          </span>
        </div>
      ))}
    </section>
  );

  const lineup = (data.lineup ?? []).length > 0 && (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={mono(10)}>{w('hostPass.page.lineup')}</span>
      <span style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 22, lineHeight: 1.2, textTransform: 'uppercase' }}>{(data.lineup ?? []).join(' · ')}</span>
      <span style={{ ...mono(11), letterSpacing: '0.1em' }}>{endH ? w('hostPass.page.hours', { start: startH, end: endH }) : startH}</span>
    </section>
  );

  const yourLink = link && (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={mono(10)}>{w('hostPass.page.yourLink')}</span>
      <span style={{ fontFamily: MONO, fontSize: 14, wordBreak: 'break-all' }}>{link.replace(/^https?:\/\//, '')}</span>
      <span style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{w('hostPass.page.yourLinkHint', { club })}</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={() => void copyLink()} className="transition-transform active:scale-[0.97]" style={{ ...pill(true), flex: 1 }}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? w('hostPass.page.copied') : w('hostPass.page.copy')}
        </button>
        <button type="button" onClick={() => void shareLink()} className="transition-transform active:scale-[0.97]" style={{ ...pill(false), flex: 1 }}>
          <Share2 size={15} aria-hidden="true" />{w('hostPass.page.share')}
        </button>
      </div>
      {data.link && (data.link.clicks > 0 || data.link.people > 0) && (
        <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
          {w('hostPass.page.linkStats', { clicks: fmt.format(data.link.clicks), people: fmt.format(data.link.people) })}
          {showRevenue && data.link.revenue ? ` · ${money.format(data.link.revenue)}` : ''}
        </span>
      )}
    </section>
  );

  const contact = (orgWa || data.organizer_contact?.email || data.organizer_contact?.instagram) && (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={mono(10)}>{w('hostPass.page.contact')} · {org}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {orgWa && (
          <a href={orgWa} target="_blank" rel="noopener noreferrer" onClick={() => capturePosthog('host_pass_cta_clicked', { cta: 'contact_org' })} style={pill(false)}>
            <MessageCircle size={15} aria-hidden="true" />{w('hostPass.page.contactWhatsapp', { org })}
          </a>
        )}
        {data.organizer_contact?.email && (
          <a href={`mailto:${data.organizer_contact.email}?subject=${encodeURIComponent(ev.title)}`} onClick={() => capturePosthog('host_pass_cta_clicked', { cta: 'contact_org' })} style={pill(false)}>
            <Mail size={15} aria-hidden="true" />{w('hostPass.page.contactEmail')}
          </a>
        )}
        {data.organizer_contact?.instagram && /^https:\/\//.test(data.organizer_contact.instagram) && (
          <a href={data.organizer_contact.instagram} target="_blank" rel="noopener noreferrer" style={pill(false)}>
            <AtSign size={15} aria-hidden="true" />{w('hostPass.page.contactInstagram')}
          </a>
        )}
      </div>
    </section>
  );

  const convert = (
    <section style={{ border: `1px solid ${claimed ? LINE : 'rgba(232,25,44,0.45)'}`, borderRadius: 4, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, background: claimed ? CARD : 'linear-gradient(180deg, rgba(232,25,44,0.10), rgba(232,25,44,0) 70%)' }}>
      {claimed ? (
        <>
          <h2 style={{ margin: 0, fontFamily: GROTESK, fontWeight: 700, fontSize: 26, lineHeight: 1, textTransform: 'uppercase' }}>{w('hostPass.convert.claimed')}</h2>
          <span style={{ fontSize: 14, color: '#E5E5E5', lineHeight: 1.5 }}>{w('hostPass.convert.claimAccepted')}</span>
          <Link to="/owner/collaborations" style={{ ...pill(true), alignSelf: 'flex-start' }}>{w('hostPass.convert.openConsole')}<ArrowRight size={15} aria-hidden="true" /></Link>
        </>
      ) : (
        <>
          <h2 style={{ margin: 0, fontFamily: GROTESK, fontWeight: 700, fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', textTransform: 'uppercase' }}>{w('hostPass.convert.title')}</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: '#E5E5E5' }}>
            {t.expected > 0
              ? w('hostPass.convert.body', { n: fmt.format(t.paid.n + t.free.n + t.tables.guests), club })
              : w('hostPass.convert.bodyEmpty')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <a href={signupHref} onClick={goSignup} style={pill(true)}>{w('hostPass.convert.signup')}<ArrowRight size={15} aria-hidden="true" /></a>
            {paulHref && (
              <a href={paulHref} target="_blank" rel="noopener noreferrer" onClick={talk} style={pill(false)}>
                <MessageCircle size={15} aria-hidden="true" />{w('hostPass.convert.talk')}
              </a>
            )}
          </div>
          <span style={{ fontSize: 12, color: MUTED }}>{w('hostPass.convert.free')}</span>
          {user && !data.is_team && (
            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: MUTED }}>{w('hostPass.convert.haveAccount')}</span>
              {claimState === 'pending' ? (
                <span style={{ fontSize: 13 }}>{w('hostPass.convert.claimPending')}</span>
              ) : claimState === 'no_venue' ? (
                <span style={{ fontSize: 13 }}>{w('hostPass.convert.claimNoVenue')}</span>
              ) : (
                <button type="button" disabled={claimState === 'busy'} onClick={() => void claim()} style={{ ...pill(false), height: 38, fontSize: 13 }}>
                  {w('hostPass.convert.addToConsole')}
                </button>
              )}
              {claimState === 'error' && <span style={{ fontSize: 12, color: '#F2B23C' }}>{w('hostPass.err.generic')}</span>}
            </div>
          )}
        </>
      )}
    </section>
  );

  const footer = (
    <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, lineHeight: 1.5, color: MUTED }}>{w('hostPass.page.keepPrivate', { date: closes })}</span>
      <span style={{ ...mono(10, '#5A5A5E'), letterSpacing: '0.12em' }}>{w('hostPass.page.footer', { org })}</span>
    </div>
  );

  return (
    <div style={page} lang={lang}>
      <Seo title={`${ev.title} · ${club}`} noindex />
      <div className="mx-auto flex max-w-[480px] flex-col gap-7 lg:max-w-[1080px]" style={shellPad}>
        {topBar}
        <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-10">
          <div className="flex flex-col gap-7">
            {header}
            {answer}
            {numbers}
            {afterBlock}
            {arrivals}
            {curve}
            {lines}
          </div>
          <div className="flex flex-col gap-7 lg:sticky lg:top-6">
            {ev.poster_url ? (
              <img src={ev.poster_url} alt="" className="hidden w-full lg:block"
                style={{ aspectRatio: '4 / 5', objectFit: 'cover', borderRadius: 4, border: `1px solid ${LINE}`, background: CARD }} />
            ) : null}
            {lineup}
            {yourLink}
            {contact}
            {convert}
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
