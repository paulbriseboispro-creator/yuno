/**
 * Madrid › Effet sur Yuno : « Qu'est-ce que Madrid apporte au reste de Yuno ? »
 * Le SEUL endroit de la rubrique où l'on croise avec les ventes faites DANS Yuno.
 * Chaque chiffre porte sa règle d'attribution et sa limite (ADMIN_MADRID.md § 4).
 *   1. Héros : les comptes venus par Madrid ;
 *   2. ce que ces personnes font ensuite dans Yuno (app, push, achats) ;
 *   3. les clubs de Madrid qu'on retrouve chez Yuno (client, inscription, prospect).
 */
import {
  Block, DataTable, ErrorState, Hero, StatStrip, useAdminFilters, type ColumnDef,
} from '@/admin/ui';
import { useMadridOffer, type MadridOffer } from './data';
import { MadridPage, Rule } from './shared';
import { useMadridFmt } from './fmt';

type ProRow = MadridOffer['pros'][number];

export default function YunoPage() {
  const { t, n, eur, day, month } = useMadridFmt();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useMadridOffer(range, includeDemo);
  const d = q.data;
  const y = d?.yuno;

  if (q.error && !d) return <MadridPage title={t('adm.mad.y.title')}><ErrorState onRetry={() => void q.refetch()} /></MadridPage>;

  const proCols: ColumnDef<ProRow, unknown>[] = [
    { accessorKey: 'club', header: t('adm.mad.y.club'), cell: (c) => <span className="a-t1">{c.getValue<string>()}</span> },
    { accessorKey: 'kind', header: t('adm.mad.y.found'), cell: (c) => t(`adm.mad.y.kind.${c.getValue<string>()}`) },
    { accessorKey: 'label', header: t('adm.mad.y.as'), cell: (c) => c.getValue<string | null>() ?? '—' },
    { accessorKey: 'at', header: t('adm.mad.e.date'), cell: (c) => <span className="a-mono text-[12px]">{day(c.getValue<string>())}</span> },
  ];

  const sentence = !y ? null : y.came === 0 ? t('adm.mad.y.none') : (
    <>
      {t(y.came === 1 ? 'adm.mad.y.leadOne' : 'adm.mad.y.lead', { n: n(y.came) })}{' '}
      {y.months.length ? t('adm.mad.y.when', { months: y.months.map((m) => `${month(m.m)} (${n(m.accounts)})`).join(', ') }) : ''}{' '}
      {y.buyers_came > 0 ? t('adm.mad.y.bought', { n: n(y.buyers_came), spend: eur(y.spend_came) }) : t('adm.mad.y.noneBought')}
    </>
  );

  return (
    <MadridPage title={t('adm.mad.y.title')} subtitle={t('adm.mad.y.subtitle')}>
      <Hero
        kicker={t('adm.mad.y.kicker')}
        loading={!y}
        value={y ? n(y.came) : ''}
        sentence={sentence}
        note={t('adm.mad.y.cameRule')} />

      <Block title={t('adm.mad.y.peopleTitle')} meta={t('adm.mad.y.sinceStart')}>
        <StatStrip items={[
          { key: 'known', label: t('adm.mad.y.known'), value: y ? n(y.known) : '', loading: !y, hint: t('adm.mad.y.knownRule') },
          { key: 'signed', label: t('adm.mad.y.signedClick'), value: y ? n(y.clicked_signed_in) : '', loading: !y },
          { key: 'city', label: t('adm.mad.y.city'), value: y ? n(y.city_madrid) : '', loading: !y },
          { key: 'fav', label: t('adm.mad.y.fav'), value: y ? n(y.favorites) : '', loading: !y },
          { key: 'push', label: t('adm.mad.y.push'), value: y ? n(y.push) : '', loading: !y, hint: t('adm.mad.y.pushRule') },
          { key: 'app', label: t('adm.mad.y.app', { period: t(`adm.mad.per.${period}`) }), value: y ? n(y.app_sessions) : '', loading: !y },
        ]} />
        <Rule>{t('adm.mad.y.peopleRule')}</Rule>
      </Block>

      <Block title={t('adm.mad.y.bringsTitle')} meta={t('adm.mad.y.sinceStart')}>
        {!y ? <div className="a-skel h-20 w-full" /> : (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="a-kicker">{t('adm.mad.y.cameBuyers')}</span>
              <span className="a-stat-value">{y.buyers_came ? `${n(y.buyers_came)} · ${eur(y.spend_came)}` : '0'}</span>
              <Rule>{t('adm.mad.y.feesLine', { fees: eur(y.fees_came) })}</Rule>
            </div>
            <div className="flex flex-col gap-1">
              <span className="a-kicker">{t('adm.mad.y.allBuyers')}</span>
              <span className="a-stat-value">{y.buyers ? `${n(y.buyers)} · ${eur(y.spend)}` : '0'}</span>
              <Rule>{t('adm.mad.y.allLine', { orders: n(y.orders), fees: eur(y.fees) })}</Rule>
            </div>
          </div>
        )}
        <Rule>{t('adm.mad.y.bringsRule')}</Rule>
      </Block>

      <Block title={t('adm.mad.y.prosTitle')}>
        {d && (
          <p className="a-t2 text-[13px]">
            {t('adm.mad.y.prosLine', { signups: n(d.madrid_pros.signups), accounts: n(d.madrid_pros.signups_account), leads: n(d.madrid_pros.leads), venues: n(d.madrid_pros.venues) })}
          </p>
        )}
        <DataTable data={d?.pros} columns={proCols} loading={!d} pageSize={10}
          empty={{ title: t('adm.mad.y.prosEmpty'), body: t('adm.mad.y.prosEmptyBody') }} />
        <Rule>{t('adm.mad.y.prosRule')}</Rule>
      </Block>

      <Block title={t('adm.mad.y.limitsTitle')}>
        <ul className="a-t2 flex list-disc flex-col gap-1.5 pl-5 text-[13px]">
          <li>{t('adm.mad.y.limit1')}</li>
          <li>{t('adm.mad.y.limit2')}</li>
          <li>{t('adm.mad.y.limit3')}</li>
        </ul>
      </Block>
    </MadridPage>
  );
}
