/**
 * Mise en page commune des fonctions « Bientôt » (design « Instagram
 * Bientot ») : en-tête avec pastille, bloc nuit (promesse, trois étapes,
 * « Me prévenir à l'ouverture », téléphone d'exemple), ce que vous réglerez,
 * ce que vous mesurerez, où en sommes-nous.
 */
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useFeatureWaitlist } from '@/crm/data/soon';
import type { SoonFeature } from '@/crm/data/soon';

export interface ComingSoonProps {
  feature: SoonFeature;
  eyebrow: string;
  title: [string, string, string];
  sub: string;
  hero: string;
  heroSub: string;
  steps: { b: string; t: string }[];
  phone: ReactNode;
  tabs: { k: string; l: string }[];
  tab: string;
  onTab: (k: string) => void;
  setup: { t: string; s: string; d: string }[];
  setupSub: string;
  measureSub: string;
  measures: { l: string; d: string; h: string }[];
  insight: string;
  track: [string, string];
}

const fade = (delay: number) => ({ animation: `yc-rise 800ms ${EASE} ${delay}ms both` });

export function ComingSoon(p: ComingSoonProps) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const wl = useFeatureWaitlist();
  const notified = wl.features.includes(p.feature);
  const setNotify = async (on: boolean) => {
    try {
      await wl.set({ feature: p.feature, on });
      if (on) toast(t('yc.soon.notifiedToast'));
    } catch {
      toast(t('yc.soon.failed'));
    }
  };
  const track = [
    { l: t('yc.soon.t1'), s: p.track[0], st: 'done' },
    { l: t('yc.soon.t2'), s: p.track[1], st: 'now' },
    { l: t('yc.soon.t3'), s: t('yc.soon.t3s'), st: 'next' },
    { l: t('yc.soon.t4'), s: t('yc.soon.t4s'), st: 'next' },
  ];

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', ...fade(100) }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{p.eyebrow}</span>
          <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: 'var(--red-50)', color: 'var(--red-700)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: 'yc-pulse 1.6s ease-in-out infinite' }} />{t('yc.soon.badge')}
          </span>
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...fade(170) }}>
          {p.title[0]}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{p.title[1]}</span>{p.title[2]}
        </h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 680, ...fade(240) }}>{p.sub}</p>
      </div>

      <section style={{ position: 'relative', overflow: 'hidden', isolation: 'isolate', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '32px 48px', padding: 'clamp(24px,3.4vw,52px)', borderRadius: 32, color: 'var(--text-on-night)', background: 'radial-gradient(70% 80% at 85% 100%,rgba(227,20,27,.42),transparent 65%),radial-gradient(50% 50% at 0% 0%,rgba(255,107,53,.16),transparent 70%),var(--noise-night),var(--night)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', animation: `yc-rise 900ms ${EASE} 320ms both` }}>
        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.soon.dev')}</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.6vw,46px)', lineHeight: 1.02, letterSpacing: '-.04em', textWrap: 'balance', color: '#fff' }}>{p.hero}</h2>
            <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.5, color: 'var(--text-on-night-2)', textWrap: 'pretty', maxWidth: 520 }}>{p.heroSub}</p>
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {p.steps.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--border-night)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>{i + 1}</span>
                <span style={{ fontSize: 15.5, lineHeight: 1.45, color: 'var(--text-on-night-2)', textWrap: 'pretty', paddingTop: 3 }}><b style={{ fontWeight: 600, color: '#fff' }}>{s.b}</b> {s.t}</span>
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 18px' }}>
            {!notified ? (
              <Hv
                as="button"
                type="button"
                onClick={() => void setNotify(true)}
                disabled={wl.pending || !wl.loaded}
                style={{ height: 50, padding: '0 6px 0 24px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms`, opacity: wl.loaded ? 1 : 0.6 }}
                hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
                active={{ transform: 'scale(.97)' }}
              >
                {t('yc.soon.notify')}
                <span style={{ width: 38, height: 38, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="bell" size={17} stroke={2.2} /></span>
              </Hv>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', animation: `yc-pop 300ms ${EASE} both` }}>
                <span style={{ height: 50, padding: '0 22px 0 16px', borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--border-night)', display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 15.5, fontWeight: 600, color: '#fff' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 99, background: 'var(--green-500)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={13} stroke={3} /></span>{t('yc.soon.notified')}
                </span>
                <Hv as="button" type="button" onClick={() => void setNotify(false)} style={{ height: 40, padding: '0 6px', border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--text-on-night-2)', cursor: 'pointer' }} hover={{ color: '#fff' }}>{t('yc.soon.cancel')}</Hv>
              </div>
            )}
            <span style={{ fontSize: 13.5, color: 'var(--text-on-night-2)' }}>{t('yc.soon.notifyHow')}</span>
          </div>
        </div>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'rgba(255,255,255,.1)', borderRadius: 99 }}>
            {p.tabs.map((x) => {
              const on = p.tab === x.k;
              return (
                <button key={x.k} type="button" onClick={() => p.onTab(x.k)} aria-pressed={on} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--text-on-night-2)', cursor: 'pointer', transition: 'background 160ms,color 160ms' }}>{x.l}</button>
              );
            })}
          </div>
          <div style={{ filter: 'drop-shadow(0 30px 50px rgba(227,20,27,.35))' }}>{p.phone}</div>
          <span style={{ fontSize: 12.5, color: 'var(--text-on-night-2)' }}>{t('yc.soon.example')}</span>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fade(460) }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.soon.setup')}</h2>
          <div style={{ fontSize: 14, color: 'var(--sand-500)', marginTop: 2 }}>{p.setupSub}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 14 }}>
          {p.setup.map((s) => (
            <div key={s.t} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 22, background: '#fff', border: '1px solid var(--sand-200)' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={s.d} size={19} stroke={2} /></span>
              <b style={{ fontSize: 16.5, letterSpacing: '-.01em', lineHeight: '21px' }}>{s.t}</b>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{s.s}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...fade(540) }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.soon.measure')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 620, textWrap: 'pretty' }}>{p.measureSub}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 12 }}>
          {p.measures.map((m) => (
            <div key={m.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px', borderRadius: 18, background: 'var(--sand-50)' }}>
              <div style={{ height: 40, display: 'flex', alignItems: 'flex-end' }}><div style={{ width: '100%', height: m.h, borderRadius: '8px 8px 3px 3px', background: 'repeating-linear-gradient(135deg,var(--sand-100) 0 6px,var(--sand-200) 6px 12px)' }} /></div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, lineHeight: 1.05, letterSpacing: '-.04em', color: 'var(--sand-400)', marginTop: 4 }}>—</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{m.l}</span>
              <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)' }}>{m.d}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
          <span style={{ flex: 'none', width: 8, height: 8, marginTop: 8, borderRadius: 99, background: 'var(--red-500)' }} />
          <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{p.insight}</span>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, ...fade(620) }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.soon.track')}</h2>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 12 }}>
          {track.map((x, i) => (
            <li key={x.l} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 18, background: x.st === 'now' ? 'var(--red-50)' : '#fff', border: `1px solid ${x.st === 'now' ? 'var(--red-200)' : 'var(--sand-200)'}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 'none', width: 26, height: 26, borderRadius: 99, background: x.st === 'done' ? 'var(--green-500)' : x.st === 'now' ? 'var(--red-500)' : 'var(--sand-100)', color: x.st === 'next' ? 'var(--sand-500)' : '#fff', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>
                  {x.st === 'done' ? <Icon name="check" size={13} stroke={3} /> : i + 1}
                </span>
                <b style={{ fontSize: 15 }}>{x.l}</b>
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{x.s}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
