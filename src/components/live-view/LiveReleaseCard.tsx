import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Eye, Flame } from 'lucide-react';
import type { LiveRelease } from '@/lib/liveView';
import { fmtInt } from '@/lib/liveView';
import { BigNumber, Label, LV, Muted, SectionTitle, ThinBar } from './liveViewUi';

/**
 * Suivi de la release : la soirée qui vend le plus depuis une heure (ou la
 * prochaine à billetterie). Billets sur 10 min / 60 min / aujourd'hui, une
 * courbe de 60 barres (une par minute) et l'état de chaque palier.
 */
export function LiveReleaseCard({ release, language, t, compact = false }: {
  release: LiveRelease | null;
  language: string;
  t: (k: string) => string;
  compact?: boolean;
}) {
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const hot = !!release && release.sales60m > 0;

  if (!release) {
    return (
      <div style={{ background: LV.innerBg, border: `1px solid ${LV.border}`, borderRadius: 14, padding: '16px 18px' }}>
        <SectionTitle>{t('lv.releaseNext')}</SectionTitle>
        <p className="m-0 mt-2 text-[13px]" style={{ color: LV.t3 }}>{t('lv.release.none')}</p>
      </div>
    );
  }

  const series = release.series?.length ? release.series : new Array<number>(60).fill(0);
  const max = Math.max(1, ...series);
  const start = new Date(release.startAt);
  const dateLabel = format(start, language === 'en' ? 'EEE d MMM · HH:mm' : 'EEE d MMM · HH:mm', { locale });

  const stats: Array<[number, string]> = [
    [release.sales10m, t('lv.release.10m')],
    [release.sales60m, t('lv.release.60m')],
    [release.salesToday, t('lv.release.today')],
  ];

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: compact
          ? 'linear-gradient(180deg,rgba(255,255,255,.06) 0%,rgba(255,255,255,.02) 100%),rgba(10,10,12,0.82)'
          : LV.innerBg,
        backdropFilter: compact ? 'blur(14px)' : undefined,
        WebkitBackdropFilter: compact ? 'blur(14px)' : undefined,
        border: `1px solid ${hot ? 'rgba(232,25,44,0.22)' : LV.border}`,
        borderRadius: 14,
        boxShadow: compact ? LV.shadow : undefined,
        padding: compact ? '14px 16px' : '16px 18px',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {hot && <Flame className="h-3.5 w-3.5 flex-none" style={{ color: LV.red }} aria-hidden="true" />}
          <Label color={hot ? LV.red : LV.t3}>{hot ? t('lv.release') : t('lv.releaseNext')}</Label>
        </div>
        <span className="inline-flex flex-none items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" style={{ color: LV.t3 }} aria-hidden="true" />
          <Muted color={LV.t2} className="tabular-nums">{fmtInt(release.viewersNow, language)} {t('lv.release.watching')}</Muted>
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {release.poster && !compact && (
          <img
            src={release.poster}
            alt=""
            loading="lazy"
            className="flex-none rounded-lg object-cover"
            style={{ width: 44, height: 44, border: `1px solid ${LV.border}` }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p
            className="m-0 truncate font-semibold"
            style={{ fontSize: compact ? 15 : 16, color: LV.t1, letterSpacing: '-0.01em', lineHeight: 1.2 }}
            title={release.title}
          >
            {release.title}
          </p>
          <Muted className="mt-0.5 block capitalize">{dateLabel}</Muted>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map(([n, label], i) => (
          <div
            key={label}
            className="min-w-0"
            style={i === 0 && n > 0
              ? { background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.22)', borderRadius: 12, padding: '8px 10px' }
              : { background: LV.tileBg, border: `1px solid ${LV.border}`, borderRadius: 12, padding: '8px 10px' }}
          >
            <BigNumber value={n} format={(v) => fmtInt(v, language)} size={compact ? '20px' : '22px'} />
            <Label className="mt-1 block" size={9.5}>{label}</Label>
          </div>
        ))}
      </div>

      {/* Courbe : billets par minute, 60 dernières minutes */}
      <div className="mt-3" aria-label={t('lv.release.sparkline')} role="img">
        <svg viewBox="0 0 120 32" preserveAspectRatio="none" width="100%" height={compact ? 28 : 36} style={{ display: 'block' }}>
          <line x1="0" y1="31.5" x2="120" y2="31.5" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          {series.map((n, i) => {
            const h = n > 0 ? Math.max(2, (n / max) * 30) : 0.8;
            const isLast = i === series.length - 1;
            return (
              <rect
                key={i}
                x={i * 2 + 0.3}
                y={31 - h}
                width={1.4}
                height={h}
                rx={0.5}
                fill={n > 0 ? (isLast ? LV.red : LV.cMid) : 'rgba(255,255,255,0.08)'}
                style={{ transition: `y 0.4s ${LV.ease}, height 0.4s ${LV.ease}` }}
              />
            );
          })}
        </svg>
        <Muted className="mt-1 block" size={11}>{t('lv.release.sparkline')}</Muted>
      </div>

      {/* Paliers */}
      {release.rounds.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {release.rounds.slice(0, compact ? 3 : 6).map((r) => {
            const pct = r.max > 0 ? (r.sold / r.max) * 100 : 0;
            const closed = !r.active && !r.soldOut;
            return (
              <div key={r.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[12.5px] font-medium" style={{ color: closed ? LV.t3 : LV.t2 }}>{r.name}</span>
                  <span className="flex-none text-[12.5px] tabular-nums" style={{ color: r.soldOut ? LV.red : LV.t1, fontWeight: 600 }}>
                    {r.soldOut ? t('lv.round.soldOut') : `${fmtInt(r.sold, language)} / ${fmtInt(r.max, language)}`}
                  </span>
                </div>
                <div className="mt-1.5">
                  <ThinBar pct={r.soldOut ? 100 : pct} accent={r.soldOut || pct > 80} height={4} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!compact && (
        <Muted className="mt-3 block tabular-nums">
          {fmtInt(release.salesTotal, language)} {t('lv.release.total')}
        </Muted>
      )}
    </div>
  );
}
