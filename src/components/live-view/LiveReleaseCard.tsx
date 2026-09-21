import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Eye } from 'lucide-react';
import type { LiveRelease } from '@/lib/liveView';
import { fmtInt } from '@/lib/liveView';
import { BigNumber, Kicker, LV, Mono, ThinBar } from './liveViewUi';

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
      <div style={{ background: LV.card, border: `1px solid ${LV.border}`, borderRadius: 4, padding: '16px 18px' }}>
        <Kicker>{t('lv.releaseNext')}</Kicker>
        <p className="m-0 mt-3 text-[13px]" style={{ color: LV.gray2 }}>{t('lv.release.none')}</p>
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
        background: compact ? 'rgba(10,10,10,0.78)' : LV.card,
        backdropFilter: compact ? 'blur(14px)' : undefined,
        WebkitBackdropFilter: compact ? 'blur(14px)' : undefined,
        border: `1px solid ${hot ? 'rgba(232,25,44,0.32)' : LV.border}`,
        borderRadius: 4,
        padding: compact ? '14px 16px' : '18px 20px',
      }}
    >
      <Kicker
        right={
          <span className="inline-flex items-center gap-1.5">
            <Eye className="h-3 w-3" style={{ color: LV.gray3 }} aria-hidden="true" />
            <Mono color={LV.gray2}>{fmtInt(release.viewersNow, language)} {t('lv.release.watching')}</Mono>
          </span>
        }
      >
        {hot ? t('lv.release') : t('lv.releaseNext')}
      </Kicker>

      <div className="mt-3 flex items-start gap-3">
        {release.poster && !compact && (
          <img
            src={release.poster}
            alt=""
            loading="lazy"
            className="flex-none object-cover"
            style={{ width: 44, height: 44, borderRadius: 2, border: `1px solid ${LV.border}` }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p
            className="m-0 font-display font-bold uppercase truncate"
            style={{ fontSize: compact ? 15 : 'clamp(16px, 2vw, 20px)', color: LV.white, letterSpacing: '-0.015em', lineHeight: 1.05 }}
            title={release.title}
          >
            {release.title}
          </p>
          <Mono className="mt-1 block" color={LV.gray2} size={10}>{dateLabel}</Mono>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {stats.map(([n, label], i) => (
          <div key={label}>
            <BigNumber value={n} format={(v) => fmtInt(v, language)} size={compact ? '24px' : 'clamp(24px, 3vw, 32px)'} color={i === 0 && n > 0 ? LV.red : LV.white} />
            <Mono className="mt-1 block" color={LV.gray3} size={9.5} tracking="0.14em">{label}</Mono>
          </div>
        ))}
      </div>

      {/* Courbe : billets par minute, 60 dernières minutes */}
      <div className="mt-4" aria-label={t('lv.release.sparkline')} role="img">
        <svg viewBox="0 0 120 32" preserveAspectRatio="none" width="100%" height={compact ? 28 : 36} style={{ display: 'block' }}>
          <line x1="0" y1="31.5" x2="120" y2="31.5" stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
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
                fill={n > 0 ? (isLast ? LV.red : 'rgba(232,25,44,0.62)') : 'rgba(255,255,255,0.10)'}
                style={{ transition: `y 0.4s ${LV.ease}, height 0.4s ${LV.ease}` }}
              />
            );
          })}
        </svg>
        <Mono className="mt-1 block" color={LV.gray3} size={9.5} tracking="0.12em">{t('lv.release.sparkline')}</Mono>
      </div>

      {/* Paliers */}
      {release.rounds.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {release.rounds.slice(0, compact ? 3 : 6).map((r) => {
            const pct = r.max > 0 ? (r.sold / r.max) * 100 : 0;
            const closed = !r.active && !r.soldOut;
            return (
              <div key={r.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <Mono color={closed ? LV.gray3 : LV.gray1} size={10.5} className="truncate">{r.name}</Mono>
                  <Mono color={r.soldOut ? LV.red : LV.gray2} size={10.5} className="flex-none tabular-nums">
                    {r.soldOut ? t('lv.round.soldOut') : `${fmtInt(r.sold, language)} / ${fmtInt(r.max, language)}`}
                  </Mono>
                </div>
                <div className="mt-1.5">
                  <ThinBar pct={r.soldOut ? 100 : pct} accent={r.soldOut || pct > 80} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!compact && (
        <Mono className="mt-4 block" color={LV.gray3} size={9.5} tracking="0.12em">
          {fmtInt(release.salesTotal, language)} {t('lv.release.total')}
        </Mono>
      )}
    </div>
  );
}
