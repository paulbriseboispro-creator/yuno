/**
 * Section 4 du Parcours — « Et pour un client en particulier ? » : quatre
 * personnes réelles de la sélection (un acheteur après un message, un clic
 * sans achat, une ouverture sans clic, un achat sans message), où chacune en
 * est, trois chiffres et son fil — chaque e-mail, ouverture, clic et achat,
 * avec le temps écoulé entre deux.
 */
import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { Journey, JrPerson } from '@/crm/data/journey';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { fullName, initials } from '@/crm/lib/lifecycle';
import { JR_IC, STEP_IC, gapLabel, spanLabel } from './jrLib';

type T = ReturnType<typeof useCrmT>;

const DAY = 86_400_000;
type Tone = 0 | 1 | 2 | 3 | 4;
/** Pastilles du fil : message, action, achat, arrêt, à venir. */
const TONE: Record<Tone, { bg: string; fg: string; sh: string; bd: string }> = {
  0: { bg: 'var(--sand-100)', fg: 'var(--ink)', sh: 'none', bd: 'none' },
  1: { bg: '#fff', fg: 'var(--ink)', sh: 'none', bd: '2px solid var(--sand-300)' },
  2: { bg: 'var(--green-500)', fg: '#fff', sh: '0 0 0 5px rgba(48,170,100,.16)', bd: 'none' },
  3: { bg: 'var(--red-500)', fg: '#fff', sh: '0 0 0 5px rgba(227,20,27,.14)', bd: 'none' },
  4: { bg: '#fff', fg: 'var(--sand-400)', sh: 'none', bd: '2px dashed var(--sand-300)' },
};

interface Row { d: string; tone: Tone; t: string; when: string; s: string; gap: string }

function analyse(p: JrPerson) {
  const evs = [...p.events].sort((a, b) => a.at.localeCompare(b.at));
  const ms = (x: string) => new Date(x).getTime();
  const clicks = evs.filter((e) => e.t === 'click');
  const buys = evs.filter((e) => e.t === 'buy');
  // L'achat rattaché : le premier achat qui suit un clic de moins de 7 jours.
  const attributed = buys.find((b) => clicks.some((c) => ms(c.at) <= ms(b.at) && ms(b.at) - ms(c.at) <= 7 * DAY)) ?? null;
  return { evs, clicks, buys, attributed, ms };
}

export const CustomerExample = forwardRef<HTMLElement, {
  d: Journey; T: T; tl: number; style: CSSProperties; canWrite: boolean; money: boolean;
  onPick: () => void; onRelaunch: (p: JrPerson) => void;
}>(function CustomerExample({ d, T, tl, style, canWrite, money, onPick, onRelaunch }, ref) {
  const { t, tp, n, eur, dShort, time } = T;
  const people = d.examples;
  const [pick, setPick] = useState<string | null>(null);
  const [swap, setSwap] = useState(0);
  useEffect(() => { if (pick && !people.some((p) => p.email === pick)) setPick(null); }, [people, pick]);
  const cu = people.find((p) => p.email === pick) ?? people[0];

  const view = useMemo(() => {
    if (!cu) return null;
    const now = Date.now();
    const { evs, clicks, buys, attributed, ms } = analyse(cu);
    const mails = evs.filter((e) => e.t === 'mail' || e.t === 'auto');
    const name = fullName(cu.first_name, cu.last_name, cu.email);
    const first = (cu.first_name ?? '').trim() || name;

    // Où cette personne en est.
    let done = new Set<number>();
    let stop = -1;
    if (cu.kind === 'bought') {
      done = new Set([0, 1, 2, 3]);
      const titles = new Set(buys.filter((b) => attributed && ms(b.at) > ms(attributed.at)).map((b) => b.s));
      if (attributed && titles.size > 0 && [...titles].some((x) => x !== attributed.s)) done.add(4);
    } else if (cu.kind === 'clicked') { done = new Set([0, 1, 2]); stop = 3; } else if (cu.kind === 'opened') { done = new Set([0, 1]); stop = 2; } else { done = new Set([3]); }

    // Trois chiffres.
    let stats: [string, string][] = [];
    if (cu.kind === 'bought' && attributed) {
      const bAt = ms(attributed.at);
      const firstClick = clicks.find((c) => ms(c.at) <= bAt && bAt - ms(c.at) <= 30 * DAY);
      const lastClick = [...clicks].reverse().find((c) => ms(c.at) <= bAt);
      const before = mails.filter((m) => ms(m.at) <= bAt && bAt - ms(m.at) <= 30 * DAY).length;
      stats = [
        [firstClick ? spanLabel(T, bAt - ms(firstClick.at)) : '—', t('yc.jr.s4.st.delay')],
        [n(before), t('yc.jr.s4.st.mails')],
        [lastClick?.s ?? '—', t('yc.jr.s4.st.lastClick')],
      ];
    } else if (cu.kind === 'clicked') {
      const last = clicks[clicks.length - 1];
      stats = [
        [last ? spanLabel(T, now - ms(last.at)) : '—', t('yc.jr.s4.st.since')],
        [n(mails.length), t('yc.jr.s4.st.received')],
        [last?.s ?? '—', t('yc.jr.s4.st.clickedMsg')],
      ];
    } else if (cu.kind === 'opened') {
      const last = [...evs].reverse().find((e) => e.t === 'open');
      stats = [
        [last ? spanLabel(T, now - ms(last.at)) : '—', t('yc.jr.s4.st.sinceOpen')],
        [n(mails.length), t('yc.jr.s4.st.received')],
        [last?.s ?? '—', t('yc.jr.s4.st.openedMsg')],
      ];
    } else {
      const last = buys[buys.length - 1];
      stats = [[last?.s || '—', t('yc.jr.s4.st.night')], [n(cu.nights), t('yc.jr.s4.st.allNights')], ['0', t('yc.jr.s4.st.noMail')]];
    }

    // Le fil.
    const rows: Row[] = evs.map((e, i) => {
      const gap = i ? gapLabel(T, ms(e.at) - ms(evs[i - 1].at)) : '';
      const when = `${dShort(e.at)} · ${time(e.at)}`;
      const quote = e.s ? t('yc.jr.quote', { s: e.s }) : '';
      if (e.t === 'buy') {
        const parts = [e.s, e.qty ? tp('yc.jr.ev.places', e.qty, { n: n(e.qty) }) : '', money && e.amount !== null ? eur(Number(e.amount)) : ''].filter(Boolean);
        return { d: JR_IC.card, tone: 2, t: t('yc.jr.ev.buy'), when, s: parts.join(' · '), gap };
      }
      if (e.t === 'open') return { d: JR_IC.eye, tone: 1, t: t('yc.jr.ev.open'), when, s: quote, gap };
      if (e.t === 'click') return { d: JR_IC.click, tone: 1, t: t('yc.jr.ev.click'), when, s: quote, gap };
      return { d: e.t === 'auto' ? JR_IC.zap : JR_IC.mail, tone: 0, t: t(e.t === 'auto' ? 'yc.jr.ev.auto' : 'yc.jr.ev.mail'), when, s: quote, gap };
    });
    const lastAt = evs.length ? ms(evs[evs.length - 1].at) : now;
    if (cu.kind === 'clicked' || cu.kind === 'opened') {
      const ref = cu.kind === 'clicked' ? clicks[clicks.length - 1] : [...evs].reverse().find((e) => e.t === 'open');
      rows.push({
        d: JR_IC.x, tone: 3, t: t(cu.kind === 'clicked' ? 'yc.jr.ev.stopBuy' : 'yc.jr.ev.stopClick'),
        when: ref ? t('yc.jr.ev.ago', { d: spanLabel(T, now - ms(ref.at)) }) : '',
        s: t(cu.email_ok ? 'yc.jr.ev.reach' : 'yc.jr.ev.noReach'), gap: '',
      });
    } else if (d.thanks_auto) {
      const night = [...buys].reverse().find((b) => b.ev_at);
      const next = night?.ev_at ? ms(night.ev_at) + DAY : 0;
      if (next > now) rows.push({ d: JR_IC.clock, tone: 4, t: t('yc.jr.ev.future'), when: dShort(new Date(next)), s: t('yc.jr.ev.futureS'), gap: gapLabel(T, next - lastAt) });
    }
    return { name, first, done, stop, stats, rows };
  }, [cu, d.thanks_auto, T, t, tp, n, eur, dShort, time, money]);

  if (!cu || !view) return null;
  const rowAnim = swap % 2 ? 'yc-row-a' : 'yc-row-b';
  const cardAnim = `${swap % 2 ? 'yc-swap-a' : 'yc-swap-b'} 420ms ${EASE}`;
  const canAct = canWrite && cu.email_ok && (cu.kind === 'clicked' || cu.kind === 'opened');

  return (
    <section ref={ref} style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 0% 0%,rgba(227,20,27,.05),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', minWidth: 0, ...style }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.jr.s4.title')}</h2>
        <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, lineHeight: 1.45 }}>{t('yc.jr.s4.sub')}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px 32px' }}>
        <div style={{ flex: '1 1 300px', maxWidth: 420, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {people.map((p) => {
              const on = p.email === cu.email;
              const ok = p.kind === 'bought' || p.kind === 'direct';
              const nm = fullName(p.first_name, p.last_name, p.email);
              const tag = p.lifecycle === 'none' ? t('yc.cli.seg.none') : `${tp('yc.jr.s4.nights', p.nights, { n: n(p.nights) })} · ${t(`yc.cli.seg.${p.lifecycle}`)}`;
              return (
                <Hv
                  key={p.email}
                  as="button"
                  type="button"
                  aria-pressed={on}
                  onClick={() => { if (!on) { setPick(p.email); setSwap((x) => x + 1); onPick(); } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 16, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--sand-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: 'border-color 160ms,background 160ms' }}
                  hover={{ borderColor: on ? 'var(--ink)' : 'var(--sand-400)' }}
                >
                  <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--sand-100)', fontSize: 13, fontWeight: 600, color: 'var(--sand-700)' }}>{initials(p.first_name, p.last_name, p.email)}</span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                  </span>
                  <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: ok ? 'var(--green-50)' : 'var(--amber-50)', color: ok ? 'var(--green-700)' : 'var(--amber-700)' }}>{t(`yc.jr.s4.state.${p.kind}`)}</span>
                </Hv>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 18, background: 'var(--sand-50)', animation: cardAnim }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sand-600)' }}>{t('yc.jr.s4.prog')}</span>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              {[0, 1, 2, 3, 4].map((i) => {
                const isStop = i === view.stop;
                const isDone = view.done.has(i);
                const rail = i === 0 ? 'transparent' : isDone && view.done.has(i - 1) ? 'var(--ink)' : 'var(--sand-300)';
                return (
                  <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 13, right: '50%', width: '100%', height: 2, background: rail, zIndex: 0 }} />
                    <span style={{ position: 'relative', zIndex: 1, width: 28, height: 28, borderRadius: 99, display: 'grid', placeItems: 'center', background: isStop ? 'var(--red-500)' : isDone ? 'var(--ink)' : '#fff', color: isStop || isDone ? '#fff' : 'var(--sand-400)', boxShadow: isStop ? '0 0 0 4px rgba(227,20,27,.16)' : isDone ? 'none' : 'inset 0 0 0 2px var(--sand-300)', animation: isStop ? 'yc-pulse-red 1.8s ease-out infinite' : 'none' }}>
                      <Icon d={isStop ? JR_IC.x : STEP_IC[i]} size={13} stroke={2.2} />
                    </span>
                    <span style={{ fontSize: 11.5, lineHeight: '13px', textAlign: 'center', color: isStop ? 'var(--red-600)' : isDone ? 'var(--ink)' : 'var(--sand-400)', fontWeight: isStop ? 600 : 500 }}>{t(`yc.jr.step.${i}`)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12, animation: cardAnim }}>
            {view.stats.map(([v, l], i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: v.length > 10 ? 16 : 24, lineHeight: 1.1, letterSpacing: '-.03em', overflowWrap: 'anywhere' }}>{v}</b>
                <span style={{ fontSize: 12, lineHeight: '15px', color: 'var(--sand-500)' }}>{l}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {canAct && (
              <Hv
                as="button"
                type="button"
                onClick={() => onRelaunch(cu)}
                style={{ height: 42, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', transition: `transform 200ms ${SPRING},background 160ms` }}
                hover={{ background: 'var(--sand-700)' }}
                active={{ transform: 'scale(.97)' }}
              >
                {t('yc.jr.s4.relaunch', { name: view.first })}
              </Hv>
            )}
            <Hv
              as={Link}
              to={`${CRM_ROUTES.clients}?c=${encodeURIComponent(cu.email)}`}
              style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
              hover={{ color: 'var(--red-600)', textDecoration: 'none' }}
            >
              {t('yc.jr.s4.open')}<Icon d={JR_IC.arrow} size={15} stroke={2.4} />
            </Hv>
          </div>
        </div>

        <div style={{ flex: '1.4 1 380px', minWidth: 0, position: 'relative', padding: '4px 0', alignSelf: 'flex-start' }}>
          <span style={{ position: 'absolute', left: 19, top: 20, bottom: 20, width: 2, background: 'var(--sand-200)', borderRadius: 2 }} />
          <span style={{ position: 'absolute', left: 19, top: 20, bottom: 20, width: 2, background: 'var(--gradient-brand)', borderRadius: 2, transformOrigin: 'top', transform: `scaleY(${tl})` }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {view.rows.map((r, i) => {
              const s = TONE[r.tone];
              return (
                <div key={`${swap}-${i}`} style={{ position: 'relative', display: 'flex', gap: 16, paddingBottom: 18, animation: `${rowAnim} 480ms ${EASE} ${i * 110 + 80}ms backwards` }}>
                  <span style={{ position: 'relative', zIndex: 1, flex: 'none', width: 40, height: 40, borderRadius: 99, display: 'grid', placeItems: 'center', background: s.bg, color: s.fg, boxShadow: s.sh, border: s.bd, boxSizing: 'border-box' }}>
                    <Icon d={r.d} size={16} stroke={2} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                    {r.gap && <span style={{ alignSelf: 'flex-start', height: 20, padding: '0 8px', marginBottom: 4, borderRadius: 99, display: 'inline-flex', alignItems: 'center', font: "600 11px/1 'Geist Mono', ui-monospace, monospace", color: 'var(--sand-600)', background: 'var(--sand-100)' }}>{r.gap}</span>}
                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px' }}>
                      <b style={{ fontSize: 15, color: r.tone === 3 ? 'var(--red-600)' : r.tone === 4 ? 'var(--sand-500)' : 'var(--ink)' }}>{r.t}</b>
                      {r.when && <span style={{ fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{r.when}</span>}
                    </span>
                    {r.s && <span style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--sand-600)', overflowWrap: 'anywhere' }}>{r.s}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
});
