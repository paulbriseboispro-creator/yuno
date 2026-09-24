/**
 * Les trois dernières questions du Rapport de soirée :
 *   - « Est-ce qu'on voit ma soirée ? »  (ReportTraffic)
 *   - « Qui achète ? »                    (ReportAudience)
 *   - « Qu'est-ce qui a fait vendre ? »   (ReportDrivers)
 */
import type { ReactNode } from 'react';
import { Bell, Link2, Mail } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { conversionPct, share, visitSourceLabel, type EventReport } from '@/lib/eventReport';
import { CardTitle, EmptyNote, RankRow, ReportCard } from './ui';

const KNOWN_CHANNELS = ['venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct', 'manual', 'other'];


// ── 3. Est-ce qu'on voit ma soirée ? ───────────────────────────────────────

export function ReportTraffic({ report }: { report: EventReport }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const v = report.totals.visits;
  const conv = conversionPct(v.withOrder, v.total);
  const top = Math.max(1, ...report.visitSources.map((s) => s.sessions));
  return (
    <ReportCard>
      <CardTitle title={t('er.reach.sources')} hint={t('gl.visits')} />
      {report.visitSources.length === 0 ? (
        <EmptyNote text={t('er.reach.empty')} />
      ) : (
        <div className="space-y-3">
          {report.visitSources.map((s) => (
            <RankRow
              key={s.source}
              label={visitSourceLabel(s.source, t)}
              value={t('er.reach.sessions').replace('{n}', n(s.sessions))}
              note={s.orders > 0 ? t('er.reach.orders').replace('{n}', n(s.orders)) : undefined}
              share={(s.sessions / top) * 100}
            />
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'rgb(var(--ink)/0.055)' }}>
        <span style={{ color: KIT.T2, fontSize: 12.5 }}>
          {conv !== null
            ? t('er.reach.conversion').replace('{pct}', String(conv).replace('.', t('er.decimal'))).replace('{n}', n(v.withOrder)).replace('{total}', n(v.total))
            : t('er.reach.noVisits')}
        </span>
      </div>
      <p className="mt-2" style={{ color: KIT.T3, fontSize: 11 }}>{t('er.reach.consent')}</p>
    </ReportCard>
  );
}

// ── 4. Qui achète ? ────────────────────────────────────────────────────────

export function ReportAudience({ report, demographics }: { report: EventReport; demographics?: ReactNode }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const a = report.audience;
  const newShare = share(a.new, a.people);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <ReportCard>
        <CardTitle title={t('er.who.title')} hint={t('er.who.hint')} />
        {a.people === 0 ? (
          <EmptyNote text={t('er.who.empty')} />
        ) : (
          <>
            <div className="flex items-end gap-6">
              <div>
                <div className="tabular-nums" style={{ color: KIT.T1, fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1 }}>{n(a.new)}</div>
                <div style={{ color: KIT.T3, fontSize: 12, marginTop: 4 }}>{t('er.who.new')}</div>
              </div>
              <div>
                <div className="tabular-nums" style={{ color: KIT.T2, fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{n(a.returning)}</div>
                <div style={{ color: KIT.T3, fontSize: 12, marginTop: 4 }}>{t('er.who.returning')}</div>
              </div>
            </div>
            {/* Barre en deux parts, séparées par un filet de la couleur du fond. */}
            <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full" style={{ gap: 2, background: 'transparent' }} aria-hidden>
              <div style={{ width: `${newShare ?? 0}%`, background: 'var(--acc-34d399)' }} />
              <div className="flex-1" style={{ background: 'rgb(var(--ink)/0.28)' }} />
            </div>
            <p className="mt-3" style={{ color: KIT.T2, fontSize: 12.5 }}>
              {a.priorEvents === 0
                ? t('er.who.firstEvent')
                : t('er.who.sentence').replace('{pct}', String(newShare ?? 0)).replace('{n}', n(a.priorEvents))}
            </p>
          </>
        )}
      </ReportCard>
      {demographics && <div className="min-w-0">{demographics}</div>}
    </div>
  );
}

// ── 5. Qu'est-ce qui a fait vendre ? ───────────────────────────────────────

export function ReportDrivers({ report }: { report: EventReport }) {
  const { t, language } = useLanguage();
  const { n, eur } = useNumberFormat();
  const totalN = report.channels.reduce((s, c) => s + c.n, 0);
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <ReportCard>
          <CardTitle title={t('er.what.channels')} hint={t('er.what.channelsHint')} />
          {report.channels.length === 0 ? (
            <EmptyNote text={t('er.what.noSales')} />
          ) : (
            <div className="space-y-3">
              {report.channels.map((c) => (
                <RankRow
                  key={c.source}
                  label={KNOWN_CHANNELS.includes(c.source) ? t(`pb.src.${c.source}`) : c.source}
                  value={`${share(c.n, totalN) ?? 0} %`}
                  note={c.amount !== null && c.amount > 0 ? eur(c.amount) : t('er.what.sales').replace('{n}', n(c.n))}
                  share={share(c.n, totalN)}
                  color="#E8192C"
                />
              ))}
            </div>
          )}
        </ReportCard>

        <ReportCard>
          <CardTitle title={t('er.what.links')} hint={t('er.what.linksHint')} />
          {report.links.length === 0 ? (
            <EmptyNote text={t('er.what.noLinks')} />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--ink)/0.055)' }}>
              {report.links.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-[13px]" style={{ borderColor: 'rgb(var(--ink)/0.055)' }}>
                  <span className="flex min-w-0 items-center gap-2" style={{ color: KIT.T1 }}>
                    <Link2 className="h-3.5 w-3.5 flex-none" style={{ color: KIT.T3 }} aria-hidden />
                    <span className="truncate">{l.label}</span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums" style={{ color: KIT.T2 }}>
                    {t('er.what.linkLine').replace('{clicks}', n(l.clicks)).replace('{sales}', n(l.n + l.entries))}
                    {l.amount !== null && l.amount > 0 && <span style={{ color: KIT.T1, fontWeight: 600 }}> · {eur(l.amount)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      </div>

      <ReportCard>
        <CardTitle title={t('er.what.messages')} hint={t('er.what.messagesHint')} />
        {report.messages.length === 0 ? (
          <EmptyNote text={t('er.what.noMessages')} />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr style={{ color: KIT.T3, fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  <th className="px-2 pb-2 text-left font-semibold">{t('er.msg.message')}</th>
                  <th className="px-2 pb-2 text-right font-semibold">{t('er.msg.reach')}</th>
                  <th className="px-2 pb-2 text-right font-semibold">{t('er.msg.opens')}</th>
                  <th className="px-2 pb-2 text-right font-semibold">{t('er.msg.clicks')}</th>
                  <th className="px-2 pb-2 text-right font-semibold">{t('er.msg.results')}</th>
                  {report.money && <th className="px-2 pb-2 text-right font-semibold">{t('er.msg.revenue')}</th>}
                </tr>
              </thead>
              <tbody>
                {report.messages.map((m) => {
                  const Icon = m.kind === 'email' ? Mail : Bell;
                  const title = m.kind === 'push' && m.templateKey === 'new_event'
                    ? t('er.msg.publication').replace('{title}', report.event.title)
                    : m.title ?? t(`er.msg.kind.${m.kind}`);
                  const results = m.orders + m.entries;
                  return (
                    <tr key={`${m.kind}:${m.id}`} style={{ borderTop: '1px solid rgb(var(--ink)/0.055)' }}>
                      <td className="px-2 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className="h-3.5 w-3.5 flex-none" style={{ color: KIT.T3 }} aria-hidden />
                          <div className="min-w-0">
                            <div className="truncate" style={{ color: KIT.T1, fontWeight: 560, maxWidth: 320 }}>{title}</div>
                            <div style={{ color: KIT.T3, fontSize: 11 }}>
                              {t(`er.msg.kind.${m.kind}`)}{m.auto ? ` · ${t('er.msg.auto')}` : ''}{m.sentAt ? ` · ${dateFmt.format(new Date(m.sentAt))}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: KIT.T2 }}>{n(m.reach)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: KIT.T2 }}>
                        {m.opens === null ? '—' : `${n(m.opens)}${m.reach > 0 ? ` (${share(m.opens, m.reach)} %)` : ''}`}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: KIT.T2 }}>{n(m.clicks)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: results > 0 ? KIT.T1 : KIT.T3, fontWeight: results > 0 ? 600 : 400 }}>
                        {results > 0 ? t('er.msg.resultsValue').replace('{n}', n(results)) : '—'}
                      </td>
                      {report.money && (
                        <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: (m.amount ?? 0) > 0 ? KIT.T1 : KIT.T3, fontWeight: (m.amount ?? 0) > 0 ? 600 : 400 }}>
                          {(m.amount ?? 0) > 0 ? eur(m.amount ?? 0) : '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3" style={{ color: KIT.T3, fontSize: 11 }}>{t('er.what.messagesNote')}</p>
      </ReportCard>
    </div>
  );
}
