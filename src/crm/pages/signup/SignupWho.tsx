/**
 * Fiche d'une page › Inscrits — design « Pages inscription », onglet
 * « Inscrits », à l'identique : le groupe de contacts de la page (créé tout
 * seul, mis à jour à chaque inscription), « Écrire à ce groupe » (e-mail ou
 * SMS, par l'éditeur de la Console), quatre chiffres, et les neuf derniers
 * inscrits filtrables (nouveaux, déjà clients, pas encore acheté).
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CRM_SMS_SIGNUP_LIVE } from '@/crm/lib/sms';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { setPendingAudience } from '@/crm/data/clients';
import { useSignupMutations } from '@/crm/data/signupPages';
import type { SignupDetail, SignupPageRow } from '@/crm/data/signupPages';
import { SP_ICON } from '@/crm/signup/model';
import { D_DOWN, Seg, SpSvg, anim } from './signupUi';

const SRC_SHORT: Record<string, string> = { story: 'story', dm: 'dm', flyer: 'flyer', bar: 'bar', door: 'door', share: 'shareShort' };

export function groupName(d: SignupPageRow, t: (k: string, v?: Record<string, string | number>) => string, n: (v: number) => string): string {
  if (!d.n) return t('yc.sp.f.grpEmpty');
  return t(`yc.sp.ty.${d.kind}.group`, { n: n(d.n), title: d.title });
}

export default function SignupWho({ d, x }: { d: SignupPageRow; x: SignupDetail }) {
  const { t, n } = useCrmT();
  const caps = useCrmCaps();
  const nav = useNavigate();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const [menu, setMenu] = useState(false);
  const [who, setWho] = useState<'all' | 'new' | 'client' | 'todo'>('all');
  const none = !d.n;
  const venue = d.kind === 'venue';
  const hasSale = d.buyers != null;
  const grp = groupName(d, t, n);

  const write = async (ch: 'email' | 'sms') => {
    setMenu(false);
    const count = ch === 'email' ? x.reach.all_email : x.reach.all_sms;
    if (!count) { toast(t('yc.sp.f.wNone')); return; }
    try {
      const emails = await m.emails(d.id);
      setPendingAudience({ channel: ch, label: grp, emails, count });
      nav(ch === 'email' ? `${CRM_ROUTES.emailTemplates}?from=audience` : CRM_ROUTES.smsCompose('new'));
    } catch {
      toast(t('yc.sp.err'));
    }
  };

  const stats = [
    { n: n(d.n), l: t('yc.sp.f.gs.contacts'), d: t('yc.sp.f.gs.contactsD') },
    { n: n(x.reach.all_email), l: t('yc.sp.f.gs.email'), d: t('yc.sp.f.gs.emailD') },
    { n: n(x.reach.all_sms), l: t('yc.sp.f.gs.sms'), d: t('yc.sp.f.gs.smsD') },
    { n: n(d.fresh), l: t('yc.sp.f.gs.fresh'), d: t('yc.sp.f.gs.freshD', { n: n(Math.max(0, d.n - d.fresh)) }) },
  ];
  const filters: { v: typeof who; l: string }[] = [
    { v: 'all', l: t('yc.sp.f.wf.all') }, { v: 'new', l: t('yc.sp.f.wf.new') }, { v: 'client', l: t('yc.sp.f.wf.client') },
    ...(hasSale ? [{ v: 'todo' as const, l: t('yc.sp.f.wf.todo') }] : []),
  ];
  const ppl = x.people.filter((p) => who === 'all' || (who === 'todo' ? p.status !== 'bought' : p.status === who));
  const SB: Record<string, [string, string, string]> = {
    new: [t('yc.sp.f.ps.new'), 'var(--green-50)', 'var(--green-700)'],
    client: [t('yc.sp.f.ps.client'), 'var(--sand-100)', 'var(--sand-700)'],
    bought: [t('yc.sp.f.ps.bought'), 'var(--ink)', '#fff'],
  };
  const firstQ = d.fields?.questions?.find((q) => !q.party)?.label;
  const ago = (iso: string) => {
    const min = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 6e4));
    return min < 60 ? t('yc.sp.f.agoMin', { n: min }) : min < 60 * 48 ? t('yc.sp.f.agoH', { n: Math.round(min / 60) }) : t('yc.sp.f.agoD', { n: Math.round(min / 1440) });
  };
  const head: CSSProperties = { fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' };
  // Le SMS d'une page d'inscription est « Bientôt » tant que CRM_SMS_SIGNUP_LIVE est faux : l'entrée se voit, ne s'ouvre pas.
  const menuItem = (ch: 'email' | 'sms', d1: string, title: string, sub: string) => {
    const soon = ch === 'sms' && !CRM_SMS_SIGNUP_LIVE;
    return (
      <Hv as="button" type="button" role="menuitem" disabled={soon} aria-disabled={soon} onClick={() => { if (!soon) void write(ch); }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, color: 'var(--ink)', textDecoration: 'none', border: 0, background: 'none', width: '100%', textAlign: 'left', cursor: soon ? 'default' : 'pointer', opacity: soon ? 0.6 : 1 }}
        hover={soon ? undefined : { background: 'var(--sand-50)' }}>
        <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><SpSvg d={d1} size={16} sw={2} /></span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 14.5 }}>{title}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{sub}</span></span>
        {soon && <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.sp.f.wSoon')}</span>}
      </Hv>
    );
  };

  return (
    <>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
            <span style={{ flex: 'none', width: 48, height: 48, borderRadius: 14, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center' }}><SpSvg d={SP_ICON.users} size={22} sw={2} /></span>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.sp.f.grpK')}</span>
              <h2 style={{ margin: '2px 0 0', fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 24, letterSpacing: '-.025em', lineHeight: 1.1 }}>{grp}</h2>
              <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 4 }}>{t('yc.sp.f.grpS1')}<Link to={CRM_ROUTES.segments} style={{ fontWeight: 600 }}>{t('yc.sp.f.grpSeg')}</Link>{t('yc.sp.f.grpS2')}</div>
            </div>
          </div>
          <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {caps.write && (
              <Hv as="button" type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
                style={{ height: 46, padding: '0 6px 0 20px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer' }}
                hover={{ filter: 'brightness(1.05)' }} active={{ transform: 'scale(.97)' }}>
                {t('yc.sp.f.write')}<span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><SpSvg d={D_DOWN} size={15} sw={2.6} /></span>
              </Hv>
            )}
            {menu && (
              <div role="menu" style={{ position: 'absolute', top: 54, right: 0, zIndex: 20, width: 300, boxSizing: 'border-box', padding: 8, borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', animation: anim('sp-pop', 220) }}>
                {menuItem('email', SP_ICON.mail, t('yc.sp.f.wEmail'), t('yc.sp.f.wEmailS', { n: n(x.reach.all_email) }))}
                {menuItem('sms', SP_ICON.sms, t('yc.sp.f.wSms'), t('yc.sp.f.wSmsS', { n: n(x.reach.all_sms) }))}
              </div>
            )}
            <Hv as={Link} to={`${CRM_ROUTES.clients}?src=page`}
              style={{ height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
              hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none' }}>{t('yc.sp.f.seeClients')}</Hv>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 10 }}>
          {stats.map((s) => (
            <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
              <b style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{s.n}</b>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.l}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.35, color: 'var(--sand-500)' }}>{s.d}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sp.f.whoT')}</h2>
            {!none && <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.f.whoS', { k: x.people.length, n: n(d.n) })}</div>}
          </div>
          <Seg aria={t('yc.sp.l.filter')} value={who} onChange={setWho} items={filters} wrap />
        </div>
        <div style={{ borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', overflow: 'hidden' }}>
          <div style={{ ...head, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', padding: '12px 22px', background: 'var(--sand-50)', borderBottom: '1px solid var(--sand-100)' }}>
            <span style={{ flex: '1 1 240px' }}>{t('yc.sp.f.wh.who')}</span>
            <span style={{ flex: '0 0 130px' }}>{venue ? t('yc.sp.f.wh.venue') : firstQ === t('yc.sp.w.qStyle') ? t('yc.sp.f.wh.style') : t('yc.sp.f.wh.answer')}</span>
            <span style={{ flex: '0 0 130px' }}>{t('yc.sp.f.wh.src')}</span>
            <span style={{ flex: '0 0 120px' }}>{t('yc.sp.f.wh.ago')}</span>
            <span style={{ flex: '0 0 130px' }}>{t('yc.sp.f.wh.st')}</span>
          </div>
          {ppl.map((p, i) => {
            const sb = SB[p.status];
            const nonParty = Object.entries(p.answers ?? {}).find(([k]) => k === firstQ)?.[1];
            const ans = venue ? (p.party ? t('yc.sp.f.comesWith', { n: p.party >= 4 ? '4+' : p.party }) : '—') : nonParty ? (Array.isArray(nonParty) ? nonParty.join(', ') : nonParty) : '—';
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
            return (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 22px', borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600 }}>{(p.first_name || '?')[0].toUpperCase()}</span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontSize: 15 }}>{name}</b>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email ?? p.phone}{!p.confirmed ? ` · ${t('yc.sp.f.ps.pending')}` : ''}</span>
                  </span>
                </span>
                <span style={{ flex: '0 0 130px', fontSize: 14 }}>{ans}</span>
                <span style={{ flex: '0 0 130px', fontSize: 14, color: 'var(--sand-600)' }}>{t(`yc.sp.src.${SRC_SHORT[p.src ?? ''] ?? 'directShort'}`)}</span>
                <span style={{ flex: '0 0 120px', fontSize: 14, color: 'var(--sand-600)' }}>{ago(p.at)}</span>
                <span style={{ flex: '0 0 130px' }}><span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: sb[1], color: sb[2] }}>{sb[0]}</span></span>
              </div>
            );
          })}
          {ppl.length === 0 && <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 15, color: 'var(--sand-600)', borderTop: '1px solid var(--sand-100)' }}>{none ? t('yc.sp.f.noPeople') : t('yc.sp.f.noPeopleCat')}</div>}
          {ppl.length > 0 && (
            <div style={{ padding: '12px 22px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', fontSize: 13.5, color: 'var(--sand-600)' }}>
              {t('yc.sp.f.peopleFoot', { k: ppl.length, n: n(d.n) })} · <Link to={`${CRM_ROUTES.clients}?src=page`} style={{ fontWeight: 600 }}>{t('yc.sp.f.seeAll')}</Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
