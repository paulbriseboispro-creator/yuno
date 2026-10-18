/**
 * PartnerStatsPage — /stats/:token
 *
 * La page d'un partenaire (promoteur, DJ, ami…) branché sur UNE soirée par un
 * lien partenaire : son lien de vente, ses chiffres, ses clics des 7 derniers
 * jours et l'historique de ses ventes. Sans compte : le jeton de l'URL est la
 * clé (RPC get_partner_link_page, migration 20261017200000).
 *
 * DA publique (docs/DESIGN_SYSTEM_PUBLIC.md) : fond noir, titres Space Grotesk
 * en capitales, métadonnées en mono. L'acheteur n'apparaît que par son prénom
 * et une initiale ; le CA seulement si l'organisateur l'a choisi.
 *
 * Langue : celle choisie par le pro à la création du lien (`language`, en / fr
 * / es), jamais celle du téléphone du visiteur. Les mots viennent de
 * `partnerLinkWords.ts`, pas du dictionnaire de l'interface. Tant que la page
 * ne sait pas encore quelle langue parler (chargement, lien introuvable), elle
 * prend celle du visiteur.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { Check, Copy, Lock, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wordmark } from '@/components/brand/Wordmark';
import { Seo } from '@/components/Seo';
import {
  PUBLIC_BASE_URL, type PartnerPageData, type PartnerPageSale, isPartnerToken, partnerConversion,
  partnerLinkUrl,
} from '@/lib/partnerLinks';
import { type PartnerWords, partnerLocale, partnerWords, toPartnerLanguage } from '@/lib/partnerLinkWords';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const RED = '#E8192C';
const REFRESH_MS = 60_000;

const mono = (size = 10, color = '#9A9A9A'): React.CSSProperties => ({
  fontFamily: MONO, fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase', color,
});

export default function PartnerStatsPage() {
  const { token } = useParams<{ token: string }>();
  const { language: visitorLanguage } = useLanguage();
  const [data, setData] = useState<PartnerPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!isPartnerToken(token)) { setData({ found: false }); setLoading(false); return; }
    const { data: res, error } = await supabase.rpc('get_partner_link_page', { p_token: token });
    if (error) { setFailed(true); setLoading(false); return; }
    setFailed(false);
    setData((res ?? { found: false }) as unknown as PartnerPageData);
    setUpdatedAt(new Date());
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Les ventes arrivent en direct : on relit chaque minute tant que l'onglet est visible.
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const pageLang = toPartnerLanguage(data?.language, toPartnerLanguage(visitorLanguage));
  const t = useMemo(() => partnerWords(pageLang), [pageLang]);
  const loc = partnerLocale(pageLang);
  const money = useMemo(
    () => new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    [loc],
  );

  const tz = data?.event?.timezone || 'Europe/Paris';
  const link = data?.code ? partnerLinkUrl(PUBLIC_BASE_URL, data.code) : '';
  const firstName = (data?.partner_name || '').split(' ')[0];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* le lien reste affiché, il se sélectionne à la main */ }
  };

  const shareLink = async () => {
    const text = t('shareText').replace('{event}', data?.event?.title ?? '');
    if (navigator.share) {
      try { await navigator.share({ title: data?.event?.title, text, url: link }); return; } catch { return; }
    }
    copyLink();
  };

  const page: React.CSSProperties = {
    minHeight: '100dvh', background: '#0A0A0A', color: '#FFFFFF', fontFamily: 'Inter, sans-serif',
  };
  const column: React.CSSProperties = {
    maxWidth: 480, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 16px calc(env(safe-area-inset-bottom, 0px) + 40px)',
    display: 'flex', flexDirection: 'column', gap: 28,
  };

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Wordmark height={20} tone="white" alt="Yuno" />
      <span style={{ ...mono(10), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lock size={11} aria-hidden="true" />{t('private')}
      </span>
    </div>
  );

  if (loading) {
    return (
      <div style={page} lang={pageLang}>
        <Seo title="Yuno" noindex />
        <div style={column}>
          {topBar}
          <div className="animate-pulse" style={{ aspectRatio: '16 / 9', background: '#141414', borderRadius: 4 }} />
          <div className="animate-pulse" style={{ height: 44, width: '70%', background: '#141414', borderRadius: 4 }} />
          <div className="animate-pulse" style={{ height: 140, background: '#141414', borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  if (failed || !data?.found || data.closed) {
    const title = failed ? t('errorTitle') : data?.closed ? t('closedTitle') : t('notFoundTitle');
    const body = failed
      ? t('errorBody')
      : data?.closed
        ? t('closedBody').replace('{event}', data.event_title ?? '')
        : t('notFoundBody');
    return (
      <div style={page} lang={pageLang}>
        <Seo title="Yuno" noindex />
        <div style={column}>
          {topBar}
          <div style={{ paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1 style={{ margin: 0, fontFamily: GROTESK, fontWeight: 700, fontSize: 34, lineHeight: 1, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: '#9A9A9A' }}>{body}</p>
            {failed && (
              <button
                type="button"
                onClick={() => { setLoading(true); load(); }}
                style={{ alignSelf: 'flex-start', height: 44, padding: '0 20px', borderRadius: 999, border: '1px solid #3A3A3E', background: 'transparent', color: '#FFFFFF', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
              >
                {t('retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const ev = data.event!;
  const totals = data.totals ?? { clicks: 0, sales: 0, revenue: null };
  const sales = data.sales ?? [];
  const days = data.days ?? [];
  const conv = partnerConversion(totals.sales, totals.clicks);
  const showRevenue = data.shows_revenue && totals.revenue !== null && totals.revenue !== undefined;
  const maxDay = Math.max(1, ...days.map((d) => d.clicks));
  const place = [ev.location_name || ev.host_name, ev.location_city].filter(Boolean).join(', ');
  const when = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(ev.start_at));
  const hour = formatInTimeZone(new Date(ev.start_at), tz, 'HH:mm');
  const endHour = ev.end_at ? formatInTimeZone(new Date(ev.end_at), tz, 'HH:mm') : null;
  const closes = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', timeZone: tz }).format(new Date(data.closes_at!));
  const dayLabel = (d: string) => new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)).replace('.', '');

  const tiles: { key: string; label: string; value: string; accent?: boolean; muted?: boolean }[] = [
    { key: 'c', label: t('clicks'), value: String(totals.clicks) },
    { key: 's', label: t('sales'), value: String(totals.sales), accent: totals.sales > 0 },
    ...(showRevenue ? [{ key: 'r', label: t('revenue'), value: money.format(Number(totals.revenue) || 0) }] : []),
    { key: 'v', label: t('conversion'), value: conv === null ? '—' : `${conv.toLocaleString(loc)} %`, muted: conv === null },
  ];

  return (
    <div style={page} lang={pageLang}>
      <Seo title={`${ev.title} · ${data.partner_name}`} noindex />
      <div style={column}>
        {topBar}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ev.poster_url ? (
            <img
              src={ev.poster_url}
              alt=""
              style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 4, border: '1px solid #1F1F22', background: '#141414' }}
            />
          ) : null}
          <span style={mono(11, RED)}>{t('yourNight')}</span>
          <h1 style={{ margin: '-6px 0 0', fontFamily: GROTESK, fontWeight: 700, fontSize: 44, lineHeight: 0.95, letterSpacing: '-0.02em', textTransform: 'uppercase', overflowWrap: 'anywhere' }}>
            {ev.title}
          </h1>
          <span style={{ ...mono(11), lineHeight: 1.6, letterSpacing: '0.1em' }}>
            {when} · {hour}{endHour ? ` → ${endHour}` : ''}
            {place ? <><br />{place}</> : null}
          </span>
        </div>

        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#E5E5E5' }}>
          {(totals.sales > 0 ? t('helloSales') : t('helloEmpty')).replace('{name}', firstName)}
        </p>

        <div style={{ background: '#141414', border: '1px solid #1F1F22', borderRadius: 4, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={mono(10)}>{t('yourLink')}</span>
          <span style={{ fontFamily: MONO, fontSize: 14, color: '#FFFFFF', wordBreak: 'break-all' }}>{link.replace(/^https?:\/\//, '')}</span>
          {data.is_active === false && (
            <span style={{ fontSize: 12, color: '#F2B23C' }}>{t('inactive')}</span>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={copyLink}
              className="active:scale-[0.97] transition-transform"
              style={{ flex: 1, height: 46, border: 0, borderRadius: 999, background: '#FFFFFF', color: '#0A0A0A', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
            >
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? t('copied') : t('copy')}
            </button>
            <button
              type="button"
              onClick={shareLink}
              className="active:scale-[0.97] transition-transform"
              style={{ flex: 1, height: 46, border: '1px solid #3A3A3E', borderRadius: 999, background: 'transparent', color: '#FFFFFF', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
            >
              <Share2 size={15} aria-hidden="true" />{t('share')}
            </button>
          </div>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={mono(10)}>{t('yourNumbers')}</span>
            {updatedAt && (
              <span style={{ ...mono(10), letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22C55E' }} aria-hidden="true" />
                {t('live')} · {formatInTimeZone(updatedAt, tz, 'HH:mm')}
              </span>
            )}
          </div>
          <div
            style={{
              display: 'grid', gridTemplateColumns: `repeat(${tiles.length === 4 ? 2 : 3}, minmax(0, 1fr))`,
              gap: 1, background: '#1F1F22', border: '1px solid #1F1F22', borderRadius: 4, overflow: 'hidden',
            }}
          >
            {tiles.map((tile) => (
              <div key={tile.key} style={{ background: '#0F0F10', padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <span style={mono(10)}>{tile.label}</span>
                <span style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: tiles.length === 4 ? 36 : 32, lineHeight: 1, letterSpacing: '-0.02em', color: tile.accent ? RED : tile.muted ? '#5A5A5E' : '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {tile.value}
                </span>
              </div>
            ))}
          </div>
          {totals.sales > 0 && (
            <span style={{ fontSize: 12, lineHeight: 1.5, color: '#9A9A9A' }}>
              {t('numbersHint').replace('{sales}', String(totals.sales)).replace('{clicks}', String(totals.clicks))}
              {showRevenue ? ` ${t('revenueHint')}` : ''}
            </span>
          )}
        </section>

        {days.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono(10)}>{t('last7')}</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96, borderBottom: '1px solid #1F1F22', paddingBottom: 2 }} role="img" aria-label={t('last7')}>
              {days.map((d, i) => (
                <div key={d.day} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: '#9A9A9A' }}>{d.clicks}</span>
                  <div style={{ width: '100%', height: Math.max(2, Math.round((d.clicks / maxDay) * 70)), borderRadius: '2px 2px 0 0', background: i === days.length - 1 ? RED : '#2A2A2E' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {days.map((d) => (
                <span key={d.day} style={{ flex: 1, textAlign: 'center', ...mono(9, '#5A5A5E'), letterSpacing: '0.08em' }}>{dayLabel(d.day)}</span>
              ))}
            </div>
          </section>
        )}

        <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 8 }}>
            <h2 style={{ margin: 0, fontFamily: GROTESK, fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em', textTransform: 'uppercase' }}>{t('yourSales')}</h2>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#9A9A9A' }}>{sales.length}</span>
          </div>
          {sales.length === 0 ? (
            <div style={{ border: '1px dashed #2A2A2E', borderRadius: 4, padding: '26px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{t('noSalesTitle')}</span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: '#9A9A9A' }}>{t('noSalesBody')}</span>
            </div>
          ) : (
            sales.map((s, i) => (
              <SaleRow key={`${s.at}-${i}`} sale={s} tz={tz} loc={loc} money={money} showRevenue={!!showRevenue} t={t} />
            ))
          )}
        </section>

        <div style={{ borderTop: '1px solid #1F1F22', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, lineHeight: 1.5, color: '#9A9A9A' }}>{t('keepPrivate').replace('{date}', closes)}</span>
          {data.owner_name && (
            <span style={{ ...mono(10, '#5A5A5E'), letterSpacing: '0.12em' }}>{t('partnerOf').replace('{owner}', data.owner_name)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SaleRow({ sale, tz, loc, money, showRevenue, t }: {
  sale: PartnerPageSale;
  tz: string;
  loc: string;
  money: Intl.NumberFormat;
  showRevenue: boolean;
  t: PartnerWords;
}) {
  const qty = sale.qty ?? 1;
  const what = sale.kind === 'table'
    ? `${t('kind.table')}${sale.item ? ` · ${sale.item}` : ''}${sale.qty ? ` · ${t('guests').replace('{n}', String(sale.qty))}` : ''}`
    : sale.kind === 'guestlist'
      ? t('kind.guestlist')
      : sale.kind === 'order'
        ? t('kind.order')
        : `${(qty > 1 ? t('tickets') : t('ticket')).replace('{n}', String(qty))}${sale.item ? ` · ${sale.item}` : ''}`;
  const when = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(sale.at));
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderTop: '1px solid #1A1A1C' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: '#FFFFFF' }}>{sale.buyer || t('someone')}</span>
        <span style={{ ...mono(10), letterSpacing: '0.1em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{what}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {showRevenue && sale.amount !== null && sale.kind !== 'guestlist' && (
          <span style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 16 }}>{money.format(Number(sale.amount) || 0)}</span>
        )}
        <span style={{ ...mono(10, '#5A5A5E'), letterSpacing: '0.08em' }}>{when}</span>
      </div>
    </div>
  );
}
