/**
 * Campagnes · Instagram (`/crm/instagram`, design « Instagram ») — « Que reçoit
 * un fan qui commente ? ». Un fan écrit un mot-clé sous un post (ou en message
 * privé, ou en réponse à une story) et reçoit le lien en message privé.
 *
 * L'intégration attend l'App Review Meta : l'écran est complet mais HONNÊTE.
 * La connexion du compte est « à venir » (liste d'attente), une réponse se
 * prépare en brouillon et ne s'allume pas (CRM_INSTAGRAM_LIVE + garde serveur),
 * et chaque chiffre est lu dans le journal réel (crm_instagram_events), vide
 * aujourd'hui : rien n'est inventé.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { Badge, CtaButton, Panel, PillButton, Segmented, Sheet, Skel, Switch } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmShell } from '@/crm/data/shell';
import { useNights } from '@/crm/data/nights';
import { useSignupPages } from '@/crm/data/signupPages';
import { useFeatureWaitlist } from '@/crm/data/soon';
import { useInstagram, useInstagramMutations } from '@/crm/data/instagram';
import type { IgRule } from '@/crm/data/instagram';
import { CRM_INSTAGRAM_LIVE, IG_POST_TYPES, funnelRates, keywordError, missingFor, reachableFans, togglePostType } from '@/crm/lib/instagram';
import type { IgDestination } from '@/crm/lib/instagram';
import { InstagramPhone } from '@/crm/pages/soon/Phones';

type Draft = Pick<IgRule, 'post_types' | 'name' | 'keyword' | 'also_dm' | 'also_story' | 'dm_text' | 'button_label' | 'public_reply' | 'reply_variants' | 'destination' | 'signup_page_id' | 'event_id'>;

const input = { height: 46, boxSizing: 'border-box', width: '100%', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', padding: '0 14px', font: 'inherit', fontSize: 15, outline: 'none' } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' } as const;
const DESTS: IgDestination[] = ['signup_page', 'guest_list', 'tickets'];

export default function InstagramPage() {
  const { t, n, pct } = useCrmT();
  const caps = useCrmCaps();
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const [days, setDays] = useState<30 | 90>(30);
  const q = useInstagram(days);
  const shell = useCrmShell();
  const wait = useFeatureWaitlist();
  const m = useInstagramMutations();
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const d = q.data;
  const live = CRM_INSTAGRAM_LIVE && !!d?.open;
  const balance = Number(shell.data?.wallet.balance ?? 0);
  const rates = d ? funnelRates(d.funnel) : null;
  const waiting = wait.features.includes('instagram');

  const template = (dest: IgDestination): Draft => ({
    post_types: [...IG_POST_TYPES], name: t(`yc.igp.tpl.${dest}`), keyword: t(`yc.igp.tplKw.${dest}`), also_dm: true, also_story: true,
    dm_text: t(`yc.igp.tplMsg.${dest}`, { club: space.name }), button_label: t(`yc.igp.tplBtn.${dest}`),
    public_reply: true, reply_variants: [t('yc.ig.reply')], destination: dest, signup_page_id: null, event_id: null,
  });

  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(20px,3vw,40px) clamp(16px,3vw,40px) 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, animation: `yc-rise 600ms ${EASE} both` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.igp.kicker')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.4vw,42px)', letterSpacing: '-.045em', lineHeight: 1.05 }}>{t('yc.igp.title')}</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.igp.sub')}</p>
        </div>
        {caps.write && <CtaButton icon="plus" onClick={() => setEdit({ id: null, draft: template('signup_page') })}>{t('yc.igp.new')}</CtaButton>}
      </header>

      {q.isError && !d ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /> : !d ? <Skel h={420} r={28} /> : (
        <>
          <Panel hover={false} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            <span style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>
            </span>
            <span style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <b style={{ fontSize: 16 }}>{d.account?.username ? t('yc.igp.acc.linked', { handle: d.account.username }) : t('yc.igp.acc.none')}</b>
              <span style={{ fontSize: 14, color: 'var(--sand-600)', lineHeight: 1.45 }}>{live ? t('yc.igp.acc.liveS') : t('yc.igp.acc.soonS')}</span>
            </span>
            {!live && (
              <PillButton tone={waiting ? 'light' : 'dark'} disabled={wait.pending || !caps.write} onClick={() => { void wait.set({ feature: 'instagram', on: !waiting }).catch(() => toast(t('yc.igp.e.x'))); }}>
                {t(waiting ? 'yc.igp.acc.waiting' : 'yc.igp.acc.notify')}
              </PillButton>
            )}
            <Badge tone="warn">{t('yc.igp.acc.soonBadge')}</Badge>
          </Panel>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('yc.igp.tplT')}</b>
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.igp.tplS')}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 14 }}>
              {DESTS.map((dest) => (
                <Panel key={dest} pad={20} style={{ gap: 8 }}>
                  <b style={{ fontSize: 16 }}>{t(`yc.igp.tpl.${dest}`)}</b>
                  <span style={{ fontSize: 13.5, color: 'var(--sand-600)', lineHeight: 1.45, flex: 1 }}>{t(`yc.igp.tplD.${dest}`)}</span>
                  <span style={{ fontSize: 13, color: 'var(--sand-500)', fontStyle: 'italic' }}>« {t(`yc.igp.tplMsg.${dest}`, { club: space.name }).replace('{pseudo}', '@lea.mrt')} »</span>
                  {caps.write && <PillButton size="sm" onClick={() => setEdit({ id: null, draft: template(dest) })}>{t('yc.igp.use')}</PillButton>}
                </Panel>
              ))}
            </div>
          </section>

          <Panel hover={false} style={{ gap: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('yc.igp.funnelT')}</b>
                <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.igp.funnelS')}</span>
              </span>
              <Segmented value={String(days)} onChange={(v) => setDays(v === '90' ? 90 : 30)} options={[{ value: '30', label: t('yc.igp.d30') }, { value: '90', label: t('yc.igp.d90') }]} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
              {([['comments', d.funnel.comments, null], ['dms', d.funnel.dms, rates?.dm], ['clicks', d.funnel.clicks, rates?.click], ['signups', d.funnel.signups, rates?.signup], ['buyers', d.funnel.buyers, rates?.buyer]] as const).map(([k, v, r]) => (
                <div key={k} style={{ padding: 16, borderRadius: 18, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t(`yc.igp.f.${k}`)}</span>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.04em' }}>{n(v)}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{r == null ? '—' : t(`yc.igp.fr.${k}`, { pct: pct(r) })}</span>
                </div>
              ))}
            </div>
            {d.funnel.comments === 0 && <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.igp.funnelEmpty')}</span>}
            <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.igp.yunits', { n: n(d.funnel.dms * d.rate), rate: d.rate, fans: n(reachableFans(balance, d.rate)) })} <Link to={CRM_ROUTES.yunits} style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('yc.igp.recharge')}</Link></span>
          </Panel>

          <Panel hover={false} pad={0} style={{ gap: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 24px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('yc.igp.rulesT')}</b>
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.igp.rulesS')}</span>
            </div>
            {d.rules.length === 0 && <div style={{ padding: '28px 24px', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.igp.rulesNone')}</div>}
            {d.rules.map((r) => {
              const miss = missingFor(r);
              return (
                <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '16px 24px', borderTop: '1px solid var(--sand-100)' }}>
                  <button type="button" onClick={() => setEdit({ id: r.id, draft: { ...r } })} style={{ flex: '1 1 280px', minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 15.5 }}>{r.name || r.keyword.toUpperCase()}</b>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '2px 8px', borderRadius: 8, background: 'var(--sand-100)' }}>{r.keyword.toUpperCase()}</span>
                      <Badge tone={r.enabled ? 'done' : miss.length ? 'warn' : 'wait'}>{t(r.enabled ? 'yc.igp.st.on' : miss.length ? 'yc.igp.st.missing' : 'yc.igp.st.draft')}</Badge>
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t(`yc.igp.dest.${r.destination}`)}{r.page_title ? ` · ${r.page_title}` : r.event_title ? ` · ${r.event_title}` : ''} · {t('yc.igp.counts', { c: n(r.comments), d: n(r.dms), s: n(r.signups) })}</span>
                  </button>
                  <span title={live ? undefined : t('yc.igp.notOpen')} style={{ display: 'inline-flex' }}>
                    <Switch on={r.enabled} disabled={!live || !caps.write} onChange={(v) => m.save.mutate({ id: r.id, patch: { enabled: v } }, { onError: () => toast(t('yc.igp.notOpen')) })} label={r.keyword} />
                  </span>
                </div>
              );
            })}
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 20, alignItems: 'start' }}>
            <Panel hover={false} style={{ gap: 8 }}>
              <b style={{ fontSize: 18 }}>{t('yc.igp.recentT')}</b>
              <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.igp.recentS')}</span>
              {d.recent.length === 0 && <span style={{ fontSize: 14, color: 'var(--sand-500)', padding: '12px 0' }}>{t('yc.igp.recentNone')}</span>}
              {d.recent.map((x, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14 }}>
                  <b>@{x.username ?? '—'}</b><span style={{ color: 'var(--sand-600)' }}>{t(`yc.igp.k.${x.kind}`)} · {x.keyword.toUpperCase()}</span>
                </div>
              ))}
            </Panel>
            <Panel hover={false} style={{ gap: 10, background: 'var(--sand-50)' }}>
              <b style={{ fontSize: 18 }}>{t('yc.igp.goodT')}</b>
              {[1, 2, 3].map((i) => <span key={i} style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)' }}><b>{t(`yc.igp.good${i}t`)}</b> {t(`yc.igp.good${i}s`)}</span>)}
            </Panel>
          </div>
        </>
      )}
      {edit && <RuleEditor key={edit.id ?? 'new'} id={edit.id} initial={edit.draft} onClose={() => setEdit(null)} />}
    </main>
  );
}

function RuleEditor({ id, initial, onClose }: { id: string | null; initial: Draft; onClose: () => void }) {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const m = useInstagramMutations();
  const pages = useSignupPages();
  const nights = useNights();
  const [d, setD] = useState<Draft>(initial);
  const [tab, setTab] = useState<'comment' | 'dm'>('comment');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const kwErr = d.keyword ? keywordError(d.keyword) : 'short';
  const miss = useMemo(() => missingFor({ ...d, keyword: d.keyword }), [d]);
  const upcoming = (nights.data?.nights ?? []).filter((x) => x.upcoming);
  const save = () => m.save.mutate({ id, patch: { ...d } }, {
    onSuccess: () => { toast(t('yc.igp.saved')); onClose(); },
    onError: (e) => { const c = (e as { message?: string; code?: string }); toast(t(c.code === '23505' ? 'yc.igp.e.taken' : c.message === 'bad_keyword' ? 'yc.igp.e.kw' : 'yc.igp.e.x')); },
  });
  const remove = () => { if (id && window.confirm(t('yc.igp.delConfirm'))) m.remove.mutate(id, { onSuccess: onClose }); };
  return (
    <Sheet open onClose={onClose} width={980} label={t('yc.igp.editT')}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(18px,3vw,28px)', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{t(id ? 'yc.igp.editT' : 'yc.igp.newT')}</h2>
          <label style={lbl}>{t('yc.igp.f.name')}<input value={d.name} maxLength={60} onChange={(e) => set('name', e.target.value)} style={input} /></label>
          <div style={lbl}>1 · {t('yc.igp.f.post')}<span style={{ fontWeight: 400, fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.igp.nextPost')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {IG_POST_TYPES.map((k) => <PillButton key={k} size="sm" tone={d.post_types.includes(k) ? 'dark' : 'light'} onClick={() => set('post_types', togglePostType(d.post_types, k))}>{t(`yc.igp.pt.${k}`)}</PillButton>)}
            </div>
            <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.igp.ptNote')}</span><span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.igp.postNote')}</span></div>
          <label style={lbl}>2 · {t('yc.igp.f.kw')}
            <input value={d.keyword} maxLength={30} onChange={(e) => set('keyword', e.target.value)} style={{ ...input, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', borderColor: d.keyword && kwErr ? 'var(--red-400)' : 'var(--sand-200)' }} />
            <span style={{ fontWeight: 400, fontSize: 12.5, color: d.keyword && kwErr ? 'var(--red-600)' : 'var(--sand-500)' }}>{d.keyword && kwErr ? t(`yc.igp.kwErr.${kwErr}`) : t('yc.igp.kwHelp')}</span>
          </label>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>{t('yc.igp.alsoDm')}<Switch on={d.also_dm} onChange={(v) => set('also_dm', v)} label={t('yc.igp.alsoDm')} /></span>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>{t('yc.igp.alsoStory')}<Switch on={d.also_story} onChange={(v) => set('also_story', v)} label={t('yc.igp.alsoStory')} /></span>
          <label style={lbl}>3 · {t('yc.igp.f.msg')}
            <textarea value={d.dm_text} maxLength={600} rows={4} onChange={(e) => set('dm_text', e.target.value)} onFocus={() => setTab('dm')} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} />
            <button type="button" onClick={() => set('dm_text', `${d.dm_text}{pseudo}`)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, color: 'var(--red-600)', fontWeight: 600, cursor: 'pointer' }}>{t('yc.igp.insertPseudo')}</button>
          </label>
          <label style={lbl}>{t('yc.igp.f.btn')} <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{d.button_label.length} / 20</span><input value={d.button_label} maxLength={20} onFocus={() => setTab('dm')} onChange={(e) => set('button_label', e.target.value)} style={input} /></label>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
            <span>{t('yc.igp.publicReply')}<br /><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.igp.publicReplyS')}</span></span>
            <Switch on={d.public_reply} onChange={(v) => set('public_reply', v)} label={t('yc.igp.publicReply')} />
          </span>
          {d.public_reply && (
            <label style={lbl}>{t('yc.igp.variants')}
              <textarea value={d.reply_variants.join('\n')} rows={3} onFocus={() => setTab('comment')} onChange={(e) => set('reply_variants', e.target.value.split('\n').slice(0, 5))} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} />
              <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.igp.variantsS')}</span>
            </label>
          )}
          <div style={lbl}>4 · {t('yc.igp.f.dest')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DESTS.map((x) => <PillButton key={x} size="sm" tone={d.destination === x ? 'dark' : 'light'} onClick={() => set('destination', x)}>{t(`yc.igp.dest.${x}`)}{x === 'signup_page' ? ` · ${t('yc.igp.advised')}` : ''}</PillButton>)}
            </div>
            <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.igp.destS.${d.destination}`)}</span>
          </div>
          {d.destination === 'signup_page' ? (
            <label style={lbl}>{t('yc.igp.f.page')}
              <select value={d.signup_page_id ?? ''} onChange={(e) => set('signup_page_id', e.target.value || null)} style={input}>
                <option value="">{t('yc.igp.choose')}</option>
                {(pages.data?.pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.title || p.slug}</option>)}
              </select>
              <Link to={CRM_ROUTES.signupPages} style={{ fontWeight: 600, fontSize: 13, color: 'var(--red-600)' }}>{t('yc.igp.createPage')}</Link>
            </label>
          ) : (
            <label style={lbl}>{t('yc.igp.f.night')}
              <select value={d.event_id ?? ''} onChange={(e) => set('event_id', e.target.value || null)} style={input}>
                <option value="">{t('yc.igp.choose')}</option>
                {upcoming.map((x) => <option key={x.id} value={x.id}>{x.title} · {new Date(x.start_at).toLocaleDateString()}</option>)}
              </select>
            </label>
          )}
          <span style={{ fontSize: 13, color: miss.length ? 'var(--amber-700)' : 'var(--green-700)' }}>{miss.length ? t('yc.igp.missing', { what: miss.map((x) => t(`yc.igp.miss.${x}`)).join(', ') }) : t('yc.igp.ready')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {caps.write && <CtaButton icon="check" onClick={save} disabled={m.save.isPending || !!kwErr}>{t('yc.igp.saveDraft')}</CtaButton>}
            <PillButton onClick={onClose}>{t('yc.common.cancel')}</PillButton>
            {id && caps.write && <PillButton tone="ghost" onClick={remove}>{t('yc.igp.delete')}</PillButton>}
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.igp.draftNote')}</span>
        </div>
        <div style={{ flex: '0 0 300px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Segmented value={tab} onChange={(v) => setTab(v as 'comment' | 'dm')} options={[{ value: 'comment', label: t('yc.ig.tabComment') }, { value: 'dm', label: t('yc.ig.tabDm') }]} />
          <InstagramPhone tab={tab} scene={3} clubName={space.name} city={space.city} keyword={d.keyword || undefined} message={d.dm_text} button={d.button_label || undefined} reply={d.reply_variants.find((x) => x.trim()) || undefined} />
          <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.igp.previewNote')}</span>
        </div>
      </div>
    </Sheet>
  );
}
