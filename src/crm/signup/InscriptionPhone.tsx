/**
 * Le téléphone d'aperçu des Pages d'inscription (« InscriptionPhone » du
 * design, à l'identique) : châssis d'iPhone 360 × 740 mis à l'échelle, qui
 * montre la page du fan (formulaire, « C'est noté », jour de l'ouverture, page
 * close) ou le message qu'il recevra (e-mail dans Mail, SMS dans Messages).
 */
import { useCrmT } from '@/crm/i18n';
import FanPage from './FanPage';
import type { FanCfg, FanScene } from './FanPage';
import { venueAt } from '@/crm/lib/emailTemplates';
import { initials, tokens, venueOf, withFirstName } from './model';

export type PhoneScene = 'page' | 'noted' | 'open' | 'closed' | 'soon' | 'email' | 'sms';

const LINK_RE = /(yunoapp\.eu\/\S+|crm\.yunoapp\.eu\/\S+)/;

export default function InscriptionPhone({ cfg, scene = 'page', scale = 0.9, msgText, onToast }: {
  cfg: FanCfg;
  scene?: PhoneScene;
  scale?: number;
  /** Texte du message (relance) ; « {prénom} » devient « Camille ». Sinon le message du type. */
  msgText?: string;
  onToast?: (m: string) => void;
}) {
  const { t, lang } = useCrmT();
  const sc = scale;
  const K = tokens(cfg.design);
  const isFan = scene === 'page' || scene === 'noted' || scene === 'open' || scene === 'closed' || scene === 'soon';
  const isEmail = scene === 'email', isSms = scene === 'sms';
  const fanScene: FanScene = ({ page: 'form', noted: 'noted', open: 'open', closed: 'closed', soon: 'soon' } as Record<string, FanScene>)[scene] ?? 'form';
  const club = cfg.club || 'Yuno';
  const title = cfg.title;
  const kind = cfg.kind;
  const link = cfg.pageUrl ? cfg.pageUrl.replace(/^https?:\/\//, '') : 'crm.yunoapp.eu/j/k7Qp2';
  const demo = t('yc.sp.fan.demoName');
  const reward = cfg.reward.on ? (cfg.reward.preset === 'custom' ? (cfg.reward.label || t('yc.sp.rw.customFan')) : t(`yc.sp.rw.${cfg.reward.preset}.fan`)) : t('yc.sp.rw.customFan');
  const vars = { title, club, at: venueAt(club, lang), reward, of: venueOf(club, lang) };
  const base = msgText ?? t(`yc.sp.ty.${kind}.msg`, { ...vars, 'prénom': '{prénom}' });
  const msg = withFirstName(base, demo);
  const sms = `${msg} ${link}${t('yc.sp.ph.stop')}`;
  const smsParts = sms.split(LINK_RE).filter(Boolean).map((x) => (LINK_RE.test(x) ? { x, c: '#007AFF', u: 'underline' } : { x, c: '#000', u: 'none' }));
  const mailBody = msgText ? msg : t(`yc.sp.ty.${kind}.mailBody`, vars);
  const grad = `linear-gradient(110deg,${K.a},${K.b})`;
  const time = isFan ? '14:21' : '18:00';
  const sbFg = isFan && K.dark ? '#fff' : '#000';

  const btn = (top: number, h: number, side: 'left' | 'right') => (
    <i style={{ position: 'absolute', [side]: -4, top, width: 4, height: h, borderRadius: side === 'left' ? '2.5px 0 0 2.5px' : '0 2.5px 2.5px 0', background: `linear-gradient(${side === 'left' ? 90 : 270}deg,#aeb2b7,#eceef1)`, boxShadow: '0 0 0 .5px rgba(0,0,0,.18)' }} />
  );

  return (
    <div style={{ width: Math.round(360 * sc), height: Math.round(740 * sc), position: 'relative', flex: 'none' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 360, height: 740, transform: `scale(${sc})`, transformOrigin: 'top left', fontFamily: "-apple-system,'SF Pro Text','SF Pro',system-ui,sans-serif" }}>
        {btn(110, 24, 'left')}{btn(158, 46, 'left')}{btn(214, 46, 'left')}{btn(170, 72, 'right')}
        <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: 56, padding: 5, background: 'linear-gradient(135deg,#fafbfc 0%,#d3d6da 20%,#f6f7f9 40%,#c2c6cb 58%,#f3f4f6 78%,#d0d3d8 100%)', boxShadow: '0 22px 44px -14px rgba(28,21,23,.38),0 2px 6px rgba(28,21,23,.12),inset 0 0 0 .75px rgba(255,255,255,.9)' }}>
          <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: 51, padding: 5, background: '#0b0b0c', boxShadow: 'inset 0 0 0 1px #2a2b2e' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 46, overflow: 'hidden', background: isFan ? K.bg : '#fff' }}>
              <div style={{ position: 'absolute', left: '50%', top: 11, marginLeft: -47, width: 94, height: 28, borderRadius: 99, background: '#000', zIndex: 6 }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 50, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 30px 0 36px', fontSize: 15.5, fontWeight: 600, letterSpacing: '-.02em', color: sbFg, pointerEvents: 'none' }}>
                <span>{time}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx=".8" /><rect x="4.7" y="5" width="3" height="6" rx=".8" /><rect x="9.4" y="2.5" width="3" height="8.5" rx=".8" /><rect x="14" y="0" width="3" height="11" rx=".8" /></svg>
                  <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3.4" stroke="currentColor" opacity=".4" /><rect x="2" y="2" width="18" height="8" rx="2.2" fill="currentColor" /><path d="M23 4v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill="currentColor" opacity=".45" /></svg>
                </span>
              </div>

              {isFan && <div style={{ position: 'absolute', inset: 0 }}><FanPage cfg={cfg} scene={fanScene} mode="preview" onToast={onToast} /></div>}

              {isEmail && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff', color: '#1C1517' }}>
                  <div style={{ flex: 'none', padding: '54px 16px 0', display: 'flex', alignItems: 'center', gap: 4, color: '#007AFF', fontSize: 16 }}>
                    <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="#007AFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2 2.5 10 10 18" /></svg>{t('yc.sp.ph.inbox')}
                  </div>
                  <div style={{ flex: 'none', padding: '14px 18px 12px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '.5px solid rgba(60,60,67,.18)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 99, background: K.a, color: K.aFg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{initials(club)}</span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}><b style={{ fontSize: 15, fontWeight: 600 }}>{club}</b><span style={{ fontSize: 12.5, color: '#8e8e93' }}>{t('yc.sp.ph.toMe')}</span></span>
                      <span style={{ fontSize: 12.5, color: '#8e8e93' }}>{time}</span>
                    </div>
                    <b style={{ fontSize: 19, lineHeight: 1.2, letterSpacing: '-.02em', fontWeight: 700, textWrap: 'balance' as never }}>{t(`yc.sp.ty.${kind}.subject`, vars)}</b>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none', background: '#F2F2F4', padding: 14 }}>
                    <div style={{ borderRadius: 18, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                      <div style={{ padding: '20px 20px 22px', background: `radial-gradient(90% 120% at 100% 0%,rgba(255,255,255,.28),transparent 60%),${grad}`, color: K.aFg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontFamily: "'Geist Mono',ui-monospace,monospace", fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.85 }}>{club} · {title}</span>
                        <span style={{ fontFamily: "'Bricolage Grotesque',system-ui,sans-serif", fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.035em' }}>{t(`yc.sp.ty.${kind}.mailHead`)}</span>
                      </div>
                      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <span style={{ fontSize: 15.5, lineHeight: 1.5 }}>{t('yc.sp.ph.hi', { name: demo })}</span>
                        <span style={{ fontSize: 15.5, lineHeight: 1.5, textWrap: 'pretty' as never }}>{mailBody}</span>
                        <span style={{ alignSelf: 'flex-start', height: 48, padding: '0 24px', borderRadius: 99, background: grad, color: K.aFg, display: 'inline-flex', alignItems: 'center', fontSize: 15.5, fontWeight: 600 }}>{t(`yc.sp.ty.${kind}.mailBtn`)}</span>
                        <span style={{ fontSize: 12, lineHeight: 1.45, color: '#8e8e93', paddingTop: 6, borderTop: '1px solid #EEE' }}>{t('yc.sp.ph.mailFoot', { title, club })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isSms && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff', color: '#000' }}>
                  <div style={{ flex: 'none', padding: '50px 0 9px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'linear-gradient(#fff,rgba(247,247,248,.96))', borderBottom: '.5px solid rgba(60,60,67,.18)', position: 'relative' }}>
                    <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="#007AFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 18, top: 58 }}><path d="M10 2 2.5 10 10 18" /></svg>
                    <span style={{ width: 46, height: 46, borderRadius: 99, overflow: 'hidden', position: 'relative', background: 'linear-gradient(#b4b6bd,#8f9199)', display: 'block' }}>
                      <i style={{ position: 'absolute', left: 15, top: 8, width: 16, height: 16, borderRadius: 99, background: '#f2f2f5', display: 'block' }} />
                      <i style={{ position: 'absolute', left: 8, top: 27, width: 30, height: 30, borderRadius: 99, background: '#f2f2f5', display: 'block' }} />
                    </span>
                    <span style={{ fontSize: 12, letterSpacing: '-.01em' }}>{club.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) || 'YUNO'}</span>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ alignSelf: 'center', fontSize: 11, color: '#8e8e93', marginBottom: 6 }}><b style={{ fontWeight: 600 }}>SMS</b> · {t('yc.sp.ph.smsToday', { time })}</span>
                    <div style={{ position: 'relative', alignSelf: 'flex-start', maxWidth: '84%', marginLeft: 6 }}>
                      <div style={{ position: 'relative', zIndex: 1, padding: '9px 14px 10px', borderRadius: 19, background: '#E9E9EB', fontSize: 16, lineHeight: 1.28, letterSpacing: '-.012em', wordBreak: 'break-word' }}>
                        {smsParts.map((p, i) => <span key={i} style={{ color: p.c, textDecoration: p.u }}>{p.x}</span>)}
                      </div>
                      <i style={{ position: 'absolute', left: -5, bottom: 0, width: 18, height: 16, background: '#E9E9EB', borderBottomRightRadius: '14px 12px', zIndex: 0, display: 'block' }} />
                      <i style={{ position: 'absolute', left: -12, bottom: 0, width: 12, height: 18, background: '#fff', borderBottomRightRadius: 10, zIndex: 2, display: 'block' }} />
                    </div>
                  </div>
                  <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 30px' }}>
                    <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: '#E9E9EB', display: 'grid', placeItems: 'center' }}><svg width="14" height="14" viewBox="0 0 14 14" stroke="#6b6b70" strokeWidth="1.8" strokeLinecap="round"><path d="M7 1.5v11M1.5 7h11" /></svg></span>
                    <span style={{ flex: 1, height: 34, boxSizing: 'border-box', borderRadius: 99, border: '1px solid rgba(60,60,67,.22)', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 15, color: '#a3a3a8' }}>{t('yc.sp.ph.message')}</span>
                  </div>
                </div>
              )}

              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8, zIndex: 6, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                <i style={{ width: 120, height: 5, borderRadius: 99, background: isFan && K.dark ? '#fff' : '#000', display: 'block' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

