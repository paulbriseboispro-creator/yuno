/**
 * Compte › Aide et contact : recherche dans les réponses fréquentes, thèmes,
 * accordéon (avec un lien vers l'écran qui répond), puis « Écrivez-nous » —
 * le message part dans le flux de retours du super admin (feedback_issues,
 * alerte /admin/alerts) avec l'espace et l'adresse de réponse.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { Card } from './accountUi';
import { FeatureRequestCard, NpsCard } from './HelpFeedback';

type Cat = 'all' | 'start' | 'yunits' | 'clients' | 'account';
const CATS: Cat[] = ['all', 'start', 'yunits', 'clients', 'account'];
const FAQ: { id: string; c: Exclude<Cat, 'all'>; to?: string }[] = [
  { id: 'shotgun', c: 'start', to: CRM_ROUTES.connectors },
  { id: 'sync', c: 'start' },
  { id: 'import', c: 'clients', to: CRM_ROUTES.imports },
  { id: 'cost', c: 'yunits', to: CRM_ROUTES.yunits },
  { id: 'order', c: 'yunits', to: CRM_ROUTES.yunits },
  { id: 'skip', c: 'yunits' },
  { id: 'regular', c: 'clients', to: CRM_ROUTES.clients },
  { id: 'team', c: 'account', to: CRM_ROUTES.accountSection('team') },
  { id: 'invoices', c: 'account', to: CRM_ROUTES.accountSection('billing') },
  { id: 'cancel', c: 'account', to: CRM_ROUTES.accountSection('billing') },
  { id: 'journey', c: 'clients', to: CRM_ROUTES.journey },
  { id: 'signup', c: 'clients', to: CRM_ROUTES.signupPages },
  { id: 'auto', c: 'start', to: CRM_ROUTES.automations },
  { id: 'sms', c: 'yunits', to: CRM_ROUTES.sms },
  { id: 'sales', c: 'clients', to: CRM_ROUTES.sales },
  { id: 'trial', c: 'account', to: CRM_ROUTES.accountSection('billing') },
  { id: 'offline', c: 'account' },
  // Billetterie ⇄ CRM sur le même compte (migration 20261006100000).
  { id: 'ticketing', c: 'account', to: '/open/suite' },
];
/** Sujet → catégorie et priorité du retour (comme le formulaire de la Suite). */
const SUBJECTS: { k: string; category: string; priority: string }[] = [
  { k: 'yc.acc.h.s1', category: 'question', priority: 'medium' },
  { k: 'yc.acc.h.s2', category: 'bug', priority: 'high' },
  { k: 'yc.acc.h.s3', category: 'question', priority: 'medium' },
  { k: 'yc.acc.h.s4', category: 'feature', priority: 'low' },
];
const SUPPORT_EMAIL = 'contact@yunoapp.eu';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function AccountHelp() {
  const { t, lang } = useCrmT();
  const { user } = useAuth();
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const [hq, setHq] = useState('');
  const [focus, setFocus] = useState(false);
  const [cat, setCat] = useState<Cat>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [subj, setSubj] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const myEmail = user?.email ?? '';

  const q = fold(hq.trim());
  const list = FAQ.filter((x) => (cat === 'all' || x.c === cat) && (!q || fold(`${t(`yc.faq.${x.id}.q`)} ${t(`yc.faq.${x.id}.a`)}`).includes(q)));
  const msgOk = msg.trim().length >= 10;
  const canSend = msgOk && !busy;

  const send = async () => {
    if (!canSend || !user) return;
    setBusy(true);
    const s = SUBJECTS[subj];
    const scope = space.kind === 'venue' ? `club ${space.venueId}` : `organisation ${space.organizerUserId}`;
    const { error } = await supabase.from('feedback_issues').insert({
      title: `[Yuno CRM] ${t(s.k)} · ${space.name}`.slice(0, 200),
      description: `${msg.trim()}\n\n— ${myEmail} · ${scope} · ${lang}`.slice(0, 5000),
      category: s.category,
      priority: s.priority,
      reported_by: user.id,
      venue_id: space.venueId,
    });
    setBusy(false);
    if (error) { toast(t('yc.acc.h.err')); return; }
    setSent(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <NpsCard />
      <Card gap={20} style={{ animation: `yc-rise 700ms ${EASE} 40ms both` }}>
        <label style={{ height: 58, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px 0 20px', borderRadius: 99, background: 'var(--paper)', border: `1px solid ${focus ? 'var(--red-400)' : 'var(--sand-200)'}`, boxShadow: focus ? '0 0 0 3px var(--red-100)' : 'none', cursor: 'text', transition: 'border-color 160ms,box-shadow 160ms' }}>
          <Icon name="search" size={19} stroke={2.2} style={{ flex: 'none', color: 'var(--sand-500)' }} />
          <input value={hq} onChange={(e) => { setHq(e.target.value); setOpen(null); }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} autoComplete="off" aria-label={t('yc.acc.h.searchL')} placeholder={t('yc.acc.h.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 16, color: 'var(--ink)' }} />
          {hq && (
            <Hv as="button" type="button" onClick={() => setHq('')} aria-label={t('yc.acc.h.clear')} style={{ flex: 'none', width: 34, height: 34, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
              <Icon name="x" size={14} stroke={2.6} />
            </Hv>
          )}
        </label>
        <div role="tablist" aria-label={t('yc.acc.h.cats')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CATS.map((c) => {
            const on = cat === c;
            return (
              <Hv key={c} as="button" type="button" role="tab" aria-selected={on} onClick={() => { setCat(c); setOpen(null); }} style={{ height: 40, padding: '0 16px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--sand-700)', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: `background 200ms,color 200ms,border-color 200ms,transform 200ms ${SPRING}` }} hover={{ transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
                {t(`yc.acc.h.c.${c}`)}
              </Hv>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {list.map((x, i) => {
            const on = open === x.id;
            return (
              <div key={`${cat}-${q}-${x.id}`} style={{ borderTop: '1px solid var(--sand-100)', animation: `yc-rise 480ms ${EASE} ${Math.min(i, 8) * 45}ms both` }}>
                <Hv as="button" type="button" onClick={() => setOpen(on ? null : x.id)} aria-expanded={on} style={{ width: '100%', minHeight: 60, padding: '14px 0', border: 0, background: 'none', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', cursor: 'pointer', fontSize: 16, fontWeight: 600, color: 'var(--ink)', transition: 'color 160ms' }} hover={{ color: 'var(--red-600)' }}>
                  <span style={{ flex: 1, minWidth: 0, textWrap: 'pretty' }}>{t(`yc.faq.${x.id}.q`)}</span>
                  <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: 'var(--sand-50)', color: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
                    <Icon name="plus" size={15} stroke={2.4} style={{ transform: `rotate(${on ? 45 : 0}deg)`, transition: `transform 320ms ${SPRING}` }} />
                  </span>
                </Hv>
                <div style={{ display: 'grid', gridTemplateRows: on ? '1fr' : '0fr', transition: `grid-template-rows 420ms ${EASE}` }}>
                  <div style={{ overflow: 'hidden', minHeight: 0 }}>
                    <div style={{ padding: '0 46px 18px 0', display: 'flex', flexDirection: 'column', gap: 12, opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(-6px)', transition: `opacity 360ms ease,transform 460ms ${EASE}` }}>
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.faq.${x.id}.a`)}</p>
                      {x.to && (
                        <Hv as={Link} to={x.to} tabIndex={on ? 0 : -1} style={{ alignSelf: 'flex-start', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
                          {t(`yc.faq.${x.id}.l`)}<Icon name="arrowRight" size={15} stroke={2.4} />
                        </Hv>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div style={{ borderTop: '1px solid var(--sand-100)', padding: '36px 12px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', animation: `yc-rise 520ms ${EASE} both` }}>
              <YunitFace mood="inquiet" size={64} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{t('yc.acc.h.none', { q: hq.trim() })}</span>
                <span style={{ fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.acc.h.noneS')}</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 20, animation: `yc-rise 700ms ${EASE} 200ms both` }}>
        <Card gap={18} style={{ flex: '1 1 380px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.acc.h.form.t')}</h2>
            <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.acc.h.form.s')}</span>
          </div>
          {!sent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.acc.h.subject')}</span>
                <span style={{ position: 'relative', display: 'block' }}>
                  <select value={subj} onChange={(e) => setSubj(parseInt(e.target.value, 10))} className="yc-field" style={{ width: '100%', height: 48, boxSizing: 'border-box', padding: '0 40px 0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 0, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}>
                    {SUBJECTS.map((s, i) => <option key={s.k} value={i}>{t(s.k)}</option>)}
                  </select>
                  <Icon name="chevronDown" size={16} stroke={2.2} style={{ position: 'absolute', right: 14, top: 16, pointerEvents: 'none', color: 'var(--sand-400)' }} />
                </span>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.acc.h.msg')}</span>
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={5} maxLength={4000} placeholder={t('yc.acc.h.msgPh')} className="yc-field" style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, lineHeight: 1.5, color: 'var(--ink)', outline: 0, resize: 'vertical', minHeight: 132, fontFamily: 'inherit' }} />
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.acc.h.replyTo', { email: myEmail })}</span>
              </label>
              <div>
                <Hv
                  as="button"
                  type="button"
                  onClick={() => void send()}
                  disabled={!canSend}
                  style={{ height: 48, padding: '0 6px 0 22px', border: 0, borderRadius: 99, background: canSend || busy ? 'var(--gradient-brand)' : 'var(--sand-100)', color: canSend || busy ? '#fff' : 'var(--sand-500)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: canSend || busy ? 'var(--shadow-cta)' : 'none', cursor: canSend ? 'pointer' : 'not-allowed', transition: `transform 200ms ${SPRING},filter 160ms,background 200ms` }}
                  hover={canSend ? { filter: 'brightness(1.05)', transform: 'translateY(-1px)' } : {}}
                  active={canSend ? { transform: 'scale(.97)' } : {}}
                >
                  {t(busy ? 'yc.acc.h.sending' : 'yc.acc.h.send')}
                  <span style={{ width: 36, height: 36, borderRadius: 99, background: canSend || busy ? '#fff' : 'var(--sand-200)', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}>
                    {busy ? <span style={{ width: 16, height: 16, borderRadius: 99, border: '2.4px solid var(--red-200)', borderTopColor: 'var(--red-500)', animation: 'yc-spin 700ms linear infinite' }} /> : <Icon name="send" size={16} stroke={2.2} />}
                  </span>
                </Hv>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center', padding: '24px 8px', animation: `yc-pop 520ms ${EASE} both` }}>
              <YunitFace mood="ravi" size={84} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.acc.h.sentT')}</span>
                <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 320, textWrap: 'pretty' }}>{t('yc.acc.h.sentS', { email: myEmail })}</span>
              </div>
              <Hv as="button" type="button" onClick={() => { setSent(false); setMsg(''); }} style={{ height: 42, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ background: 'var(--paper)', borderColor: 'var(--sand-300)' }}>
                {t('yc.acc.h.again')}
              </Hv>
            </div>
          )}
        </Card>

        <aside style={{ flex: '1 1 280px', minWidth: 0, boxSizing: 'border-box', borderRadius: 28, padding: 'clamp(22px,2.6vw,34px)', color: 'var(--text-on-night)', background: 'radial-gradient(80% 60% at 100% 0%,rgba(255,107,53,.38),transparent 65%),radial-gradient(70% 60% at 0% 100%,rgba(227,20,27,.4),transparent 70%),var(--noise-night),var(--night)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 28, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <YunitFace mood="content" size={52} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,2.4vw,30px)', letterSpacing: '-.035em', lineHeight: 1.08, textWrap: 'balance' }}>{t('yc.acc.h.human.t')}</span>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-on-night-2)' }}>{t('yc.acc.h.human.s')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Hv as="a" href={`mailto:${SUPPORT_EMAIL}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: '1px solid var(--border-night)', color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none' }} hover={{ color: '#fff', textDecoration: 'underline' }}>
              <Icon name="mail" size={18} stroke={2} />{SUPPORT_EMAIL}
            </Hv>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: '1px solid var(--border-night)', fontSize: 14.5, color: 'var(--text-on-night-2)' }}>
              <Icon name="clock" size={18} stroke={2} />{t('yc.acc.h.hours')}
            </div>
          </div>
        </aside>
      </div>
      <FeatureRequestCard />
    </div>
  );
}
