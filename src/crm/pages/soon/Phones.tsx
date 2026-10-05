/**
 * Téléphones d'exemple des pages « Bientôt » : un châssis commun (design
 * « InstagramPhone », 300 × 610) et deux écrans — Instagram (commentaire,
 * puis message privé) et page d'inscription (la page, puis « C'est noté »).
 */
import type { ReactNode } from 'react';
import { useCrmT } from '@/crm/i18n';

const SF = "-apple-system,'SF Pro Text','SF Pro',system-ui,sans-serif";

export function PhoneFrame({ children, time = '18:42', dark }: { children: ReactNode; time?: string; dark?: boolean }) {
  return (
    <div style={{ position: 'relative', width: 300, height: 610, flex: 'none', fontFamily: SF, color: '#262626' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 46, padding: 7, background: 'linear-gradient(135deg,#fafbfc 0%,#d3d6da 25%,#f6f7f9 50%,#c2c6cb 75%,#f3f4f6 100%)', boxShadow: '0 22px 44px -14px rgba(28,21,23,.38),0 2px 6px rgba(28,21,23,.12)' }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 40, padding: 5, background: '#0b0b0c' }}>
          <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 35, overflow: 'hidden', background: dark ? '#120C0E' : '#fff', display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'absolute', left: '50%', top: 8, marginLeft: -40, width: 80, height: 23, borderRadius: 99, background: '#000', zIndex: 3 }} />
            <div style={{ flex: 'none', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 24px 0 28px', fontSize: 13.5, fontWeight: 600, color: dark ? '#fff' : '#000' }}>
              <span>{time}</span>
              <svg width="22" height="11" viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3.4" stroke={dark ? '#fff' : '#000'} opacity=".4" /><rect x="2" y="2" width="18" height="8" rx="2.2" fill={dark ? '#fff' : '#000'} /></svg>
            </div>
            {children}
            <div style={{ flex: 'none', height: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}><i style={{ width: 92, height: 4, borderRadius: 99, background: dark ? '#fff' : '#000', display: 'block' }} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const handleOf = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '') || 'votreclub';
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'Y';

/** Instagram : sous le post (scene 0-2 fait apparaître commentaire et réponse), puis le message privé (scene 3). */
export function InstagramPhone({ tab, scene, clubName, city, keyword, message, button, reply }: {
  tab: 'comment' | 'dm'; scene: number; clubName: string; city: string | null;
  /** Aperçu d'une règle en cours d'édition (écran Instagram) ; sinon le texte d'exemple. */
  keyword?: string; message?: string; button?: string; reply?: string;
}) {
  const { t } = useCrmT();
  const club = handleOf(clubName);
  const ini = initialsOf(clubName);
  const kw = keyword ? keyword.toUpperCase() : t('yc.ig.kw');
  const fan = 'lea.mrt';
  const msg = message !== undefined ? message.replace(/\{pseudo\}/g, `@${fan}`) : t('yc.ig.msg', { pseudo: `@${fan}` });
  const btn = button || t('yc.ig.btn');
  const rep = reply || t('yc.ig.reply');
  const show = (n: number, dy: number) => ({ opacity: scene >= n ? 1 : 0, transform: `translateY(${scene >= n ? 0 : dy}px)`, transition: 'opacity 380ms,transform 380ms cubic-bezier(.22,1,.36,1)' });
  const avatar = (size: number, fs: number) => (
    <span style={{ flex: 'none', width: size, height: size, borderRadius: 99, background: '#1C1517', color: '#fff', display: 'grid', placeItems: 'center', fontSize: fs, fontWeight: 700 }}>{ini}</span>
  );
  return (
    <PhoneFrame>
      {tab === 'comment' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 'none', height: 44, display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px' }}>
            <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, padding: 2, background: 'var(--gradient-brand)' }}>
              <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', borderRadius: 99, background: '#1C1517', color: '#fff', border: '2px solid #fff', fontSize: 9.5, fontWeight: 700 }}>{ini}</span>
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}><b style={{ fontSize: 12.5, fontWeight: 600 }}>{club}</b><span style={{ fontSize: 10.5, color: '#737373' }}>{city ?? ''}</span></span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#262626"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
          </div>
          <div style={{ flex: 'none', height: 168, display: 'grid', placeItems: 'center', background: 'repeating-linear-gradient(135deg,#f1eeed 0 10px,#e9e5e4 10px 20px)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#857B7D' }}>{t('yc.ig.postVisual')}</span>
          </div>
          <div style={{ flex: 'none', height: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
            <span style={{ display: 'flex', gap: 13 }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={1.9} strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={1.9} strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round"><path d="m22 2-7 20-4-9-9-4zM22 2 11 13" /></svg>
            </span>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={1.9} strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
          </div>
          <div style={{ flex: 'none', padding: '0 12px 6px', fontSize: 12, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}><b style={{ fontWeight: 600 }}>{club}</b> {t('yc.ig.caption')}</div>
          <div style={{ flex: 1, minHeight: 0, padding: '4px 12px 0', display: 'flex', flexDirection: 'column', gap: 9, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 99, background: '#d9d9dd' }} />
              <div style={{ fontSize: 12, lineHeight: 1.3 }}><b style={{ fontWeight: 600 }}>tom.d75</b> {kw}
                <div style={{ fontSize: 10, color: '#737373', marginTop: 1 }}>{t('yc.ig.min12')} · {t('yc.ig.reply1')}</div>
                <div style={{ display: 'flex', gap: 7, marginTop: 6 }}>{avatar(18, 7)}<div><b style={{ fontWeight: 600 }}>{club}</b> {rep}</div></div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, ...show(1, 10) }}>
              <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 99, background: '#c9d4e4' }} />
              <div style={{ fontSize: 12, lineHeight: 1.3 }}><b style={{ fontWeight: 600 }}>{fan}</b> {kw}
                <div style={{ fontSize: 10, color: '#737373', marginTop: 1 }}>{t('yc.ig.justNow')} · {t('yc.ig.reply1')}</div>
                <div style={{ display: 'flex', gap: 7, marginTop: 6, ...show(2, 8) }}>{avatar(18, 7)}<div><b style={{ fontWeight: 600 }}>{club}</b> {rep}</div></div>
              </div>
            </div>
          </div>
          <div style={{ flex: 'none', height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderTop: '.5px solid #dbdbdb', fontSize: 12, color: '#8e8e8e' }}><span style={{ width: 22, height: 22, borderRadius: 99, background: '#d9d9dd' }} />{t('yc.ig.addComment')}</div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 'none', height: 52, display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', borderBottom: '.5px solid #efefef' }}>
            <svg width="10" height="17" viewBox="0 0 12 20" fill="none" stroke="#262626" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M10 2 2.5 10 10 18" /></svg>
            {avatar(30, 9.5)}
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}><b style={{ fontSize: 13, fontWeight: 600 }}>{clubName}</b><span style={{ fontSize: 10.5, color: '#737373' }}>{club}</span></span>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
            <span style={{ alignSelf: 'center', fontSize: 10, color: '#8e8e8e', letterSpacing: '.02em' }}>{t('yc.ig.today')} 18:42</span>
            <span style={{ alignSelf: 'center', fontSize: 10.5, color: '#8e8e8e', marginBottom: 6 }}>{t('yc.ig.replied', { club: clubName })}</span>
            <div style={{ alignSelf: 'flex-start', maxWidth: '84%', display: 'flex', flexDirection: 'column', gap: 5, ...show(3, 12) }}>
              <div style={{ padding: '9px 13px', borderRadius: 20, background: '#efefef', fontSize: 13, lineHeight: 1.35, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg}</div>
              <div style={{ height: 38, borderRadius: 19, border: '1px solid #dbdbdb', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: '#0064e0', padding: '0 12px', textAlign: 'center' }}>{btn}</div>
            </div>
          </div>
          <div style={{ flex: 'none', height: 44, margin: '0 10px 6px', borderRadius: 99, border: '1px solid #dbdbdb', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 12.5, color: '#8e8e8e' }}>{t('yc.ig.message')}</div>
        </div>
      )}
    </PhoneFrame>
  );
}

/** Page d'inscription : la page (prévente, compte à rebours, champs), puis « C'est noté ». */
export function SignupPhone({ tab, clubName }: { tab: 'page' | 'done'; clubName: string }) {
  const { t } = useCrmT();
  const ini = initialsOf(clubName);
  const head = (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 10px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 700 }}>{ini}</span>
        <b style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{clubName}</b>
      </span>
      <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <i style={{ width: 5, height: 5, borderRadius: 99, background: '#FF5A4E' }} />{t('yc.sp.presale')}
      </span>
    </div>
  );
  const bg = 'radial-gradient(120% 70% at 100% 0%,rgba(227,20,27,.45),transparent 60%),repeating-linear-gradient(135deg,rgba(255,255,255,.03) 0 12px,transparent 12px 24px),#120C0E';
  return (
    <PhoneFrame dark>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: bg, color: '#fff' }}>
        {head}
        {tab === 'page' ? (
          <div key="page" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: '22px 16px 14px', animation: 'yc-rise 420ms cubic-bezier(.22,1,.36,1) both' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>{t('yc.sp.when')}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: '-.04em' }}>{t('yc.sp.night')}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'rgba(255,255,255,.75)' }}>{t('yc.sp.pitch')}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 11, borderRadius: 14, background: 'rgba(255,255,255,.07)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)' }}>{t('yc.sp.opensIn')}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                {[['03', 'd'], ['22', 'h'], ['38', 'm'], ['56', 's']].map(([v, k]) => (
                  <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', borderRadius: 9, background: 'rgba(255,255,255,.08)' }}>
                    <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '-.02em' }}>{v}</b>
                    <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t(`yc.sp.cd.${k}`)}</span>
                  </div>
                ))}
              </div>
            </div>
            {[t('yc.sp.first'), t('yc.sp.contact')].map((ph) => (
              <div key={ph} style={{ height: 36, borderRadius: 10, background: 'rgba(255,255,255,.08)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{ph}</div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'rgba(255,255,255,.7)' }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: '#fff', color: '#E3141B', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800 }}>✓</span>{t('yc.sp.agree')}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ height: 42, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 0 16px', fontSize: 13.5, fontWeight: 600, boxShadow: '0 10px 24px -10px rgba(227,20,27,.8)' }}>
              {t('yc.sp.cta')}<span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: '#E3141B', display: 'grid', placeItems: 'center' }}>→</span>
            </div>
          </div>
        ) : (
          <div key="done" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: '22px 16px 14px', animation: 'yc-rise 420ms cubic-bezier(.22,1,.36,1) both' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: '-.04em' }}>{t('yc.sp.night')}</span>
            <span style={{ width: 52, height: 52, borderRadius: 99, background: 'var(--gradient-brand)', display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800, marginTop: 8, boxShadow: '0 10px 24px -10px rgba(227,20,27,.8)' }}>✓</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, lineHeight: 1.05, letterSpacing: '-.03em' }}>{t('yc.sp.doneTitle')}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'rgba(255,255,255,.75)' }}>{t('yc.sp.doneSub')}</span>
            <div style={{ flex: 1 }} />
            <div style={{ height: 42, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13.5, fontWeight: 600 }}>{t('yc.sp.doneCal')}</div>
            <div style={{ height: 42, borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13.5, fontWeight: 600 }}>{t('yc.sp.doneShare')}</div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}
