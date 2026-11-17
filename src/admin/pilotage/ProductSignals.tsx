/**
 * Pilotage › Produit › Signaux (v3) : « Que regardent les gens, et que font-ils ? »
 *   1. une phrase, puis la bande des six signaux ;
 *   2. ce qu'on regarde : soirées les plus vues, rubriques et adresses, en
 *      barres triées ;
 *   3. ce qu'on fait : la porte par pilier en bullets (scannés contre vendus),
 *      Wallet et achat sans compte ;
 *   4. le reste replié : favoris et abonnements, notifications automatiques,
 *      questions aux assistants, retours, goûts et audience.
 * Lecture : admin_product_insights (une RPC, démo selon l'interrupteur).
 * Pilier boissons en pause : la réponse « boisson » du quiz de goûts n'est pas montrée.
 */
import { Link } from 'react-router-dom';
import { Block, BulletBar, ErrorState, RankBars, StatStrip, useAdminFilters, useAdminT, DenseRows, Fold, Status } from '@/admin/ui';
import { fmtDate, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { MIN_SAMPLE } from '@/lib/metrics';
import { useProductInsights, type KV } from './data';
import { proHref } from './format';

const secs = (n: number | null): string => (n == null ? '—' : n >= 60 ? `${Math.round(n / 60)} min` : `${Math.round(n)} s`);

export default function ProductSignals() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useProductInsights(range, includeDemo);
  const d = q.data;
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const tr = (prefix: string, raw: string) => {
    if (!raw) return t('adm.product.unknownValue');
    const k = `${prefix}.${raw}`;
    const v = t(k);
    return v === k ? raw : v;
  };

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!d) return <div className="flex flex-col gap-6"><div className="a-skel h-6 w-2/3" /><div className="a-skel h-20 w-full" /><div className="a-skel h-64 w-full" /></div>;

  const views = d.page_groups.reduce((s, g) => s + g.views, 0);
  const en = d.entry;
  const top = d.top_events_viewed[0];
  const per = t(`adm.pil.v3.per.${period}`);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <p className="a-hero-sentence max-w-[72ch]">
          {views === 0 ? t('adm.pil.v3p.noViews', { period: per }) : (
            <>
              {t('adm.pil.v3p.viewed', { period: per })} <b>{n(views)}</b> {t('adm.pil.v3p.pages')}
              {top ? <>{t('adm.pil.v3p.topEvent')} <b>{top.title}</b> ({n(top.views)})</> : null}.
              {' '}{t('adm.pil.v3p.did', { t: n(en.tickets), g: n(en.guestlist) })}
            </>
          )}
        </p>
        <StatStrip items={[
          { key: 'views', label: t('adm.pl.sig.k.views'), value: n(views), hint: t('adm.pl.sig.k.viewsHint') },
          { key: 'gl', label: t('adm.product.entry.guestlist'), value: n(en.guestlist) },
          { key: 'tk', label: t('adm.product.entry.tickets'), value: n(en.tickets) },
          { key: 'ab', label: t('adm.product.entry.abandoned'), value: n(en.abandoned_carts) },
          { key: 'push', label: t('adm.pl.sig.k.push'), value: n(d.notifications.push_users), hint: t('adm.pl.sig.k.pushHint') },
          { key: 'fb', label: t('adm.pl.sig.k.feedback'), value: n(d.feedback.open), to: '/admin/today/feedback' },
        ]} />
      </div>

      <Block title={t('adm.product.topEvents')} meta={t('adm.pl.sig.eventsSub')}>
        <RankBars emptyText={t('adm.product.noSignal')}
          items={d.top_events_viewed.slice(0, 10).map((e) => ({
            key: e.id, label: e.title, value: e.views, display: n(e.views),
            to: `/admin/clients/events?q=${encodeURIComponent(e.id)}`,
            sub: [fmtDate(e.start_at, lang, 'day'), e.venue_name, t('adm.pil.v3p.evDid', { t: n(e.tickets), g: n(e.guestlist) }), secs(e.avg_seconds)].filter(Boolean).join(' · '),
          }))} />
      </Block>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Block title={t('adm.product.pageGroups')} meta={t('adm.product.col.views')}>
          <RankBars emptyText={t('adm.product.noSignal')}
            items={[...d.page_groups].sort((a, b) => b.views - a.views).slice(0, 10).map((g) => ({
              key: g.group, label: tr('adm.cockpit.g', g.group), value: g.views, display: n(g.views), sub: secs(g.avg_seconds),
            }))} />
        </Block>
        <Block title={t('adm.product.topPaths')} meta={t('adm.product.col.views')}>
          <RankBars emptyText={t('adm.product.noSignal')}
            items={[...d.top_paths].sort((a, b) => b.views - a.views).slice(0, 10).map((p) => ({
              key: p.path, label: <code className="text-[12px]">{p.path}</code>, value: p.views, display: n(p.views), sub: tr('adm.cockpit.g', p.group),
            }))} />
        </Block>
      </div>

      <Block title={t('adm.pl.sig.conv')} meta={t('adm.pil.v3p.doorMeta')}>
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-2">
          {([['guestlist', en.guestlist, en.guestlist_scanned], ['tickets', en.tickets, en.tickets_scanned]] as const).map(([k, sold, scanned]) => (
            <div key={k} className="flex flex-col gap-1">
              <BulletBar value={scanned} max={Math.max(1, sold)} label={t(`adm.product.entry.${k}`)}
                display={sold >= MIN_SAMPLE ? `${n(scanned)} / ${n(sold)} · ${fmtPct((scanned / sold) * 100, 0, lang)}` : `${n(scanned)} / ${n(sold)}`} />
              <span className="a-t3 text-[12px]">{sold === 0 ? t('adm.pil.v3p.noneSold') : t('adm.pil.v3p.scannedOf')}</span>
            </div>
          ))}
        </div>
        <p className="a-t2 text-[13px]">
          {t('adm.pil.v3p.tables', { n: n(en.tables) })}{' '}
          {t('adm.pil.v3p.wallet', { n: n(en.wallet_passes) })}{en.wallet_by_type.length ? ` (${en.wallet_by_type.map((w) => `${n(w.n)} ${tr('adm.product.wallet', w.k)}`).join(' · ')})` : ''}.{' '}
          {en.guest_checkout_share == null ? t('adm.product.entry.noSale') : t('adm.pil.v3p.guestShare', { pct: fmtPct(en.guest_checkout_share, 0, lang) })}
        </p>
      </Block>

      <div className="flex flex-col gap-6">
        <Fold title={t('adm.product.favorites')} hint={t('adm.product.favoritesHint')}>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            <MiniRank title={t('adm.product.topFavEvents')} items={d.favorites.top_events.map((e) => ({ key: e.id, label: e.title, value: e.n, sub: fmtDate(e.start_at, lang, 'day') }))} />
            <MiniRank title={t('adm.product.topFavVenues')} items={d.favorites.top_venues.map((v) => ({ key: v.id, label: v.name, value: v.n, sub: v.city ?? undefined, to: proHref(`venue:${v.id}`) }))} />
            <MiniRank title={t('adm.product.topFavDjs')} items={d.favorites.top_djs.map((x) => ({ key: x.id, label: x.name, value: x.n }))} />
          </div>
          <p className="a-t2 mt-4 text-[13px]">
            {d.favorites.by_type.map((f) => t('adm.pil.v3p.favType', { type: tr('adm.product.fav', f.type), p: n(f.period), all: n(f.total) })).join(' · ') || t('adm.product.noSignal')}
            {d.follows.by_subject.length > 0 ? <><br />{d.follows.by_subject.map((f) => `${tr('adm.product.sub', f.subject)} +${n(f.follows)} / −${n(f.unfollows)}`).join(' · ')}</> : null}
          </p>
        </Fold>

        <Fold title={t('adm.product.autoPush')} hint={t('adm.pil.v3p.pushHint', { n: n(d.notifications.auto_push.length) })}>
          <DenseRows empty={t('adm.product.noSignal')} rows={[...d.notifications.auto_push].sort((a, b) => b.sent - a.sent).map((p) => ({
            key: p.key,
            main: <code className="text-[12px]">{p.key}</code>,
            cells: [n(p.sent), n(p.clicked), p.sent >= MIN_SAMPLE ? fmtPct(p.ctr, 1, lang) : '—'],
            flag: p.failed > 0 ? <Status tone="negative">{t('adm.pil.v3p.failed', { n: n(p.failed) })}</Status> : null,
          }))} head={[t('adm.product.col.sent'), t('adm.product.col.clicked'), t('adm.product.col.ctr')]} />
          <p className="a-t2 mt-3 text-[13px]">
            {t('adm.product.discoveryLine', { s: n(d.notifications.discovery_sent), o: n(d.notifications.discovery_opened), x: n(d.notifications.discovery_opt_out) })} ·{' '}
            {t('adm.product.newsletterLine', { i: n(d.notifications.newsletter_opt_in), o: n(d.notifications.newsletter_opt_out_period) })}{' '}
            <Link to="/admin/comms/engine" className="underline">{t('adm.product.seeAll')}</Link>
          </p>
        </Fold>

        <Fold title={t('adm.pl.sig.assistants')} hint={t('adm.pil.v3p.questionsHint', { a: n(d.ai_questions.length), b: n(d.pro_questions.length) })}>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <QuestionList title={t('adm.product.aiQuestions')} rows={d.ai_questions.map((x, i) => ({ key: String(i), at: x.at, q: x.q, tag: x.lang ? x.lang.toUpperCase() : '', bad: x.status !== 'ok' }))} />
            <QuestionList title={t('adm.product.proQuestions')} rows={d.pro_questions.map((x, i) => ({ key: String(i), at: x.at, q: x.q, tag: tr('adm.ai.a', x.assistant), bad: x.status !== 'ok' }))} />
          </div>
          {d.links_interest.length > 0 && (
            <div className="mt-6"><MiniRank title={t('adm.product.linksInterest')} items={d.links_interest.map((l) => ({ key: l.target, label: l.target, value: l.n }))} /></div>
          )}
        </Fold>

        <Fold title={t('adm.product.feedback')} hint={t('adm.product.feedbackOpen', { n: n(d.feedback.open) })}>
          <ul className="flex flex-col">
            {d.feedback.recent.length === 0 ? <li className="a-t2 text-[13px]">{t('adm.product.noSignal')}</li> : d.feedback.recent.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-2">
                <Link to="/admin/today/feedback" className="a-t1 min-w-0 flex-1 truncate text-[13px] no-underline hover:underline">{f.title}</Link>
                <span className="a-t3 text-[12px]">{[f.venue, f.reporter, f.category].filter(Boolean).join(' · ')}</span>
                <Status tone={f.status === 'open' ? (f.priority === 'critical' || f.priority === 'high' ? 'negative' : 'warning') : f.status === 'resolved' || f.status === 'closed' ? 'positive' : 'neutral'}>{f.status}</Status>
                <span className="a-mono a-t3 w-24 text-right text-[11px]">{fmtRelative(f.at, lang)}</span>
              </li>
            ))}
          </ul>
          <p className="a-t2 mt-3 text-[13px]">{t('adm.pil.v3p.incidents', { i: n(d.feedback.incidents), c: n(d.feedback.email_complaints) })}</p>
        </Fold>

        <Fold title={t('adm.pl.sig.taste')} hint={t('adm.product.tasteN', { n: n(d.taste.profiles) })}>
          <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            <MiniRank title={t('adm.product.taste.genres')} items={kv(d.taste.genres)} />
            <MiniRank title={t('adm.product.taste.night_type')} items={kv(d.taste.night_type)} />
            <MiniRank title={t('adm.product.taste.budget')} items={kv(d.taste.budget)} />
            <MiniRank title={t('adm.product.taste.frequency')} items={kv(d.taste.frequency)} />
            <MiniRank title={t('adm.product.taste.booking')} items={kv(d.taste.booking)} />
            <MiniRank title={t('adm.product.aud.cities')} items={kv(d.audience.cities)} />
            <MiniRank title={t('adm.product.aud.ages')} items={kv(d.audience.ages)} />
            <MiniRank title={t('adm.product.aud.genders')} items={kv(d.audience.genders)} />
            <MiniRank title={t('adm.product.aud.languages')} items={kv(d.audience.languages, true)} />
            <MiniRank title={t('adm.product.aud.personas')} items={kv(d.audience.personas)} />
            <MiniRank title={t('adm.product.aud.session_countries')} items={kv(d.audience.session_countries)} />
            <MiniRank title={t('adm.product.aud.session_devices')} items={kv(d.audience.session_devices)} />
          </div>
        </Fold>
      </div>
    </div>
  );

  function kv(items: KV[], upper = false) {
    return items.map((i) => ({ key: i.k || '?', label: !i.k || i.k === '?' ? t('adm.product.unknownValue') : upper ? i.k.toUpperCase() : i.k, value: i.n }));
  }
}

/** Un classement compact (titre mono, six barres au plus). */
function MiniRank({ title, items }: { title: string; items: Array<{ key: string; label: string; value: number; sub?: string; to?: string }> }) {
  const { t, lang } = useAdminT();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <span className="a-kicker">{title}</span>
      <RankBars emptyText={t('adm.product.noSignal')} items={[...items].sort((a, b) => b.value - a.value).slice(0, 6).map((i) => ({ ...i, display: fmtNum(i.value, lang) }))} />
    </section>
  );
}

function QuestionList({ title, rows }: { title: string; rows: Array<{ key: string; at: string; q: string; tag: string; bad: boolean }> }) {
  const { t, lang } = useAdminT();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <span className="a-kicker">{title}</span>
      {rows.length === 0 ? <p className="a-t2 text-[13px]">{t('adm.product.noSignal')}</p> : (
        <ul className="flex flex-col">
          {rows.slice(0, 12).map((r) => (
            <li key={r.key} className="flex items-baseline gap-3 border-b py-1.5">
              <span className="a-t1 min-w-0 flex-1 text-[13px]">{r.q}</span>
              {r.bad && <Status tone="negative">{t('adm.pil.v3p.error')}</Status>}
              <span className="a-mono a-t3 flex-none text-[11px]">{r.tag ? `${r.tag} · ` : ''}{fmtRelative(r.at, lang)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
