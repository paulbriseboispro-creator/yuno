import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import {
  Eye, Users, MousePointerClick, Crown, TrendingUp, TrendingDown, Minus,
  Smartphone, Monitor, Tablet, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Rapport Club public (/r/:token) — lecture seule, agrégats uniquement.
 * C'est le document que l'agence envoie au manager du club : audience 30 jours
 * portée par l'agence, signée « powered by Yuno ». Un lecteur = un futur
 * client Yuno potentiel.
 */

type ReportPeriod = {
  views: number;
  unique_visitors: number;
  ticket_clicks: number;
  booking_clicks: number;
  yuno_share?: number;
};

type Report = {
  venue: { name: string; city: string | null; neighborhood: string | null; cover: string | null };
  agency: { name: string; city: string | null; logo: string | null; slug: string | null };
  generated_at: string;
  current: ReportPeriod;
  previous: ReportPeriod;
  top_events: { name: string; date: string; views: number; clicks: number }[];
  sources: { category: string; views: number }[];
  devices: { device: string; views: number }[];
};

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const RED = '#E8192C';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

const DEVICE_ICONS: Record<string, LucideIcon> = { mobile: Smartphone, desktop: Monitor, tablet: Tablet };

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return current > 0
      ? <span className="inline-flex items-center gap-0.5" style={{ color: '#34D399', fontSize: 11, fontWeight: 600 }}><TrendingUp className="h-3 w-3" />+∞</span>
      : <span style={{ color: T3, fontSize: 11 }}><Minus className="h-3 w-3 inline" /></span>;
  }
  const pct = ((current - previous) / previous) * 100;
  const Icon = pct > 2 ? TrendingUp : pct < -2 ? TrendingDown : Minus;
  const color = pct > 2 ? '#34D399' : pct < -2 ? '#F87171' : T3;
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums" style={{ color, fontSize: 11, fontWeight: 600 }}>
      <Icon className="h-3 w-3" />{pct > 0 ? '+' : ''}{pct.toFixed(0)}%
    </span>
  );
}

export default function ClubReport() {
  const { token } = useParams<{ token: string }>();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('get_affiliate_venue_report', { p_token: token });
      if (active) {
        setReport((data as unknown as Report | null) ?? null);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: '#000' }}>
        <p style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{t('aff.report.notFound')}</p>
        <p style={{ color: T3, fontSize: 13 }}>{t('aff.report.notFoundDesc')}</p>
      </div>
    );
  }

  const maxSource = Math.max(...report.sources.map(s => s.views), 1);
  const totalDeviceViews = Math.max(report.devices.reduce((s, d) => s + d.views, 0), 1);
  const kpis: { icon: LucideIcon; label: string; cur: number; prev: number }[] = [
    { icon: Eye, label: t('aff.report.views'), cur: report.current.views, prev: report.previous.views },
    { icon: Users, label: t('aff.report.uniqueVisitors'), cur: report.current.unique_visitors, prev: report.previous.unique_visitors },
    { icon: MousePointerClick, label: t('aff.report.ticketClicks'), cur: report.current.ticket_clicks, prev: report.previous.ticket_clicks },
    { icon: Crown, label: t('aff.report.bookingClicks'), cur: report.current.booking_clicks, prev: report.previous.booking_clicks },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.06),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[880px] px-4 sm:px-6 py-10 space-y-6">
        {/* En-tête : l'agence signe, le club est le sujet */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {report.agency.logo ? (
              <img src={report.agency.logo} alt={report.agency.name}
                className="w-12 h-12 rounded-xl object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
            ) : (
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-none"
                style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)' }}>
                <span style={{ color: RED, fontSize: 18, fontWeight: 800 }}>{report.agency.name[0]}</span>
              </div>
            )}
            <div className="min-w-0">
              <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>
                {report.agency.name}{report.agency.city ? ` · ${report.agency.city}` : ''}
              </p>
              <h1 style={{ color: T1, fontSize: 'clamp(22px,4vw,30px)', fontWeight: 750, letterSpacing: '-0.025em', lineHeight: 1.15 }}>
                {t('aff.report.title')} — {report.venue.name}
              </h1>
              <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
                {t('aff.report.period')} · {t('aff.report.generatedOn')}{' '}
                {format(new Date(report.generated_at), 'd MMM yyyy', { locale: dateLocale })}
              </p>
            </div>
          </div>
        </div>

        {/* KPI + delta vs 30 jours précédents */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map(({ icon: Icon, label, cur, prev }) => (
            <div key={label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px' }}>
              <div className="flex items-center gap-2 mb-2" style={{ color: T3, fontSize: 11.5 }}>
                <Icon className="h-4 w-4" style={{ color: T2 }} />
                {label}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {cur.toLocaleString()}
                </span>
                <Delta current={cur} previous={prev} />
              </div>
            </div>
          ))}
        </div>

        {/* Part Yuno : ce que la marketplace apporte en plus des canaux agence */}
        {(report.current.yuno_share ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap"
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '14px 18px' }}>
            <div className="flex items-center gap-3 min-w-0">
              <img src="/yuno-icon-192.png" alt="Yuno" className="w-8 h-8 rounded-lg flex-none" />
              <p style={{ color: T2, fontSize: 12.5 }}>{t('aff.report.yunoShareDesc')}</p>
            </div>
            <span className="tabular-nums flex-none" style={{ color: RED, fontSize: 20, fontWeight: 700 }}>
              {report.current.yuno_share}%
            </span>
          </div>
        )}

        {/* Top soirées */}
        {report.top_events.length > 0 && (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 18 }}>
            <h2 style={{ color: T1, fontSize: 14.5, fontWeight: 650, marginBottom: 12 }}>{t('aff.report.topEvents')}</h2>
            <div className="space-y-2">
              {report.top_events.map((ev, i) => (
                <div key={`${ev.name}-${ev.date}`} className="flex items-center gap-3"
                  style={{ padding: '8px 0', borderTop: i > 0 ? `1px solid rgba(255,255,255,0.05)` : 'none' }}>
                  <span className="flex-none tabular-nums text-center" style={{ color: i === 0 ? RED : T3, fontSize: 12.5, fontWeight: 700, width: 18 }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{ev.name}</p>
                    <p style={{ color: T3, fontSize: 11 }}>{format(new Date(`${ev.date}T12:00:00`), 'd MMM yyyy', { locale: dateLocale })}</p>
                  </div>
                  <div className="flex items-center gap-4 flex-none tabular-nums">
                    <span style={{ color: T2, fontSize: 12.5 }}><Eye className="h-3.5 w-3.5 inline mr-1" style={{ color: T3 }} />{ev.views}</span>
                    <span style={{ color: T2, fontSize: 12.5 }}><MousePointerClick className="h-3.5 w-3.5 inline mr-1" style={{ color: T3 }} />{ev.clicks}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sources + appareils */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {report.sources.length > 0 && (
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 18 }}>
              <h2 style={{ color: T1, fontSize: 14.5, fontWeight: 650, marginBottom: 12 }}>{t('aff.report.sources')}</h2>
              <div className="space-y-2.5">
                {report.sources.map(s => (
                  <div key={s.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ color: T2, fontSize: 12 }}>{t(`aff.report.src.${s.category}`) === `aff.report.src.${s.category}` ? s.category : t(`aff.report.src.${s.category}`)}</span>
                      <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{s.views.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                      <div style={{ height: 5, borderRadius: 3, width: `${(s.views / maxSource) * 100}%`, background: RED, opacity: 0.85 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.devices.length > 0 && (
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 18 }}>
              <h2 style={{ color: T1, fontSize: 14.5, fontWeight: 650, marginBottom: 12 }}>{t('aff.report.devices')}</h2>
              <div className="space-y-3">
                {report.devices.map(d => {
                  const Icon = DEVICE_ICONS[d.device] ?? Monitor;
                  const pct = Math.round((d.views / totalDeviceViews) * 100);
                  return (
                    <div key={d.device} className="flex items-center gap-3">
                      <Icon className="h-4 w-4 flex-none" style={{ color: T2 }} />
                      <div className="flex-1" style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                        <div style={{ height: 5, borderRadius: 3, width: `${pct}%`, background: 'rgba(255,255,255,0.35)' }} />
                      </div>
                      <span className="tabular-nums flex-none" style={{ color: T2, fontSize: 12 }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Pied : la signature Yuno — chaque lecteur est un prospect */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2"
          style={{ borderTop: `1px solid rgba(255,255,255,0.06)` }}>
          <p style={{ color: T3, fontSize: 11.5 }}>
            {t('aff.report.footer').replace('{agency}', report.agency.name)}
          </p>
          <a href="https://yunoapp.eu" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 flex-none transition-opacity hover:opacity-80"
            style={{ textDecoration: 'none' }}>
            <img src="/yuno-icon-192.png" alt="Yuno" className="w-5 h-5 rounded" />
            <span style={{ color: T2, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>YUNO</span>
          </a>
        </div>
      </div>
    </div>
  );
}
