/**
 * Historique des push de la Console (club et organisateur) — la page
 * « Campagnes » de Shotgun, en mieux : toutes les campagnes (plus de limite à
 * 20), filtres, ouvertures, acheteurs et CA attribués par campagne. Tous les
 * chiffres viennent de `get_push_campaigns` ; ce composant ne compte rien.
 */
import { useState } from 'react';
import { Bell, CalendarClock, ChevronLeft, ChevronRight, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { MetricHint, UpdatedAt } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, ReportCard, Segmented } from '@/components/event-report/ui';
import { INNER_BG } from '@/components/event-report/tokens';
import { campaignLabel, openRate, type PushCampaignRow, type PushCampaignsPage, type PushFilter } from '@/lib/pushHistory';

const RED_SOFT = 'rgba(232,25,44,0.1)';
const RED_LINE = 'rgba(232,25,44,0.25)';
const AMBER = 'var(--acc-fcd34d)';

interface Props {
  data: PushCampaignsPage | null;
  loading: boolean;
  error: 'forbidden' | 'error' | null;
  fetchedAt: Date | null;
  filter: PushFilter;
  onFilter: (f: PushFilter) => void;
  page: number;
  onPage: (p: number) => void;
  pageSize: number;
  onChanged: () => void;
}

export default function PushHistoryCard({ data, loading, error, fetchedAt, filter, onFilter, page, onPage, pageSize, onChanged }: Props) {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const fmtRate = (pct: number | null) => (pct == null ? '—' : pctFmt(pct, locale));
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const money = !!data?.money;
  const rows = data?.campaigns ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  const dateFmt = (iso: string) => new Intl.DateTimeFormat(locale, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));

  const cancel = async (id: string) => {
    setCancellingId(id);
    try {
      const { data: ok, error: rpcError } = await supabase.rpc('cancel_scheduled_push_campaign' as never, { p_campaign_id: id } as never);
      if (rpcError) throw rpcError;
      if (ok) { toast.success(t('ownerPush.scheduleCancelled')); onChanged(); }
      else toast.error(t('ownerPush.scheduleCancelTooLate'));
    } catch {
      toast.error(t('ownerPush.sendError'));
    } finally {
      setCancellingId(null);
    }
  };

  const s = data?.summary;
  const summaryRate = s ? openRate(s.taps, s.sent) : null;

  return (
    <ReportCard>
      <CardTitle title={t('ph.title')} right={<UpdatedAt at={fetchedAt} />} />

      {/* Les 30 derniers jours, en quatre chiffres */}
      {s && (
        <>
          <p style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
            {t('ph.last30')}
          </p>
          <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Tile label={t('ph.col.campaigns')} value={n(s.campaigns)} />
            <Tile label={t('ph.col.sent')} hint={t('ph.hint.sent')} value={n(s.sent)} />
            <Tile
              label={t('ph.col.opened')}
              hint={t('ph.hint.opened')}
              value={n(s.taps)}
              sub={summaryRate == null ? undefined : t('ph.rateOf').replace('{pct}', pctFmt(summaryRate, locale))}
            />
            {money && s.revenue != null ? (
              <Tile
                label={t('ph.col.revenue')}
                hint={t('ph.hint.revenue')}
                value={eur(s.revenue)}
                sub={t('ph.buyersN').replace('{n}', n(s.buyers))}
              />
            ) : (
              <Tile label={t('ph.col.buyers')} hint={t('ph.hint.buyers')} value={n(s.buyers)} />
            )}
          </div>
        </>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented<PushFilter>
          label={t('ph.filterLabel')}
          value={filter}
          onChange={(v) => { onFilter(v); onPage(0); }}
          options={[
            { value: 'all', label: t('ph.filter.all') },
            { value: 'manual', label: t('ph.filter.manual') },
            { value: 'auto', label: t('ph.filter.auto') },
            { value: 'scheduled', label: t('ph.filter.scheduled') },
          ]}
        />
        {total > 0 && (
          <span className="tabular-nums" style={{ color: KIT.T3, fontSize: 12 }}>
            {t('ph.range').replace('{from}', n(from)).replace('{to}', n(to)).replace('{total}', n(total))}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" style={{ color: KIT.T3 }} /></div>
      ) : error ? (
        <EmptyNote text={error === 'forbidden' ? t('ph.forbidden') : t('ph.error')} />
      ) : rows.length === 0 ? (
        <div className="py-10 text-center">
          <Bell className="mx-auto mb-2 h-8 w-8" style={{ color: 'rgb(var(--ink)/0.12)' }} />
          <p style={{ color: KIT.T3, fontSize: 13 }}>{filter === 'all' ? t('ownerPush.noCampaigns') : t('ph.emptyFilter')}</p>
        </div>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          {/* Grand écran : colonnes fixes */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ color: KIT.T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th className="pb-2 text-left font-semibold">{t('ph.col.notification')}</th>
                  <Th label={t('ph.col.targeted')} hint={t('ph.hint.targeted')} />
                  <Th label={t('ph.col.sent')} hint={t('ph.hint.sent')} />
                  <Th label={t('ph.col.opened')} hint={t('ph.hint.opened')} />
                  <Th label={t('ph.col.rate')} />
                  <Th label={t('ph.col.buyers')} hint={t('ph.hint.buyers')} />
                  {money && <Th label={t('ph.col.revenue')} hint={t('ph.hint.revenue')} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${KIT.BORDER}` }}>
                    <td className="py-3 pr-3 align-top">
                      <NameCell row={r} dateFmt={dateFmt} cancelling={cancellingId === r.id} onCancel={() => cancel(r.id)} />
                    </td>
                    {r.status === 'scheduled' ? (
                      <td colSpan={money ? 6 : 5} className="py-3 text-right align-top" style={{ color: KIT.T3, fontSize: 12 }}>
                        {t('ph.notYetSent')}
                      </td>
                    ) : (
                      <>
                        <Td>{n(r.targeted)}</Td>
                        <Td>{n(r.sent)}</Td>
                        <Td>{n(r.taps)}</Td>
                        <Td muted>{fmtRate(openRate(r.taps, r.sent))}</Td>
                        <Td>{r.buyers > 0 ? n(r.buyers) : <Dash />}{r.entries > 0 && <EntriesNote n={r.entries} />}</Td>
                        {money && <Td strong={(r.revenue ?? 0) > 0}>{(r.revenue ?? 0) > 0 ? eur(r.revenue ?? 0) : <Dash />}</Td>}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : une carte par campagne */}
          <div className="space-y-2.5 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
                <NameCell row={r} dateFmt={dateFmt} cancelling={cancellingId === r.id} onCancel={() => cancel(r.id)} />
                {r.status !== 'scheduled' && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Mini label={t('ph.col.sent')} value={n(r.sent)} />
                    <Mini label={t('ph.col.opened')} value={`${n(r.taps)} · ${fmtRate(openRate(r.taps, r.sent))}`} />
                    {money
                      ? <Mini label={t('ph.col.revenue')} value={(r.revenue ?? 0) > 0 ? eur(r.revenue ?? 0) : '—'} />
                      : <Mini label={t('ph.col.buyers')} value={r.buyers > 0 ? n(r.buyers) : '—'} />}
                  </div>
                )}
              </div>
            ))}
          </div>

          {total > pageSize && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <PageBtn disabled={page === 0 || loading} onClick={() => onPage(page - 1)} label={t('ph.prev')}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </PageBtn>
              <PageBtn disabled={to >= total || loading} onClick={() => onPage(page + 1)} label={t('ph.next')} trailing>
                <ChevronRight className="h-3.5 w-3.5" />
              </PageBtn>
            </div>
          )}
        </div>
      )}

      <p style={{ color: KIT.T3, fontSize: 11.5, marginTop: 14, lineHeight: 1.5 }}>{t('ph.footnote')}</p>
    </ReportCard>
  );
}


function NameCell({ row, dateFmt, cancelling, onCancel }: {
  row: PushCampaignRow; dateFmt: (iso: string) => string; cancelling: boolean; onCancel: () => void;
}) {
  const { t } = useLanguage();
  const label = campaignLabel(row, t);
  const scheduled = row.status === 'scheduled';
  const when = scheduled && row.scheduledAt ? row.scheduledAt : row.createdAt;
  return (
    <div className="min-w-0">
      <p className="truncate" style={{ color: KIT.T1, fontSize: 13.5, fontWeight: 560 }} title={label}>{label}</p>
      {row.body && <p className="truncate" style={{ color: KIT.T3, fontSize: 12, marginTop: 2, maxWidth: '52ch' }} title={row.body}>{row.body}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {row.source === 'auto' && (
          <Badge color="#E8192C" bg={RED_SOFT} line={RED_LINE}><Zap className="h-2.5 w-2.5" />{t('ownerPush.autoBadge')}</Badge>
        )}
        {scheduled && (
          <Badge color={AMBER} bg="rgba(252,211,77,0.08)" line="rgba(252,211,77,0.25)"><CalendarClock className="h-2.5 w-2.5" />{t('ownerPush.scheduledBadge')}</Badge>
        )}
        {row.status === 'failed' && (
          <Badge color="#E8192C" bg={RED_SOFT} line={RED_LINE}>{t('ph.status.failed')}</Badge>
        )}
        {row.status === 'sending' && (
          <Badge color={KIT.T2} bg="rgb(var(--ink)/0.05)" line={KIT.BORDER}>{t('ph.status.sending')}</Badge>
        )}
        {row.eventTitle && !(row.source === 'auto' && row.templateKey === 'new_event') && (
          <span className="truncate" style={{ color: KIT.T3, fontSize: 11, maxWidth: 220 }}>{row.eventTitle}</span>
        )}
        <span className="tabular-nums" style={{ color: KIT.T3, fontSize: 11 }}>{dateFmt(when)}</span>
        {scheduled && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-opacity"
            style={{ background: RED_SOFT, border: `1px solid ${RED_LINE}`, color: '#E8192C', fontSize: 10.5, fontWeight: 600, opacity: cancelling ? 0.5 : 1 }}
          >
            {cancelling && <Loader2 className="h-3 w-3 animate-spin" />}
            {t('ownerPush.cancelSchedule')}
          </button>
        )}
      </div>
    </div>
  );
}

function Badge({ children, color, bg, line }: { children: React.ReactNode; color: string; bg: string; line: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: bg, border: `1px solid ${line}`, color, fontSize: 10, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function Th({ label, hint }: { label: string; hint?: string }) {
  return (
    <th className="whitespace-nowrap pb-2 pl-3 text-right font-semibold">
      <span className="inline-flex items-center gap-1">
        {label}
        {hint && <MetricHint text={hint} label={label} />}
      </span>
    </th>
  );
}

function Td({ children, muted, strong }: { children: React.ReactNode; muted?: boolean; strong?: boolean }) {
  return (
    <td className="whitespace-nowrap py-3 pl-3 text-right align-top tabular-nums" style={{ color: muted ? KIT.T2 : KIT.T1, fontWeight: strong ? 600 : 400 }}>
      {children}
    </td>
  );
}

function Dash() {
  return <span style={{ color: KIT.T3 }}>—</span>;
}

function EntriesNote({ n }: { n: number }) {
  const { t } = useLanguage();
  return <span className="block" style={{ color: KIT.T3, fontSize: 11 }}>{t('ph.entriesN').replace('{n}', String(n))}</span>;
}

function Tile({ label, hint, value, sub }: { label: string; hint?: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
      <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 11 }}>
        {label}
        {hint && <MetricHint text={hint} label={label} />}
      </span>
      <p className="tabular-nums" style={{ color: KIT.T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 4, lineHeight: 1.1 }}>{value}</p>
      {sub && <p className="tabular-nums" style={{ color: KIT.T3, fontSize: 11.5, marginTop: 3 }}>{sub}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p style={{ color: KIT.T3, fontSize: 10.5 }}>{label}</p>
      <p className="truncate tabular-nums" style={{ color: KIT.T1, fontSize: 13, fontWeight: 560, marginTop: 1 }}>{value}</p>
    </div>
  );
}

function PageBtn({ children, disabled, onClick, label, trailing }: {
  children: React.ReactNode; disabled: boolean; onClick: () => void; label: string; trailing?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-opacity"
      style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}`, color: KIT.T2, opacity: disabled ? 0.4 : 1 }}
    >
      {!trailing && children}
      {label}
      {trailing && children}
    </button>
  );
}
