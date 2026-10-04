/**
 * Recherche de la barre du haut (⌘K) : clients, campagnes, soirées et pages
 * de la Console, au clavier (↑↓, ↵, esc). Sans texte : la prochaine soirée,
 * la dernière campagne et les actions rapides.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/crm/ui/Icon';
import type { IconName } from '@/crm/ui/Icon';
import { useCrmT } from '@/crm/i18n';
import { useCrmSearch } from '@/crm/data/shell';
import { CRM_ROUTES } from './nav';

type Group = 'clients' | 'campaigns' | 'nights' | 'pages' | 'actions' | 'recent';
interface Item { g: Group; t: string; m: string; to: string; ini?: string; icon?: IconName; tone: Group }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const TL: Record<string, [string, string, string]> = {
  clients: ['var(--sand-100)', 'var(--sand-700)', '99px'],
  campaigns: ['var(--red-50)', 'var(--red-600)', '10px'],
  nights: ['var(--ink)', '#fff', '10px'],
  pages: ['var(--sand-50)', 'var(--sand-600)', '10px'],
  actions: ['var(--red-50)', 'var(--red-600)', '10px'],
};

export function SearchBox({ hasConnection, balance }: { hasConnection: boolean; balance: number | null }) {
  const { t, n, dShort, dWeek, time } = useCrmT();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const kb = useRef(false);
  const search = useCrmSearch(q, open);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, []);

  const pages: Item[] = useMemo(() => {
    const pg = (title: string, meta: string, to: string): Item => ({ g: 'pages', t: title, m: meta, to, icon: 'arrowRight', tone: 'pages' });
    const an = t('yc.nav.analyses'); const cl = t('yc.nav.clients'); const camp = t('yc.nav.campaigns');
    const acc = t('yc.top.pr.profile');
    return [
      pg(t('yc.nav.sales'), an, CRM_ROUTES.sales), pg(t('yc.nav.traffic'), an, CRM_ROUTES.traffic),
      pg(t('yc.nav.community'), an, CRM_ROUTES.community), pg(t('yc.nav.journey'), an, CRM_ROUTES.journey),
      pg(t('yc.nav.allClients'), cl, CRM_ROUTES.clients), pg(t('yc.nav.segments'), cl, CRM_ROUTES.segments),
      pg(t('yc.nav.imports'), cl, CRM_ROUTES.imports), pg(t('yc.nav.signupPages'), cl, CRM_ROUTES.signupPages),
      pg(t('yc.nav.emails'), camp, CRM_ROUTES.emails), pg(t('yc.nav.sms'), camp, CRM_ROUTES.sms),
      pg(t('yc.nav.automations'), camp, CRM_ROUTES.automations),
      pg(t('yc.nav.connectors'), t('yc.nav.settings'), CRM_ROUTES.connectors),
      pg(t('yc.top.a.recharge'), t('yc.nav.yunits'), CRM_ROUTES.yunits),
      pg(t('yc.nav.settings'), t('yc.nav.settings'), CRM_ROUTES.settings),
      pg(acc, t('yc.top.pr.profile'), CRM_ROUTES.accountSection('profile')),
      pg(t('yc.top.pr.team'), acc, CRM_ROUTES.accountSection('team')),
      pg(t('yc.top.pr.billing'), acc, CRM_ROUTES.accountSection('billing')),
      pg(t('yc.top.pr.notifications'), acc, CRM_ROUTES.notifications),
      pg(t('yc.top.pr.help'), acc, CRM_ROUTES.accountSection('help')),
    ];
  }, [t]);

  const term = q.trim();
  const groups: [string, Item[]][] = useMemo(() => {
    const d = search.data;
    const clients: Item[] = (d?.clients ?? []).map((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
      return {
        g: 'clients', tone: 'clients', t: name,
        m: [c.email, c.nights ? `${n(c.nights)} ${t('yc.nav.nights').toLowerCase()}` : ''].filter(Boolean).join(' · '),
        to: `${CRM_ROUTES.clients}?c=${encodeURIComponent(c.email)}`,
        ini: name.split(/[\s.@]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      };
    });
    const campaigns: Item[] = (d?.campaigns ?? []).map((c) => ({
      g: 'campaigns', tone: 'campaigns', icon: 'send' as IconName, t: c.name || '—',
      m: [c.channel === 'sms' ? 'SMS' : t('yc.nav.emails'), c.at ? dShort(c.at) : ''].filter(Boolean).join(' · '),
      to: c.status === 'sent' ? CRM_ROUTES.emailResults(c.id) : CRM_ROUTES.emailStudio(c.id),
    }));
    const nights: Item[] = (d?.nights ?? []).map((e) => ({
      g: 'nights', tone: 'nights', icon: 'calendar' as IconName, t: e.title || '—',
      m: `${dWeek(e.start_at)} · ${time(e.start_at)}`, to: CRM_ROUTES.night(e.id),
    }));
    if (term) {
      const nq = norm(term);
      return ([
        [t('yc.top.g.clients'), clients],
        [t('yc.top.g.campaigns'), campaigns],
        [t('yc.top.g.nights'), nights],
        [t('yc.top.g.pages'), pages.filter((p) => norm(p.t).includes(nq)).slice(0, 4)],
      ] as [string, Item[]][]).filter((x) => x[1].length);
    }
    const actions: Item[] = hasConnection
      ? [
        { g: 'actions', tone: 'actions', icon: 'plus', t: t('yc.top.a.newCampaign'), m: t('yc.top.a.newCampaignSub'), to: CRM_ROUTES.emailTemplates },
        { g: 'actions', tone: 'actions', icon: 'upload', t: t('yc.top.a.import'), m: t('yc.top.a.importSub'), to: CRM_ROUTES.imports },
        { g: 'actions', tone: 'actions', icon: 'coin', t: t('yc.top.a.recharge'), m: balance === null ? '' : t('yc.top.a.rechargeSub', { n: n(balance) }), to: CRM_ROUTES.yunits },
      ]
      : [
        { g: 'actions', tone: 'actions', icon: 'plug', t: t('yc.top.a.connect'), m: t('yc.top.a.connectSub'), to: CRM_ROUTES.connectors },
        { g: 'actions', tone: 'actions', icon: 'plus', t: t('yc.top.a.newCampaign'), m: t('yc.top.a.newCampaignSub'), to: CRM_ROUTES.emailTemplates },
        { g: 'actions', tone: 'actions', icon: 'coin', t: t('yc.top.a.recharge'), m: balance === null ? '' : t('yc.top.a.rechargeSub', { n: n(balance) }), to: CRM_ROUTES.yunits },
      ];
    const recent = [...nights, ...campaigns];
    return ([[t('yc.top.g.recent'), recent], [t('yc.top.g.actions'), actions]] as [string, Item[]][]).filter((x) => x[1].length);
  }, [search.data, term, pages, t, n, dShort, dWeek, time, hasConnection, balance]);

  const flat = groups.flatMap((g) => g[1]);
  const actC = Math.min(act, Math.max(0, flat.length - 1));

  useEffect(() => {
    if (!kb.current) return;
    kb.current = false;
    const c = listRef.current;
    const el = c?.querySelector('[data-sr-active="true"]') as HTMLElement | null;
    if (!c || !el) return;
    if (el.offsetTop - 28 < c.scrollTop) c.scrollTop = Math.max(0, el.offsetTop - 28);
    else if (el.offsetTop + el.offsetHeight > c.scrollTop + c.clientHeight) c.scrollTop = el.offsetTop + el.offsetHeight - c.clientHeight + 8;
  });

  const pick = (it: Item) => {
    setOpen(false); setQ(''); setAct(0);
    inputRef.current?.blur();
    nav(it.to);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const N = flat.length;
    if (e.key === 'ArrowDown' && N) { e.preventDefault(); kb.current = true; setAct((actC + 1) % N); setOpen(true); }
    else if (e.key === 'ArrowUp' && N) { e.preventDefault(); kb.current = true; setAct((actC - 1 + N) % N); setOpen(true); }
    else if (e.key === 'Enter' && flat[actC]) { e.preventDefault(); pick(flat[actC]); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  let k = 0;
  return (
    <div style={{ position: 'relative', flex: '1 1 0', maxWidth: 380, minWidth: 150 }}>
      {open && <div onClick={() => { setOpen(false); inputRef.current?.blur(); }} style={{ position: 'fixed', inset: 0, zIndex: -1, background: 'rgba(26,20,18,.16)' }} />}
      <label style={{
        height: 40, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 14px', borderRadius: 99, background: '#fff',
        border: `1px solid ${open ? 'var(--sand-400)' : 'var(--sand-200)'}`, boxShadow: open ? '0 0 0 4px rgba(26,20,18,.06)' : 'none',
        cursor: 'text', transition: 'border-color 140ms,box-shadow 140ms',
      }}>
        <Icon name="search" size={16} stroke={2.2} color="var(--sand-400)" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setAct(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          autoComplete="off"
          aria-label={t('yc.top.searchAria')}
          placeholder={t('yc.top.searchPh')}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: '400 14px/1 var(--font-body)', color: 'var(--ink)', boxShadow: 'none' }}
        />
        {q
          ? (
            <button type="button" onClick={() => { setQ(''); setAct(0); inputRef.current?.focus(); }} aria-label={t('yc.top.clearSearch')} style={{ flex: 'none', width: 24, height: 24, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              <Icon name="x" size={12} stroke={2.6} />
            </button>
          )
          : <span style={{ flex: 'none', height: 22, padding: '0 7px', borderRadius: 7, background: 'var(--sand-100)', color: 'var(--sand-500)', font: '500 12px/22px var(--font-mono)' }}>⌘K</span>}
      </label>
      {open && (
        <div style={{ position: 'absolute', top: 48, left: 0, width: 'min(580px, calc(100vw - 40px))', borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'yc-pop 200ms cubic-bezier(.22,1,.36,1) both', zIndex: 2 }}>
          <div ref={listRef} style={{ position: 'relative', maxHeight: 'min(440px, 60vh)', overflowY: 'auto', padding: 8 }}>
            {groups.map(([label, items]) => (
              <div key={label}>
                <div style={{ padding: '10px 10px 4px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{label}</div>
                {items.map((it) => {
                  const idx = k++;
                  const on = idx === actC;
                  const tl = TL[it.tone] ?? TL.pages;
                  return (
                    <a
                      key={`${it.g}-${it.to}-${idx}`}
                      href={it.to}
                      data-sr-active={on ? 'true' : 'false'}
                      onClick={(e) => { e.preventDefault(); pick(it); }}
                      onMouseEnter={() => { if (act !== idx) setAct(idx); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 12, background: on ? 'var(--sand-50)' : 'transparent', color: 'var(--ink)', textDecoration: 'none' }}
                    >
                      <span style={{ flex: 'none', width: 34, height: 34, borderRadius: tl[2], background: tl[0], color: tl[1], display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}>
                        {it.ini ? it.ini : <Icon name={it.icon ?? 'arrowRight'} size={17} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: '19px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.t}</span>
                        {it.m && <span style={{ fontSize: 13, lineHeight: '17px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.m}</span>}
                      </span>
                      {on && <span style={{ flex: 'none', height: 22, padding: '0 7px', borderRadius: 7, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--sand-500)', font: '500 12px/22px var(--font-mono)' }}>↵</span>}
                    </a>
                  );
                })}
              </div>
            ))}
            {term && !flat.length && !search.isFetching && (
              <div style={{ padding: '28px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.top.noResult', { q: term })}</span>
                <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.top.noResultHint')}</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 18px', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)', fontSize: 12.5, color: 'var(--sand-500)' }}>
            <span>{t('yc.top.kbNav')}</span><span>{t('yc.top.kbOpen')}</span><span>{t('yc.top.kbClose')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
