/**
 * Bas de l'écran Automatisations : « Ce qui vient de partir » (les derniers
 * envois automatiques, rafraîchis chaque minute) et « Vos Yunits » (solde,
 * consommation des recettes allumées, combien de semaines il tient, qui
 * consomme le plus) ; puis l'introduction d'un compte sans automatisation et
 * les modèles prêts à activer.
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import type { useCrmT } from '@/crm/i18n';
import type { AutoRecipe, Automations } from '@/crm/data/automations';
import { CRM_AUTO_META, quietSendAt, receivedSubject, runwayWeeks, weeklyYunits, type CrmAutoKind } from '@/crm/lib/automations';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { AU_IC, agoLabel, linkLabel } from './autoFmt';
import { Flow, SectionHead } from './autoUi';

type T = ReturnType<typeof useCrmT>;

export function AutoLive({ d, T, c, balance, rates, canBilling }: { d: Automations; T: T; c: number; balance: number; rates: { email: number; sms: number }; canBilling: boolean }) {
  const { t, n, tp } = T;
  const weekly = weeklyYunits(d.recipes, rates.email);
  const weeks = runwayWeeks(balance, weekly);
  const burners = d.recipes
    .filter((r) => r.enabled && r.week_avg > 0)
    .map((r) => ({ r, v: r.week_avg * rates.email }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  const bmx = Math.max(1, ...burners.map((b) => b.v));
  const byKind = new Map(d.recipes.map((r) => [r.kind, r] as const));
  // La phrase garde son ordre dans chaque langue ; seul le chiffre passe en gras.
  const [useA, useB = ''] = t('yc.au.y.use', { n: '\u0000' }).split('\u0000');
  const runText = weeks === null ? '' : weeks > 52 ? t('yc.au.y.runLong') : t('yc.au.y.run', { w: weeks < 10 ? T.n1(weeks) : n(weeks) });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
      <section style={{ flex: '1.5 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 24, borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-in-blur 800ms ${EASE} 620ms both` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.au.feed.title')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.au.feed.sub')}</div>
          </div>
          {d.feed.length > 0 && (
            <span style={{ flex: 'none', height: 26, padding: '0 11px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: 'yc-pulse 1.4s ease-in-out infinite' }} />{t('yc.au.feed.live')}
            </span>
          )}
        </div>
        {d.feed.length === 0 ? (
          <div style={{ padding: '18px 20px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.au.feed.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {d.feed.map((e, i) => {
              const who = e.first_name ? `${e.first_name}${e.last_initial ? ` ${e.last_initial}.` : ''}` : t('yc.au.feed.someone');
              const rec = byKind.get(e.kind);
              return (
                <div key={`${e.at}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 10px', margin: '0 -10px', borderRadius: 14, background: i === 0 ? 'var(--sand-50)' : 'transparent', animation: `yc-rise 420ms ${EASE} ${i * 50}ms both` }}>
                  <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 12, background: i === 0 ? 'var(--red-50)' : 'var(--sand-100)', color: i === 0 ? 'var(--red-600)' : 'var(--sand-600)', display: 'grid', placeItems: 'center' }}>
                    <Icon d={AU_IC.mail} size={17} stroke={2} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 15, lineHeight: '20px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      <b style={{ fontWeight: 600 }}>{who}</b> {t('yc.au.feed.got')} {t('yc.jr.quote', { s: t(`yc.au.r.${e.kind}.name`) })}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t('yc.au.m.email')} · {linkLabel(T, e.kind, rec?.delay_hours ?? null)}{e.subject ? ` · ${receivedSubject(e.subject, e.first_name)}` : ''}
                    </span>
                  </span>
                  <span style={{ flex: 'none', fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{agoLabel(T, e.at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ flex: '1 1 320px', minWidth: 0, position: 'relative', overflow: 'hidden', isolation: 'isolate', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, padding: 26, borderRadius: 28, color: 'var(--text-on-night)', background: 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.4),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', animation: `yc-in-blur 800ms ${EASE} 680ms both` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <YunitFace mood={weeks !== null && weeks < 4 ? 'inquiet' : 'content'} size={40} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.au.y.title')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 64, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{n(balance * c)}</span>
          <span style={{ fontSize: 16, color: 'var(--text-on-night-2)' }}>{t('yc.au.y.avail')}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: 'rgba(255,255,255,.12)' }}>
            <div style={{ width: `${Math.min(100, ((weeks ?? 8) / 8) * 100 * c).toFixed(1)}%`, background: 'var(--gradient-brand)', borderRadius: 99 }} />
          </div>
          <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-on-night-2)', textWrap: 'pretty' }}>
            {weekly > 0
              ? <>{useA}<b style={{ color: '#fff', fontWeight: 600 }}>{T.t('yc.au.y.yu', { n: n(weekly) })}</b>{useB} <b style={{ color: '#fff', fontWeight: 600 }}>{runText}</b></>
              : t('yc.au.y.idle')}
          </span>
        </div>
        {burners.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 14, background: 'rgba(255,255,255,.07)' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-on-night-2)' }}>{t('yc.au.y.burners')}</span>
            {burners.map((b) => (
              <div key={b.r.kind} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(`yc.au.r.${b.r.kind}.name`)}</span>
                  <b style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tp('yc.au.m.cost', Math.round(b.v), { n: n(b.v) })}</b>
                </div>
                <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${((b.v / bmx) * 100 * c).toFixed(0)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', paddingTop: 6 }}>
          {canBilling && (
            <Hv as={Link} to={CRM_ROUTES.yunits} style={{ height: 42, padding: '0 20px', borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}>
              {t('yc.au.y.recharge')}
            </Hv>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-on-night-2)' }}>{t('yc.au.y.rates', { e: rates.email, s: rates.sms })}</span>
        </div>
      </section>
    </div>
  );
}

export function AutoIntro({ T }: { T: T }) {
  const { t } = T;
  const steps = [
    { d: AU_IC.cal, bg: 'var(--ink)', fg: '#fff' },
    { d: AU_IC.clock, bg: 'var(--sand-100)', fg: 'var(--sand-700)' },
    { d: AU_IC.mail, bg: 'var(--red-50)', fg: 'var(--red-600)' },
    { d: AU_IC.bag, bg: 'var(--green-50)', fg: 'var(--green-700)' },
  ];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-in-blur 800ms ${EASE} 380ms both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 24px' }}>
        <YunitFace mood="ravi" size={64} />
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.au.intro.kick')}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{t('yc.au.intro.title')}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 12 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', animation: `yc-pop 600ms ${EASE} ${460 + i * 100}ms both` }}>
            <span style={{ width: 48, height: 48, borderRadius: 15, background: s.bg, color: s.fg, display: 'grid', placeItems: 'center' }}><Icon d={s.d} size={22} stroke={2} /></span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t(`yc.au.intro.${i + 1}.k`)}</span>
            <b style={{ fontSize: 16.5, letterSpacing: '-.01em', lineHeight: '21px' }}>{t(`yc.au.intro.${i + 1}.t`)}</b>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(`yc.au.intro.${i + 1}.d`)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const SOON_AUTOS = ['cart', 'upsell', 'visit'] as const;

/** Trois recettes pas encore branchées : elles lisent le checkout et les visites, que Shotgun ne rapporte pas. */
export function AutoSoon({ T }: { T: T }) {
  const { t } = T;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: `yc-in-blur 800ms ${EASE} 760ms both` }}>
      <SectionHead title={t('yc.au.soon.title')} sub={t('yc.au.soon.sub')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,290px),1fr))', gap: 14 }}>
        {SOON_AUTOS.map((k) => (
          <div key={k} aria-disabled="true" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20, borderRadius: 22, background: 'var(--paper)', border: '1px dashed var(--sand-300)', color: 'var(--sand-600)' }}>
            <span style={{ alignSelf: 'flex-start', height: 22, padding: '0 9px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 12, fontWeight: 600, color: 'var(--sand-500)', display: 'inline-flex', alignItems: 'center' }}>{t('yc.au.m.soon')}</span>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', lineHeight: '23px', color: 'var(--ink)' }}>{t(`yc.au.soon.${k}.name`)}</b>
            <span style={{ fontSize: 14, lineHeight: 1.45, textWrap: 'pretty' }}>{t(`yc.au.soon.${k}.desc`)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AutoRecos({
  T, recos, empty, canWrite, rate, onPick, onBlank,
}: { T: T; recos: AutoRecipe[]; empty: boolean; canWrite: boolean; rate: number; onPick: (k: CrmAutoKind) => void; onBlank: () => void }) {
  const { t, tp, n } = T;
  if (!recos.length) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: `yc-in-blur 800ms ${EASE} 700ms both` }}>
      <SectionHead title={t(empty ? 'yc.au.reco.titleEmpty' : 'yc.au.reco.title')} sub={t('yc.au.reco.sub')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,290px),1fr))', gap: 14 }}>
        {recos.map((r) => {
          const elig = r.preview?.eligible ?? 0;
          return (
            <Hv
              key={r.kind}
              as="button"
              type="button"
              onClick={() => onPick(r.kind)}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 22, background: '#fff', border: '1px solid var(--sand-200)', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
              hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
              active={{ transform: 'scale(.985)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', lineHeight: '23px' }}>{t(`yc.au.r.${r.kind}.name`)}</b>
                <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.au.r.${r.kind}.desc`)}</span>
              </div>
              <Flow T={T} kind={r.kind} delay={CRM_AUTO_META[r.kind].def} on={false} size="reco" />
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 12, borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>
                  {elig === 0 && r.preview?.next_due_at
                    ? t('yc.au.reco.next', { d: T.dWeek(quietSendAt(r.preview.next_due_at)) })
                    : tp('yc.au.reco.est', elig, { n: n(elig), y: n(elig * rate) })}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--red-600)', whiteSpace: 'nowrap' }}>
                  {t(canWrite ? 'yc.au.reco.cta' : 'yc.au.reco.see')}<Icon d={AU_IC.arrow} size={15} stroke={2.4} />
                </span>
              </div>
            </Hv>
          );
        })}
        {canWrite && (
          <Hv
            as="button"
            type="button"
            onClick={onBlank}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 150, padding: 20, borderRadius: 22, background: 'transparent', border: '1.5px dashed var(--sand-300)', cursor: 'pointer', color: 'var(--sand-600)', fontSize: 15, fontWeight: 600, transition: 'border-color 200ms,background 200ms,color 200ms' }}
            hover={{ borderColor: 'var(--red-300)', background: 'var(--red-50)', color: 'var(--red-700)' }}
          >
            <span style={{ width: 40, height: 40, borderRadius: 99, background: '#fff', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-xs)' }}><Icon d={AU_IC.plus} size={18} stroke={2.2} /></span>
            {t('yc.au.reco.blank')}
          </Hv>
        )}
      </div>
    </section>
  );
}
