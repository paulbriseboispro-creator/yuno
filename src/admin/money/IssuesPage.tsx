/**
 * Argent › À régler (v3) : « Que reste-t-il à régler, et pour quand ? »
 * Rangé par ÉCHÉANCE, pas par type : trois colonnes « Maintenant » (en retard,
 * contesté, alerte déjà arrivée), « Cette semaine », « Plus tard ». Chaque
 * ligne dit le montant, qui doit quoi à qui, depuis quand, et porte son geste :
 *   - alertes (litiges Stripe, ventes payées sans billet, remboursements et
 *     factures en échec, jambes non versées, ventes refusées, ventes tardives
 *     d'un collab) : « Traité » = motif + journal ;
 *   - virements de co-organisation et de collab : reçu / annulé, motif
 *     (admin_resolve_coorg_transfer) ;
 *   - règlements promoteurs contestés ou sans confirmation : lecture seule, le
 *     promoteur confirme lui-même, Yuno ne touche jamais les fonds.
 * Page vide = une bonne nouvelle, dite comme telle. Source : admin_money_issues.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check } from 'lucide-react';
import { ErrorState, Page, ReasonDialog, useAdminFilters, useAdminT, type Tone, Status } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { useIssueActions, useMoneyIssues, type MoneyAlert, type TransferIssue } from './data';
import { issueLink } from './issueLinks';
import { TextLink } from '../pilotage/links';
import { proHref } from '../pilotage/format';
import { DUE_BUCKETS, dueBucket, type DueBucket } from '../pilotage/rules';

type Pending =
  | { kind: 'alert'; row: MoneyAlert }
  | { kind: 'transfer'; row: TransferIssue; outcome: 'received' | 'cancelled' };

interface Line {
  key: string;
  bucket: DueBucket;
  amount: number | null;
  tag: string;
  tone: Tone;
  title: ReactNode;
  who: ReactNode;
  since: string | null;
  due: string | null;
  href: string | null;
  act: ReactNode;
}

const BUCKET_TONE: Record<DueBucket, Tone> = { now: 'negative', week: 'warning', later: 'neutral' };

export default function IssuesPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useMoneyIssues(includeDemo);
  const d = q.data;
  const act = useIssueActions();
  const [pending, setPending] = useState<Pending | null>(null);
  const eur = (v: number) => fmtEur(v, lang);

  const lines = useMemo<Line[]>(() => {
    if (!d) return [];
    const out: Line[] = [];
    d.alerts.forEach((a) => {
      const raw = Number((a.metadata ?? {}).amount);
      out.push({
        key: `a:${a.id}`, bucket: dueBucket({ alert: true }), amount: Number.isFinite(raw) && raw > 0 ? raw : null,
        tag: t(`adm.mon.iss.type.${a.type}`), tone: a.type === 'admin_payment_disputed' ? 'negative' : 'warning',
        title: a.title ?? '—', who: a.message ? <span className="a-t3">{a.message}</span> : null,
        since: a.at, due: null, href: issueLink(a),
        act: <button type="button" className="a-btn a-btn--sm" onClick={() => setPending({ kind: 'alert', row: a })}><Check className="h-3.5 w-3.5" />{t('adm.mon.iss.done')}</button>,
      });
    });
    d.transfers.forEach((x) => {
      out.push({
        key: `t:${x.id}`, bucket: dueBucket({ disputed: x.status === 'disputed', due: x.due_at }), amount: x.amount,
        tag: x.status === 'disputed' ? t('adm.mon.iss.disputed') : x.days_late && x.days_late > 0 ? t('adm.mon.iss.late', { n: fmtNum(x.days_late, lang) }) : t('adm.mon.v3i.transfer'),
        tone: x.status === 'disputed' ? 'negative' : x.days_late && x.days_late > 0 ? 'warning' : 'neutral',
        title: <>{x.event_title ?? '—'}<span className="a-t3"> · {x.source === 'collab' ? t('adm.mon.iss.collab') : t('adm.mon.iss.coorg')}{x.event_date ? ` · ${fmtDate(x.event_date, lang)}` : ''}</span></>,
        who: (
          <span className="flex flex-wrap items-baseline gap-1">
            <TextLink to={proHref(x.from)}>{x.from_name ?? x.from}</TextLink>
            <span className="a-t3">{t('adm.mon.v3i.owes')}</span>
            <TextLink to={proHref(x.to)}>{x.to_name ?? x.to}</TextLink>
            <span className="a-mono a-t3 text-[11px]">· {x.reference}</span>
            {x.dispute_reason && <span className="a-t3">· « {x.dispute_reason} »</span>}
          </span>
        ),
        since: x.disputed_at ?? x.sent_at ?? x.due_at, due: x.due_at, href: null,
        act: (
          <span className="flex gap-1.5">
            <button type="button" className="a-btn a-btn--sm" onClick={() => setPending({ kind: 'transfer', row: x, outcome: 'received' })}>{t('adm.mon.iss.received')}</button>
            <button type="button" className="a-btn a-btn--sm a-btn--ghost" onClick={() => setPending({ kind: 'transfer', row: x, outcome: 'cancelled' })}>{t('adm.mon.iss.cancel')}</button>
          </span>
        ),
      });
    });
    d.payouts.forEach((p) => {
      out.push({
        key: `p:${p.id}`, bucket: dueBucket({ disputed: p.reason === 'disputed', due: p.confirm_due_at }), amount: p.amount,
        tag: t(`adm.mon.iss.payout.${p.reason}`), tone: p.reason === 'disputed' ? 'negative' : 'warning',
        title: <>{t('adm.mon.v3i.payout')}{p.period ? <span className="a-t3"> · {p.period}</span> : null}</>,
        who: (
          <span className="flex flex-wrap items-baseline gap-1">
            <TextLink to={proHref(p.payer_key)}>{p.payer ?? '—'}</TextLink>
            <span className="a-t3">{t('adm.mon.v3i.owes')}</span>
            <span className="a-t1">{p.promoter ?? '—'}</span>
            {p.dispute_reason && <span className="a-t3">· « {p.dispute_reason} »</span>}
          </span>
        ),
        since: p.disputed_at ?? p.created_at, due: p.confirm_due_at, href: proHref(p.payer_key),
        act: <span className="a-t3 text-[12px]">{t('adm.mon.v3i.promoterConfirms')}</span>,
      });
    });
    return out;
  }, [d, t, lang]);

  const byBucket = useMemo(() => {
    const m = new Map<DueBucket, Line[]>(DUE_BUCKETS.map((b) => [b, []]));
    lines.forEach((l) => m.get(l.bucket)!.push(l));
    m.forEach((list) => list.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)));
    return m;
  }, [lines]);

  if (q.error && !d) return <Page title={t('adm.mon.iss.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const atStake = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const nowCount = byBucket.get('now')?.length ?? 0;

  return (
    <Page title={t('adm.mon.iss.title')}>
      {!d ? <div className="flex flex-col gap-3"><div className="a-skel h-12 w-64" /><div className="a-skel h-5 w-96" /></div> : lines.length === 0 ? (
        <section className="flex flex-col gap-3 py-6">
          <span className="a-kicker" style={{ color: 'var(--a-pos)' }}>{t('adm.mon.v3i.clearKicker')}</span>
          <span className="a-hero-value">{t('adm.mon.iss.allClear')}</span>
          <p className="a-hero-sentence max-w-[64ch]">{t('adm.mon.iss.allClearBody')}</p>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <span className="a-kicker">{t('adm.mon.v3i.kicker')}</span>
          <div className="flex flex-wrap items-baseline gap-x-4">
            <span className="a-hero-value">{fmtNum(lines.length, lang)}</span>
            {atStake > 0 && <span className="a-mono a-t2 text-[13px]">{t('adm.mon.v3i.atStake', { eur: fmtEur(atStake, lang, { cents: false }) })}</span>}
          </div>
          <p className="a-hero-sentence max-w-[68ch]">
            {nowCount > 0 ? <><b>{fmtNum(nowCount, lang)}</b> {t(nowCount === 1 ? 'adm.mon.v3i.nowOne' : 'adm.mon.v3i.now')}</> : t('adm.mon.v3i.nothingNow')}
            {' '}{t('adm.mon.v3i.split', { w: fmtNum(byBucket.get('week')?.length ?? 0, lang), l: fmtNum(byBucket.get('later')?.length ?? 0, lang) })}
          </p>
        </section>
      )}

      {d && lines.length > 0 && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 xl:grid-cols-3">
          {DUE_BUCKETS.map((b) => {
            const list = byBucket.get(b) ?? [];
            const sum = list.reduce((s, l) => s + (l.amount ?? 0), 0);
            return (
              <section key={b} className="flex min-w-0 flex-col">
                <div className="flex items-baseline gap-2 border-b pb-2">
                  <Status tone={BUCKET_TONE[b]}><span className="a-kicker" style={{ color: 'inherit' }}>{t(`adm.mon.v3i.b.${b}`)}</span></Status>
                  <span className="a-mono a-t3 text-[11px]">{fmtNum(list.length, lang)}</span>
                  {sum > 0 && <span className="a-mono a-t2 ml-auto text-[11.5px]">{fmtEur(sum, lang, { cents: false })}</span>}
                </div>
                {list.length === 0 ? <p className="a-t3 py-4 text-[12.5px]">{t(`adm.mon.v3i.empty.${b}`)}</p> : (
                  <ul className="flex flex-col">
                    {list.map((l) => (
                      <li key={l.key} className="flex flex-col gap-1.5 border-b py-3">
                        <div className="flex items-baseline gap-2">
                          <Status tone={l.tone}>{l.tag}</Status>
                          <span className="a-mono a-t3 ml-auto text-[11px]">
                            {l.due && b !== 'now' ? t('adm.mon.v3i.due', { when: fmtDate(l.due, lang) }) : l.since ? t('adm.mon.v3i.since', { when: fmtRelative(l.since, lang) }) : ''}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-3">
                          <span className="a-t1 min-w-0 flex-1 text-[13.5px] font-medium">
                            {l.href ? <Link to={l.href} className="no-underline hover:underline" style={{ color: 'inherit' }}>{l.title}</Link> : l.title}
                          </span>
                          {l.amount != null && <span className="a-mono a-t1 flex-none text-[14px] font-semibold">{eur(l.amount)}</span>}
                        </div>
                        {l.who && <div className="text-[12.5px]">{l.who}</div>}
                        <div className="flex items-center gap-2 pt-1">
                          {l.act}
                          {l.href && <Link to={l.href} className="a-btn a-btn--sm a-btn--ghost ml-auto" aria-label={t('adm.mon.v3i.open')}><ArrowUpRight className="h-3.5 w-3.5" /></Link>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {d && <p className="a-t3 text-[12px]">{t('adm.mon.iss.sub')}</p>}

      <ReasonDialog open={!!pending} onOpenChange={(v) => { if (!v) setPending(null); }}
        tone={pending?.kind === 'transfer' && pending.outcome === 'cancelled' ? 'danger' : 'primary'}
        title={pending?.kind === 'alert' ? t('adm.mon.iss.doneTitle')
          : pending?.kind === 'transfer' && pending.outcome === 'received' ? t('adm.mon.iss.receivedTitle') : t('adm.mon.iss.cancelTitle')}
        description={pending?.kind === 'alert' ? t('adm.mon.iss.doneDesc')
          : pending?.kind === 'transfer' ? t('adm.mon.iss.transferDesc', { amount: fmtEur(pending.row.amount, lang), ref: pending.row.reference }) : undefined}
        onConfirm={async (reason) => {
          if (!pending) return;
          if (pending.kind === 'alert') await act.markDone.mutateAsync({ id: pending.row.id, reason });
          else await act.resolveTransfer.mutateAsync({ id: pending.row.id, outcome: pending.outcome, reason });
        }} />
    </Page>
  );
}
