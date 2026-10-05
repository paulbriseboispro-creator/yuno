/**
 * Clients › Pages d'inscription › une page (`/crm/signup-pages/:id`) : régler la
 * page (occasion et soirée, textes, couleurs, police, champs, récompense,
 * dates) avec l'aperçu téléphone EN DIRECT (le même composant que la page
 * publique : on peut le remplir, rien n'est enregistré), puis la publier ou la
 * fermer (titulaire seul), récupérer un lien et un QR par endroit, et lire ses
 * chiffres (visites → inscrits → confirmés, par provenance) et l'export CSV.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { Badge, CtaButton, Panel, PillButton, Skel, Switch } from '@/crm/ui/kit';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { useNights } from '@/crm/data/nights';
import { SIGNUP_SOURCES, signupUrl, useSignupMutations, useSignupPages, useSignupStats } from '@/crm/data/signupPages';
import type { SignupPageRow } from '@/crm/data/signupPages';
import FanView from '@/crm/signup/FanView';
import type { FanPageData } from '@/crm/signup/FanView';
import { statusTone } from './SignupPagesPage';

type Draft = Pick<SignupPageRow, 'occasion' | 'event_id' | 'title' | 'tagline' | 'button_label' | 'thanks_message' | 'poster_url' | 'theme' | 'fields' | 'show_count' | 'reward' | 'opens_at' | 'sale_opens_at' | 'closes_at'>;

const input = { height: 46, boxSizing: 'border-box', width: '100%', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', padding: '0 14px', font: 'inherit', fontSize: 15, outline: 'none' } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' } as const;
const SWATCHES = ['#0A0A0A', '#1C1517', '#FFFFFF', '#F7F4F3', '#14213D', '#2B0A3D'];
const ACCENTS = ['#E3141B', '#FF6B35', '#FFB020', '#16A34A', '#2563EB', '#C026D3'];

function toLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function SignupEditorPage() {
  const { id = '' } = useParams();
  const { t } = useCrmT();
  const q = useSignupPages();
  const page = q.data?.pages.find((p) => p.id === id);
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  if (!q.data) return <main style={{ padding: 32 }}><Skel h={480} r={28} /></main>;
  if (!page) return <main style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12 }}><b>{t('yc.spg.notFound')}</b><Link to="/crm/signup-pages">{t('yc.spg.back')}</Link></main>;
  return <Editor key={page.id} page={page} canPublish={q.data.can_publish} />;
}

function Editor({ page, canPublish }: { page: SignupPageRow; canPublish: boolean }) {
  const { t, n } = useCrmT();
  const caps = useCrmCaps();
  const { space } = useCrmScope();
  const nav = useNavigate();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const nights = useNights();
  const stats = useSignupStats(page.id);
  const [d, setD] = useState<Draft>(() => ({ ...page }));
  const [tab, setTab] = useState<'edit' | 'share' | 'stats'>(page.status === 'draft' ? 'edit' : 'share');
  const dirty = JSON.stringify(d) !== JSON.stringify(Object.fromEntries(Object.keys(d).map((k) => [k, page[k as keyof Draft]])));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const upcoming = (nights.data?.nights ?? []).filter((x) => x.upcoming);
  const night = upcoming.find((x) => x.id === d.event_id) ?? null;
  const ro = !caps.write;

  const preview: FanPageData = useMemo(() => ({
    ...d, slug: page.slug, state: 'open', count: d.show_count ? Math.max(page.entries, 0) : null, demo: false, host: space.name,
    event: night ? { title: night.title, start_at: night.start_at, image_url: night.cover_url, ticket_url: night.url, place: [night.street, night.city].filter(Boolean).join(' · ') || null } : null,
  }), [d, page.slug, page.entries, space.name, night]);

  const save = (after?: () => void) => {
    const patch: Record<string, unknown> = { ...d };
    m.save.mutate({ id: page.id, patch }, {
      onSuccess: () => { toast(t('yc.spg.saved')); after?.(); },
      onError: (e) => toast(t((e as { message?: string }).message === 'bad_fields' ? 'yc.spg.errFields' : 'yc.spg.err')),
    });
  };
  const setStatus = (status: 'live' | 'closed') => {
    const go = () => m.status.mutate({ id: page.id, status }, {
      onSuccess: () => { toast(t(status === 'live' ? 'yc.spg.published' : 'yc.spg.closedDone')); if (status === 'live') setTab('share'); },
      onError: (e) => { const c = (e as { message?: string }).message ?? ''; toast(t(['owner_only', 'incomplete', 'closes_in_past', 'support_session'].includes(c) ? `yc.spg.e.${c}` : 'yc.spg.err')); },
    });
    if (dirty) save(go); else go();
  };

  return (
    <main style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(20px,3vw,36px) clamp(16px,3vw,40px) 64px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link to="/crm/signup-pages" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', textDecoration: 'none' }}><Icon name="arrowLeft" size={15} stroke={2.4} />{t('yc.spg.back')}</Link>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,36px)', letterSpacing: '-.04em' }}>{d.title || t('yc.fan.titlePh')}</h1>
            <Badge tone={statusTone(page)}>{t(`yc.spg.st.${page.status === 'live' && !page.open ? 'liveShut' : page.status}`)}</Badge>
          </span>
          <span style={{ fontSize: 14, color: 'var(--sand-500)', fontFamily: 'var(--font-mono)' }}>{signupUrl(page.slug).replace(/^https?:\/\//, '')}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {!ro && dirty && <PillButton tone="dark" onClick={() => save()} disabled={m.save.isPending}>{t('yc.spg.save')}</PillButton>}
          {!ro && page.status !== 'live' && (canPublish
            ? <CtaButton icon="send" onClick={() => setStatus('live')} disabled={m.status.isPending}>{t(page.status === 'closed' ? 'yc.spg.reopen' : 'yc.spg.publish')}</CtaButton>
            : <span style={{ fontSize: 13, color: 'var(--sand-500)', alignSelf: 'center', maxWidth: 260 }}>{t('yc.spg.ownerOnly')}</span>)}
          {!ro && page.status === 'live' && canPublish && <PillButton onClick={() => setStatus('closed')} disabled={m.status.isPending}>{t('yc.spg.close')}</PillButton>}
          {!ro && page.status === 'draft' && !page.published_at && page.entries === 0 && (
            <PillButton tone="ghost" onClick={() => { if (window.confirm(t('yc.spg.delConfirm'))) m.remove.mutate(page.id, { onSuccess: () => nav('/crm/signup-pages') }); }}>{t('yc.spg.delete')}</PillButton>
          )}
        </div>
      </header>

      <div role="tablist" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--sand-200)' }}>
        {(['edit', 'share', 'stats'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ height: 44, padding: 0, border: 0, background: 'none', cursor: 'pointer', fontSize: 15.5, fontWeight: 600, color: tab === k ? 'var(--ink)' : 'var(--sand-500)', boxShadow: tab === k ? 'inset 0 -2px 0 var(--red-500)' : 'none' }}>{t(`yc.spg.tab.${k}`)}</button>
        ))}
      </div>

      {tab === 'edit' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Panel hover={false} pad={22} style={{ gap: 14 }}>
              <b style={{ fontSize: 17 }}>{t('yc.spg.s.occasion')}</b>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['night', 'community'] as const).map((o) => <PillButton key={o} size="sm" tone={d.occasion === o ? 'dark' : 'light'} onClick={() => !ro && setD((x) => ({ ...x, occasion: o, event_id: o === 'community' ? null : x.event_id }))}>{t(`yc.spg.occ.${o}`)}</PillButton>)}
              </div>
              {d.occasion === 'night' && (
                <label style={lbl}>{t('yc.spg.f.night')}
                  <select value={d.event_id ?? ''} disabled={ro} onChange={(e) => { const nx = upcoming.find((x) => x.id === e.target.value); setD((x) => ({ ...x, event_id: e.target.value || null, poster_url: nx?.cover_url ?? x.poster_url, sale_opens_at: x.sale_opens_at ?? nx?.sale_opens_at ?? null })); }} style={input}>
                    <option value="">{t('yc.spg.f.noNight')}</option>
                    {upcoming.map((x) => <option key={x.id} value={x.id}>{x.title} · {new Date(x.start_at).toLocaleDateString()}</option>)}
                  </select>
                </label>
              )}
            </Panel>
            <Panel hover={false} pad={22} style={{ gap: 14 }}>
              <b style={{ fontSize: 17 }}>{t('yc.spg.s.words')}</b>
              <label style={lbl}>{t('yc.spg.f.title')} <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{d.title.length} / 40</span><input value={d.title} maxLength={40} disabled={ro} onChange={(e) => set('title', e.target.value)} style={input} /></label>
              <label style={lbl}>{t('yc.spg.f.tagline')} <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{d.tagline.length} / 140</span><textarea value={d.tagline} maxLength={140} rows={2} disabled={ro} onChange={(e) => set('tagline', e.target.value)} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
              <label style={lbl}>{t('yc.spg.f.button')}<input value={d.button_label} maxLength={30} disabled={ro} onChange={(e) => set('button_label', e.target.value)} style={input} /></label>
              <label style={lbl}>{t('yc.spg.f.thanks')}<input value={d.thanks_message} maxLength={200} disabled={ro} placeholder={t('yc.fan.okS', { host: space.name })} onChange={(e) => set('thanks_message', e.target.value)} style={input} /></label>
            </Panel>
            <Panel hover={false} pad={22} style={{ gap: 14 }}>
              <b style={{ fontSize: 17 }}>{t('yc.spg.s.style')}</b>
              {(['bg', 'accent'] as const).map((k) => (
                <div key={k} style={lbl}>{t(`yc.spg.f.${k}`)}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(k === 'bg' ? SWATCHES : ACCENTS).map((c) => <button key={c} type="button" aria-label={c} disabled={ro} onClick={() => set('theme', { ...d.theme, [k]: c })} style={{ width: 34, height: 34, borderRadius: 99, background: c, border: 0, cursor: 'pointer', boxShadow: d.theme[k].toLowerCase() === c.toLowerCase() ? '0 0 0 2px #fff, 0 0 0 4px var(--ink)' : 'inset 0 0 0 1px var(--sand-200)' }} />)}
                    <input type="color" value={d.theme[k]} disabled={ro} onChange={(e) => set('theme', { ...d.theme, [k]: e.target.value.toUpperCase() })} aria-label={t(`yc.spg.f.${k}`)} style={{ width: 40, height: 34, border: 0, background: 'none', cursor: 'pointer' }} />
                  </div>
                </div>
              ))}
              <label style={lbl}>{t('yc.spg.f.font')}
                <select value={d.theme.font} disabled={ro} onChange={(e) => set('theme', { ...d.theme, font: e.target.value as Draft['theme']['font'] })} style={input}>
                  {(['display', 'serif', 'mono'] as const).map((f) => <option key={f} value={f}>{t(`yc.spg.font.${f}`)}</option>)}
                </select>
              </label>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{d.poster_url ? t('yc.spg.posterFromNight') : t('yc.spg.noPoster')}</span>
            </Panel>
            <Panel hover={false} pad={22} style={{ gap: 14 }}>
              <b style={{ fontSize: 17 }}>{t('yc.spg.s.fields')}</b>
              <label style={lbl}>{t('yc.spg.f.contact')}
                <select value={d.fields.contact} disabled={ro} onChange={(e) => set('fields', { ...d.fields, contact: e.target.value as 'email' | 'email_phone' })} style={input}>
                  <option value="email">{t('yc.spg.contact.email')}</option>
                  <option value="email_phone">{t('yc.spg.contact.email_phone')}</option>
                </select>
                <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.spg.contactNote')}</span>
              </label>
              {d.fields.questions.map((qq, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: 'var(--sand-50)' }}>
                  <input value={qq.label} maxLength={60} disabled={ro} placeholder={t('yc.spg.qLabel')} onChange={(e) => set('fields', { ...d.fields, questions: d.fields.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} style={input} />
                  <input value={qq.options.join(', ')} disabled={ro} placeholder={t('yc.spg.qOptions')} onChange={(e) => set('fields', { ...d.fields, questions: d.fields.questions.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8) } : x)) })} style={input} />
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Switch on={qq.multi} onChange={(v) => set('fields', { ...d.fields, questions: d.fields.questions.map((x, j) => (j === i ? { ...x, multi: v } : x)) })} label={t('yc.spg.qMulti')} />{t('yc.spg.qMulti')}</span>
                    {!ro && <button type="button" onClick={() => set('fields', { ...d.fields, questions: d.fields.questions.filter((_, j) => j !== i) })} style={{ border: 0, background: 'none', color: 'var(--red-600)', fontWeight: 600, cursor: 'pointer' }}>{t('yc.spg.qRemove')}</button>}
                  </span>
                </div>
              ))}
              {!ro && d.fields.questions.length < 2 && <PillButton size="sm" icon="plus" onClick={() => set('fields', { ...d.fields, questions: [...d.fields.questions, { label: '', options: [], multi: false }] })}>{t('yc.spg.qAdd')}</PillButton>}
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14.5 }}>
                <span>{t('yc.spg.showCount')}<br /><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.spg.showCountSub')}</span></span>
                <Switch on={d.show_count} onChange={(v) => !ro && set('show_count', v)} label={t('yc.spg.showCount')} />
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>{t('yc.spg.consentNote')}</span>
            </Panel>
            <Panel hover={false} pad={22} style={{ gap: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <b style={{ fontSize: 17 }}>{t('yc.spg.s.reward')}</b>
                <Switch on={!!d.reward} onChange={(v) => !ro && set('reward', v ? { label: '', how: '' } : null)} label={t('yc.spg.s.reward')} />
              </span>
              {d.reward && (
                <>
                  <label style={lbl}>{t('yc.spg.f.rewardLabel')}<input value={d.reward.label} maxLength={40} disabled={ro} placeholder={t('yc.spg.rewardPh')} onChange={(e) => set('reward', { label: e.target.value, how: d.reward?.how ?? '' })} style={input} /></label>
                  <label style={lbl}>{t('yc.spg.f.rewardHow')}<input value={d.reward.how} maxLength={140} disabled={ro} onChange={(e) => set('reward', { label: d.reward?.label ?? '', how: e.target.value })} style={input} /></label>
                </>
              )}
            </Panel>
            <Panel hover={false} pad={22} style={{ gap: 14 }}>
              <b style={{ fontSize: 17 }}>{t('yc.spg.s.dates')}</b>
              {(['opens_at', 'sale_opens_at', 'closes_at'] as const).map((k) => (
                <label key={k} style={lbl}>{t(`yc.spg.f.${k}`)}
                  <input type="datetime-local" value={toLocal(d[k])} disabled={ro} onChange={(e) => set(k, fromLocal(e.target.value))} style={input} />
                  <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.spg.f.${k}Sub`)}</span>
                </label>
              ))}
            </Panel>
          </div>
          <div style={{ flex: '0 0 380px', maxWidth: '100%', position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sand-600)' }}>{t('yc.spg.previewT')}</span>
            <div style={{ width: '100%', maxWidth: 380, height: 720, borderRadius: 44, padding: 10, background: '#141012', boxShadow: '0 30px 60px -30px rgba(40,20,20,.5)', boxSizing: 'border-box' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 34, overflow: 'auto', scrollbarWidth: 'none' }}><FanView key={JSON.stringify(d.fields)} page={preview} preview /></div>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.spg.previewS')}</span>
          </div>
        </div>
      )}

      {tab === 'share' && <ShareTab page={page} />}
      {tab === 'stats' && (stats.data ? <StatsTab s={stats.data} page={page} /> : <Skel h={320} r={28} />)}
      <span style={{ display: 'none' }}>{n(0)}</span>
    </main>
  );
}

function QrImg({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let off = false; void QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#141012', light: '#ffffff' } }).then((x) => { if (!off) setSrc(x); }); return () => { off = true; }; }, [url]);
  return src ? <a href={src} download={`qr-${label}.png`} title={label}><img src={src} alt={label} style={{ width: 96, height: 96, borderRadius: 12, display: 'block', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }} /></a> : <Skel w={96} h={96} r={12} />;
}

function ShareTab({ page }: { page: SignupPageRow }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const copy = (u: string) => { void navigator.clipboard?.writeText(u).then(() => toast(t('yc.spg.copied'))); };
  if (page.status === 'draft') return <Panel hover={false}><span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.spg.shareDraft')}</span></Panel>;
  return (
    <Panel hover={false} style={{ gap: 6 }}>
      <b style={{ fontSize: 18 }}>{t('yc.spg.linksT')}</b>
      <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.spg.linksS')}</span>
      {[undefined, ...SIGNUP_SOURCES].map((src, i) => {
        const u = signupUrl(page.slug, src);
        const label = src ? t(`yc.spg.src.${src}`) : t('yc.spg.src.main');
        return (
          <div key={src ?? 'main'} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 0 }}>
            <QrImg url={u} label={src ?? 'page'} />
            <span style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <b>{label}</b>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--sand-600)', overflowWrap: 'anywhere' }}>{u.replace(/^https?:\/\//, '')}</span>
            </span>
            <PillButton size="sm" icon="copy" onClick={() => copy(u)}>{t('yc.spg.copy')}</PillButton>
            <PillButton size="sm" onClick={() => window.open(u, '_blank', 'noopener')}>{t('yc.spg.open')}</PillButton>
          </div>
        );
      })}
    </Panel>
  );
}

function StatsTab({ s, page }: { s: NonNullable<ReturnType<typeof useSignupStats>['data']>; page: SignupPageRow }) {
  const { t, n, pct } = useCrmT();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const caps = useCrmCaps();
  const exportCsv = async () => {
    try {
      const rows = await m.exportRows(page.id);
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = ['first_name', 'email', 'phone', 'answers', 'source', 'signed_up', 'confirmed'];
      const body = rows.map((r) => [r.first_name, r.email, r.phone, JSON.stringify(r.answers), r.src, r.created_at, r.confirmed_at].map(esc).join(';'));
      const blob = new Blob(['﻿' + [head.join(';'), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `inscrits-${page.slug}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { toast(t('yc.spg.err')); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16 }}>
        {([['visits', s.visits], ['entries', s.entries], ['confirmed', s.confirmed]] as const).map(([k, v]) => (
          <Panel key={k} hover={false} pad={20} style={{ gap: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t(`yc.spg.k.${k}`)}</span>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, letterSpacing: '-.04em' }}>{n(v)}</b>
            {k === 'entries' && s.visits > 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.spg.rate', { pct: pct((s.entries / s.visits) * 100, 1) })}</span>}
            {k === 'confirmed' && s.entries > 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.spg.cRate', { pct: pct((s.confirmed / s.entries) * 100) })}</span>}
          </Panel>
        ))}
      </div>
      <Panel hover={false} style={{ gap: 4 }}>
        <b style={{ fontSize: 18 }}>{t('yc.spg.bySrc')}</b>
        <span style={{ fontSize: 13.5, color: 'var(--sand-500)', marginBottom: 6 }}>{t('yc.spg.bySrcS')}</span>
        {s.sources.length === 0 && <span style={{ fontSize: 14, color: 'var(--sand-500)', padding: '12px 0' }}>{t('yc.spg.noData')}</span>}
        {s.sources.map((x, i) => (
          <div key={x.src} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) repeat(4, 80px)', gap: 10, padding: '10px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
            <b>{SIGNUP_SOURCES.includes(x.src as typeof SIGNUP_SOURCES[number]) ? t(`yc.spg.src.${x.src}`) : x.src === 'direct' ? t('yc.spg.src.main') : x.src}</b>
            <span style={{ textAlign: 'right' }}>{n(x.visits)}</span><span style={{ textAlign: 'right' }}>{n(x.entries)}</span><span style={{ textAlign: 'right' }}>{n(x.confirmed)}</span>
            <span style={{ textAlign: 'right', color: 'var(--sand-600)' }}>{x.visits ? pct((x.entries / x.visits) * 100) : '—'}</span>
          </div>
        ))}
      </Panel>
      {Object.keys(s.answers).length > 0 && (
        <Panel hover={false} style={{ gap: 8 }}>
          <b style={{ fontSize: 18 }}>{t('yc.spg.answers')}</b>
          {Object.entries(s.answers).map(([qq, opts]) => (
            <div key={qq} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{qq}</span>
              {Object.entries(opts).sort((a, b) => b[1] - a[1]).map(([o, c]) => <span key={o} style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{o} · {n(c)}</span>)}
            </div>
          ))}
        </Panel>
      )}
      {caps.write && <div><PillButton icon="download" onClick={() => void exportCsv()}>{t('yc.spg.export')}</PillButton></div>}
    </div>
  );
}
