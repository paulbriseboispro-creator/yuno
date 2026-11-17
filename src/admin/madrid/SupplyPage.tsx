/**
 * Madrid › Santé de l'offre : « Le catalogue est-il vivant ? »
 *   1. Héros : les soirées publiées des 4 prochaines semaines ;
 *   2. les clubs × les 8 prochaines semaines, en cellules teintées ;
 *   3. la synchro des liens Whan sur 30 jours (un trait par jour) ;
 *   4. ce qui demande une action : soirées sans lien (brouillons), sans
 *      affiche, modèles sans occurrence, soirées que personne n'a ouvertes.
 * Rien ne vérifie qu'un lien posé marche encore : un lien « mort » n'est pas testé.
 */
import { useMemo } from 'react';
import {
  Block, DataTable, ErrorState, Hero, UptimeBars, cellTint, useAdminFilters, type ColumnDef, type Uptime,
} from '@/admin/ui';
import { fmtRelative } from '@/lib/adminFormat';
import { useMadridOffer, type MadridOffer } from './data';
import { DatedList, MadridPage, Rule } from './shared';
import { useMadridFmt } from './fmt';

type ClubRow = MadridOffer['supply']['clubs'][number];

export default function SupplyPage() {
  const { t, lang, n, day, rate } = useMadridFmt();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useMadridOffer(range, includeDemo);
  const d = q.data;
  const s = d?.supply;
  const sync = d?.sync;

  const cols = useMemo<ColumnDef<ClubRow, unknown>[]>(() => {
    if (!s) return [];
    const mx = Math.max(0, ...s.clubs.flatMap((c) => c.weeks));
    return [
      { accessorKey: 'name', header: t('adm.mad.y.club'), cell: (c) => (
        <span className={c.row.original.active ? 'a-t1' : 'a-t3'}>{c.getValue<string>()}{c.row.original.active ? '' : ` · ${t('adm.mad.inactive')}`}</span>) },
      ...s.weeks.map((w, i) => ({
        id: `w${i}`, header: day(w).replace(/^\S+\s/, ''), accessorFn: (r: ClubRow) => r.weeks[i] ?? 0,
        meta: { align: 'right' as const, tint: (r: ClubRow) => cellTint(r.weeks[i] ?? 0, mx) },
        cell: (c: { getValue: <V>() => V }) => { const v = c.getValue<number>(); return v ? n(v) : <span className="a-t3">·</span>; },
      })),
      { accessorKey: 'drafts', header: t('adm.mad.s.drafts'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
      { accessorKey: 'templates', header: t('adm.mad.s.templates'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
    ] as ColumnDef<ClubRow, unknown>[];
  }, [s, t, n, day]);

  const uptime = useMemo(() => (sync?.days ?? []).map((x) => ({
    d: x.d,
    state: (x.runs === 0 ? 'none' : x.errors > 0 ? 'warn' : 'ok') as Uptime,
    note: x.runs === 0 ? t('adm.mad.s.noRun') : t('adm.mad.s.dayNote', { links: n(x.links), errors: n(x.errors) }),
  })), [sync, t, n]);

  if (q.error && !d) return <MadridPage title={t('adm.mad.s.title')} period={false}><ErrorState onRetry={() => void q.refetch()} /></MadridPage>;

  const last = sync?.last;
  const staleHours = last ? (Date.now() - new Date(last.at).getTime()) / 3_600_000 : null;
  const sentence = !s ? null : (
    <>
      {t('adm.mad.s.lead', { active: n(s.clubs_active), total: n(s.clubs_total), week: n(s.upcoming_week), clubs: n(s.clubs_with_upcoming) })}{' '}
      {last ? t(staleHours != null && staleHours > 36 ? 'adm.mad.s.syncStale' : 'adm.mad.s.syncOk', { when: fmtRelative(last.at, lang) }) : t('adm.mad.s.syncNever')}{' '}
      {s.blocked.length > 0 ? <b>{t('adm.mad.s.blockedLead', { n: n(s.blocked.length) })}</b> : null}
    </>
  );

  return (
    <MadridPage title={t('adm.mad.s.title')} subtitle={t('adm.mad.s.subtitle')}>
      <Hero
        kicker={t('adm.mad.s.kicker')}
        loading={!s}
        value={s ? n(s.upcoming_published) : ''}
        sentence={sentence}
        chart={!s ? <div className="a-skel h-48 w-full" /> : (
          <DataTable data={s.clubs.filter((c) => c.active || c.weeks.some((w) => w > 0))} columns={cols} pageSize={30} getRowId={(r) => r.id} />
        )}
        note={t('adm.mad.s.note')} />

      <Block title={t('adm.mad.s.syncTitle')} meta={sync ? t('adm.mad.s.syncMeta', { n: n(sync.seen) }) : undefined}>
        {!sync ? <div className="a-skel h-10 w-full" /> : (
          <>
            <UptimeBars days={uptime} label={t('adm.mad.s.syncLabel')}
              summary={last ? t('adm.mad.s.lastRun', { when: fmtRelative(last.at, lang), links: n(last.links), images: n(last.images) }) : undefined} />
            {sync.sources.length > 0 && (
              <p className="a-t2 text-[13px]">{t('adm.mad.s.sources', { list: sync.sources.map((x) => `${x.account} (${x.priority})`).join(', ') })}</p>
            )}
            {last && last.unmatched.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="a-kicker">{t('adm.mad.s.unmatched', { n: n(last.unmatched.length) })}</span>
                <ul className="a-t2 flex flex-col gap-1 text-[13px]">
                  {last.unmatched.slice(0, 8).map((u, i) => <li key={i}><span className="a-mono a-t3 mr-2 text-[11.5px]">{u.date ? day(u.date) : ''}</span>{u.name ?? '—'} <span className="a-t3">· {u.club ?? ''}</span></li>)}
                </ul>
              </div>
            )}
          </>
        )}
        <Rule>{t('adm.mad.s.syncRule')}</Rule>
      </Block>

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        <Block title={t('adm.mad.s.blockedTitle')} meta={s ? t('adm.mad.s.blockedMeta', { n: n(s.blocked_total) }) : undefined}>
          {!s ? <div className="a-skel h-24 w-full" /> : <DatedList items={s.blocked} emptyText={t('adm.mad.s.blockedEmpty')} more={t('adm.mad.s.blockedRule')} />}
        </Block>
        <Block title={t('adm.mad.s.neverTitle')} meta={s ? t('adm.mad.s.neverMeta', { rate: rate(s.never_clicked, s.past_published), period: t(`adm.mad.per.${period}`) }) : undefined}>
          {!s ? <div className="a-skel h-24 w-full" /> : <DatedList items={s.never_clicked_list.slice(0, 12)} emptyText={t('adm.mad.s.neverEmpty')}
            more={s.never_clicked > 12 ? t('adm.mad.s.andMore', { n: n(s.never_clicked - 12) }) : undefined} />}
        </Block>
        <Block title={t('adm.mad.s.flyerTitle')}>
          {!s ? <div className="a-skel h-16 w-full" /> : <DatedList items={s.no_flyer} emptyText={t('adm.mad.s.flyerEmpty')} />}
        </Block>
        <Block title={t('adm.mad.s.idleTitle')}>
          {!s ? <div className="a-skel h-16 w-full" /> : s.templates_idle.length === 0 ? <p className="a-t3 text-[13px]">{t('adm.mad.s.idleEmpty')}</p> : (
            <ul className="flex flex-col divide-y text-[13px]">
              {s.templates_idle.map((x) => (
                <li key={x.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] gap-3 py-1.5">
                  <span className="a-mono a-t3 text-[11.5px]">{x.dow == null ? '—' : t(`adm.mad.dowTpl.${x.dow}`)}</span>
                  <span className="a-t1 truncate">{x.name}</span><span className="a-t3 text-[12px]">{x.club}</span>
                </li>
              ))}
            </ul>
          )}
          {s && s.inactive_templates > 0 && <Rule>{t('adm.mad.s.inactive', { templates: n(s.inactive_templates), drafts: n(s.inactive_drafts) })}</Rule>}
        </Block>
      </div>
    </MadridPage>
  );
}
