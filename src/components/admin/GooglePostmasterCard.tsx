import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShieldAlert } from 'lucide-react';
import { Card, Pill, POS, NEG, WARN, T2, T3 } from '@/components/admin/ui';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';

interface Sender { key: string; name: string; gmail_sent: number; share: number }
interface Day { day: string; spam: number | null; delivery_error: number | null; auth: number | null; senders: Sender[] | null }
interface Row { requirement: string; status: { status: string } }
interface Domain {
  domain: string; fetched_at: string; last_error: string | null;
  compliance: { complianceData?: { rowData?: Row[] } } | null;
  days: Day[];
}
interface Postmaster { watch: number; limit: number; connected: boolean; domains: Domain[] }

const pct = (v: number | null, digits = 2) => (v == null ? '—' : `${(v * 100).toFixed(digits).replace('.', ',')} %`);

/**
 * Google Postmaster (migration 20261127160000) : le seul endroit où Gmail dit
 * combien de personnes ont cliqué « spam ». Lu chaque matin par le cron
 * gmail-postmaster-daily ; un jour au-dessus de 0,1 % nomme les comptes qui ont
 * écrit à Gmail ce jour-là (part des envois : une estimation, le domaine est partagé).
 */
export function GooglePostmasterCard() {
  const { t, language } = useLanguage();
  const [d, setD] = useState<Postmaster | null>(null);

  useEffect(() => {
    supabase.rpc('admin_gmail_postmaster' as never, { p_days: 60 } as never).then(({ data, error }) => {
      if (!error) setD(data as unknown as Postmaster);
    });
  }, []);

  const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString(language, { day: 'numeric', month: 'short' });
  const worst = Math.max(0, ...(d?.domains ?? []).flatMap((x) => x.days.slice(-7).map((y) => y.spam ?? 0)));
  const tone: 'muted' | 'neg' | 'warn' | 'pos' = !d?.connected ? 'muted' : worst >= (d?.limit ?? 0.003) ? 'neg' : worst >= (d?.watch ?? 0.001) ? 'warn' : 'pos';

  return (
    <Card title={t('adm.system.gpm.title')} subtitle={t('adm.system.gpm.sub')} icon={ShieldAlert}
      right={d && <Pill tone={tone === 'warn' ? 'hot' : tone}>{t(`adm.system.gpm.state.${tone}`)}</Pill>}>
      {d && !d.connected && <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('adm.system.gpm.notConnected')}</p>}
      {d?.domains.map((x) => {
        const series = x.days.slice(-30);
        const top = Math.max(d.limit * 1.4, ...series.map((y) => y.spam ?? 0));
        const flagged = x.days.filter((y) => (y.spam ?? 0) >= d.watch || (y.delivery_error ?? 0) >= 0.02).slice(-6).reverse();
        const rows = x.compliance?.complianceData?.rowData ?? [];
        return (
          <div key={x.domain} style={{ marginBottom: 18 }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p style={{ color: T2, fontSize: 13, fontWeight: 700, margin: 0 }}>{x.domain}</p>
              <span style={{ color: x.last_error ? NEG : T3, fontSize: 11.5 }}>
                {x.last_error ? `${t('adm.system.gpm.error')} : ${x.last_error}` : t('adm.system.gpm.fetched').replace('{t}', fmtRelative(x.fetched_at, language))}
              </span>
            </div>
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-1.5" style={{ margin: '8px 0' }}>
                {rows.map((r) => (
                  <Pill key={r.requirement} tone={r.status?.status === 'COMPLIANT' ? 'pos' : 'neg'}>
                    {t(`adm.system.gpm.req.${r.requirement}`)}
                  </Pill>
                ))}
              </div>
            )}
            {series.length === 0 ? (
              <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('adm.system.gpm.noData')}</p>
            ) : (
              <>
                <div className="relative" style={{ height: 64, display: 'flex', alignItems: 'flex-end', gap: 2, marginTop: 6 }}
                  aria-label={t('adm.system.gpm.chart')}>
                  {[d.watch, d.limit].map((l) => (
                    <div key={l} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(l / top) * 100}%`, borderTop: `1px dashed ${l === d.limit ? NEG : WARN}`, opacity: 0.6 }} />
                  ))}
                  {series.map((y) => {
                    const v = y.spam ?? 0;
                    return (
                      <div key={y.day} title={`${day(y.day)} · ${pct(y.spam)}`}
                        style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (v / top) * 100)}%`, borderRadius: 2,
                          background: v >= d.limit ? NEG : v >= d.watch ? WARN : POS, opacity: v > 0 ? 1 : 0.35 }} />
                    );
                  })}
                </div>
                <div className="flex justify-between" style={{ color: T3, fontSize: 10.5, marginTop: 3 }}>
                  <span>{day(series[0].day)}</span>
                  <span>{t('adm.system.gpm.lines')}</span>
                  <span>{day(series[series.length - 1].day)}</span>
                </div>
              </>
            )}
            {flagged.map((y) => (
              <p key={y.day} style={{ color: T2, fontSize: 12, margin: '6px 0 0', lineHeight: 1.5 }}>
                <span style={{ color: (y.spam ?? 0) >= d.limit ? NEG : WARN }}>●</span>{' '}
                <b>{day(y.day)}</b> · {t('adm.system.gpm.spam')} {pct(y.spam)} · {t('adm.system.gpm.refused')} {pct(y.delivery_error, 1)}
                {y.senders && y.senders.length > 0 && (
                  <span style={{ color: T3 }}>
                    {' · '}{y.senders.map((s) => `${s.name} ${Math.round(s.share * 100)} % (${fmtNum(s.gmail_sent, language)})`).join(', ')}
                  </span>
                )}
              </p>
            ))}
          </div>
        );
      })}
      <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, margin: 0 }}>{t('adm.system.gpm.read')}</p>
    </Card>
  );
}
