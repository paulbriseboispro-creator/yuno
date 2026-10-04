/**
 * « Que faut-il faire aujourd'hui ? » : les actions calculées par crm_home,
 * en cartes (la première en CTA plein). « Plus tard » reporte une action
 * jusqu'au lendemain, sur cet appareil.
 */
import { useEffect, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { ArrowLink, CountBubble, CtaButton, IconButton } from '@/crm/ui/kit';
import { Icon } from '@/crm/ui/Icon';
import { reveal } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import type { HomeTodo } from '@/crm/data/home';
import { CRM_ROUTES } from '@/crm/shell/nav';

const TONE = {
  todo: { bg: 'var(--red-50)', fg: 'var(--red-700)', cardBd: 'var(--red-200)' },
  warn: { bg: 'var(--amber-50)', fg: 'var(--amber-700)', cardBd: 'var(--sand-200)' },
  wait: { bg: 'var(--sand-100)', fg: 'var(--sand-600)', cardBd: 'var(--sand-200)' },
} as const;

function laterKey(scopeKey: string) {
  const d = new Date();
  return `yuno.crm.later.${scopeKey}.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function useLater(scopeKey: string): [string[], (id: string) => void, () => void] {
  const key = laterKey(scopeKey);
  const [later, setLater] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]') as string[]; } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(later)); } catch { /* préférence perdue : sans gravité */ }
  }, [key, later]);
  return [later, (id) => setLater((l) => (l.includes(id) ? l : [...l, id])), () => setLater([])];
}

export function TodoList({
  items, later, onLater, onReset, intro, starting, nextDeadline, minNights,
}: {
  items: HomeTodo[];
  later: string[];
  onLater: (id: string) => void;
  onReset: () => void;
  intro: boolean;
  starting: boolean;
  nextDeadline: { name: string; at: string } | null;
  minNights: number;
}) {
  const { t, n, time, dShort } = useCrmT();
  const left = items.filter((x) => !later.includes(x.id));

  const copy = (it: HomeTodo): { badge: string; title: string; why: string; cta: string; to: string | null } => {
    const p = it.params;
    switch (it.kind) {
      case 'relaunch': {
        const d = Number(p.days_to ?? 0);
        const when = d <= 0 ? t('yc.home.todo.when.tonight') : d === 1 ? t('yc.home.todo.when.tomorrow') : t('yc.home.todo.when.inDays', { n: d });
        return {
          badge: d <= 0 ? t('yc.home.todo.badge.today') : d === 1 ? t('yc.home.todo.badge.tomorrow') : t('yc.home.todo.badge.inDays', { n: d }),
          title: t('yc.home.todo.relaunch.title', { n: n(Number(p.n)) }),
          why: t('yc.home.todo.relaunch.why', { m: minNights, title: String(p.title ?? ''), when }),
          cta: t('yc.home.todo.relaunch.cta'),
          to: `${CRM_ROUTES.emailTemplates}?start=lastcall&event=${p.event_id}`,
        };
      }
      case 'validate':
        return {
          badge: t('yc.home.todo.badge.before', { time: time(String(p.at)) }),
          title: t('yc.home.todo.validate.title', { name: String(p.name ?? '') }),
          why: t('yc.home.todo.validate.why', { time: time(String(p.at)), n: n(Number(p.recipients ?? 0)) }),
          cta: t('yc.home.todo.validate.cta'),
          to: CRM_ROUTES.emailSend(String(p.campaign_id)),
        };
      case 'draft':
        return {
          badge: t('yc.home.todo.badge.toFinish'),
          title: t('yc.home.todo.draft.title', { name: String(p.name ?? '') }),
          why: t('yc.home.todo.draft.why', { date: dShort(String(p.updated_at)) }),
          cta: t('yc.home.todo.draft.cta'),
          to: CRM_ROUTES.emailStudio(String(p.campaign_id)),
        };
      case 'yunits':
        return {
          badge: t('yc.home.todo.badge.week'),
          title: t('yc.home.todo.yunits.title'),
          why: t('yc.home.todo.yunits.why', { n: n(Number(p.after ?? 0)) }),
          cta: t('yc.home.todo.yunits.cta'),
          to: CRM_ROUTES.yunits,
        };
      case 'contacts':
        return {
          badge: t('yc.home.todo.badge.week'),
          title: t('yc.home.todo.contacts.title', { n: n(Number(p.n ?? 0)) }),
          why: t('yc.home.todo.contacts.why'),
          cta: t('yc.home.todo.contacts.cta'),
          to: `${CRM_ROUTES.clients}?status=unreachable`,
        };
      case 'connect':
        return { badge: t('yc.home.todo.badge.minutes'), title: t('yc.home.todo.connect.title'), why: t('yc.home.todo.connect.why'), cta: t('yc.home.todo.connect.cta'), to: CRM_ROUTES.connectors };
      case 'check':
        return { badge: t('yc.home.todo.badge.afterSync'), title: t('yc.home.todo.check.title'), why: t('yc.home.todo.check.why'), cta: '', to: null };
      case 'first_send':
      default:
        return { badge: t('yc.home.todo.badge.then'), title: t('yc.home.todo.first_send.title'), why: t('yc.home.todo.first_send.why', { n: n(Number(p.yunits ?? 0)) }), cta: '', to: null };
    }
  };

  return (
    <section id="a-faire" style={{ display: 'flex', flexDirection: 'column', gap: 14, scrollMarginTop: 84, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...reveal(intro, 780) }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>
          {t(starting ? 'yc.home.todo.titleStart' : 'yc.home.todo.title')}
        </h2>
        {left.length > 0 && <CountBubble n={left.length} size={26} />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 12 }}>
        {left.map((it, i) => {
          const c = copy(it);
          const tone = TONE[it.tone];
          return (
            <Hv
              key={it.id}
              style={{
                position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 16, background: '#fff',
                border: `1px solid ${tone.cardBd}`, minWidth: 0, ...reveal(intro, 860 + i * 90),
              }}
              hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: tone.bg, color: tone.fg }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{c.badge}
                </span>
                {!starting && <IconButton name="x" label={t('yc.home.todo.postpone')} onClick={() => onLater(it.id)} style={{ margin: '-6px -8px -6px 0' }} />}
              </div>
              <span style={{ fontSize: 16, lineHeight: '21px', fontWeight: 600, letterSpacing: '-.01em', textWrap: 'balance' }}>{c.title}</span>
              <span style={{ fontSize: 13.5, lineHeight: '19px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{c.why}</span>
              <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                {c.to && i === 0 && <CtaButton to={c.to} size="sm">{c.cta}</CtaButton>}
                {c.to && i > 0 && <ArrowLink to={c.to} size={14} style={{ height: 40 }}>{c.cta}</ArrowLink>}
                {!c.to && <span style={{ height: 40, display: 'inline-flex', alignItems: 'center', fontSize: 13, color: 'var(--sand-400)' }}>{t('yc.home.todo.auto')}</span>}
              </div>
            </Hv>
          );
        })}
        {!left.length && (
          <div style={{ gridColumn: '1/-1', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 16px', padding: '18px 22px', borderRadius: 16, background: 'var(--green-50)', border: '1px solid #BFE6CE' }}>
            <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}>
              <Icon name="check" size={20} stroke={3} />
            </span>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--green-700)' }}>{t('yc.home.todo.allDone')}</span>
              <span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>
                {nextDeadline ? t('yc.home.todo.allDoneNext', { name: nextDeadline.name, time: time(nextDeadline.at) }) : t('yc.home.todo.allDoneSub')}
              </span>
            </div>
            {later.length > 0 && (
              <Hv as="button" type="button" onClick={onReset} style={{ height: 40, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', color: 'var(--sand-700)' }} hover={{ background: 'var(--paper)' }}>
                {t('yc.home.todo.reset')}
              </Hv>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
