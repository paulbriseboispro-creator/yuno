/**
 * « À regarder aujourd'hui » : au plus trois choses à faire, dans cet ordre —
 * des Yunits qui ne tiendront pas un mois au rythme actuel, une recette en
 * pause alors que des gens correspondent, une recette réglée jamais allumée,
 * une recette que le moteur propose d'allumer (faits des 30 derniers jours).
 */
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { Automations } from '@/crm/data/automations';
import { autoState, runwayWeeks, weeklyYunits, type CrmAutoKind } from '@/crm/lib/automations';
import { AU_IC } from './autoFmt';

type T = ReturnType<typeof useCrmT>;

interface Item { key: string; badge: string; bg: string; fg: string; bd: string; title: string; why: string; cta?: string; primary?: boolean; go?: () => void }

export function AutoTodo({
  d, T, money, balance, rate, canWrite, canBilling, onRecharge, onResume, onPropose,
}: {
  d: Automations; T: T; money: boolean; balance: number; rate: number; canWrite: boolean; canBilling: boolean;
  onRecharge: () => void; onResume: (k: CrmAutoKind) => void; onPropose: (k: CrmAutoKind) => void;
}) {
  const { t, tp, n, eur } = T;
  const items: Item[] = [];
  const name = (k: CrmAutoKind) => t(`yc.au.r.${k}.name`);

  const weekly = weeklyYunits(d.recipes, rate);
  const weeks = runwayWeeks(balance, weekly);
  if (weeks !== null && weeks < 4) {
    const w = Math.max(1, Math.round(weeks));
    items.push({
      key: 'yunits', badge: t('yc.au.todo.yunits.badge'), bg: 'var(--amber-50)', fg: 'var(--amber-700)', bd: 'var(--sand-200)',
      title: tp('yc.au.todo.yunits.title', w, { n: w }), why: t('yc.au.todo.yunits.why', { n: n(weekly) }),
      ...(canBilling ? { cta: t('yc.au.todo.yunits.cta'), primary: true, go: onRecharge } : {}),
    });
  }

  const paused = d.recipes.find((r) => autoState(r) === 'off' && (r.preview?.eligible ?? 0) > 0);
  if (paused) {
    const days = paused.updated_at ? Math.max(1, Math.round((Date.now() - new Date(paused.updated_at).getTime()) / 86_400_000)) : 1;
    const brought = money && paused.all.revenue !== null && Number(paused.all.revenue) > 0
      ? t('yc.au.todo.paused.brought', { v: eur(Number(paused.all.revenue)) })
      : paused.all.purchases > 0 ? t('yc.au.todo.paused.brought', { v: tp('yc.au.purchases', paused.all.purchases, { n: n(paused.all.purchases) }) }) : '';
    items.push({
      key: 'paused', badge: t('yc.au.todo.paused.badge'), bg: 'var(--red-50)', fg: 'var(--red-700)', bd: 'var(--red-200)',
      title: t('yc.au.todo.paused.title', { name: name(paused.kind), d: tp('yc.au.d.d', days, { n: days }) }),
      why: tp('yc.au.todo.paused.why', paused.preview.eligible, { n: n(paused.preview.eligible) }) + brought,
      ...(canWrite ? { cta: t('yc.au.todo.paused.cta'), primary: true, go: () => onResume(paused.kind) } : {}),
    });
  }

  const ready = d.recipes.find((r) => autoState(r) === 'ready');
  if (ready) {
    items.push({
      key: 'ready', badge: t('yc.au.todo.ready.badge'), bg: 'var(--sand-100)', fg: 'var(--sand-600)', bd: 'var(--sand-200)',
      title: t('yc.au.todo.sug.title', { name: name(ready.kind) }),
      why: tp('yc.au.todo.ready.why', ready.preview?.eligible ?? 0, { n: n(ready.preview?.eligible ?? 0) }),
      ...(canWrite ? { cta: t('yc.au.todo.sug.cta'), go: () => onPropose(ready.kind) } : {}),
    });
  }

  for (const s of d.suggestions) {
    if (items.length >= 3) break;
    if (items.some((x) => x.key === `sug-${s.kind}`) || ready?.kind === s.kind) continue;
    const v = s.reason_vars ?? {};
    const num = Number(v.n ?? s.reach ?? 0);
    const why = s.kind === 'last_call' || s.kind === 'win_back' || s.kind === 'regular_lapse'
      ? t(`yc.au.sug.${s.kind}`, { ...v, n: n(num) })
      : tp(`yc.au.sug.${s.kind}`, num, { n: n(num) });
    items.push({
      key: `sug-${s.kind}`, badge: t('yc.au.todo.sug.badge'), bg: 'var(--sand-100)', fg: 'var(--sand-600)', bd: 'var(--sand-200)',
      title: t('yc.au.todo.sug.title', { name: name(s.kind) }), why,
      ...(canWrite ? { cta: t('yc.au.todo.sug.cta'), go: () => onPropose(s.kind) } : {}),
    });
  }

  const list = items.slice(0, 3);
  if (!list.length) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: `yc-in-blur 800ms ${EASE} 380ms both` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.au.todo.title')}</h2>
        <span style={{ minWidth: 26, height: 26, padding: '0 8px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{list.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 12 }}>
        {list.map((it, i) => (
          <Hv
            key={it.key}
            style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', borderRadius: 20, background: '#fff', border: `1px solid ${it.bd}`, minWidth: 0, animation: `yc-pop 600ms ${EASE} ${440 + i * 80}ms both`, transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
            hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
          >
            <span style={{ alignSelf: 'flex-start', height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: it.bg, color: it.fg }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{it.badge}
            </span>
            <span style={{ fontSize: 16.5, lineHeight: '21px', fontWeight: 600, letterSpacing: '-.01em', textWrap: 'balance' }}>{it.title}</span>
            <span style={{ fontSize: 14, lineHeight: '19px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{it.why}</span>
            {it.cta && it.go && (
              <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                {it.primary ? (
                  <Hv as="button" type="button" onClick={it.go} style={{ height: 40, padding: '0 5px 0 16px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ filter: 'brightness(1.05)' }} active={{ transform: 'scale(.97)' }}>
                    {it.cta}<span style={{ width: 30, height: 30, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon d={AU_IC.arrow} size={14} stroke={2.4} /></span>
                  </Hv>
                ) : (
                  <Hv as="button" type="button" onClick={it.go} style={{ height: 40, padding: 0, border: 0, background: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ color: 'var(--red-600)' }}>
                    {it.cta}<Icon d={AU_IC.arrow} size={15} stroke={2.4} />
                  </Hv>
                )}
              </div>
            )}
          </Hv>
        ))}
      </div>
    </section>
  );
}
