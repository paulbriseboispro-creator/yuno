/**
 * Légal › Journal (`/admin/legal/audit`) : UN journal des gestes sur la
 * plateforme, `admin_legal_audit` = admin_audit_log (gestes du super admin,
 * Suite comme ex-Admin CRM) ∪ admin_support_audit (accès assisté, agent
 * compris). Filtres : période (`?p=`), source, compte (`?account=venue:…`),
 * texte. Lecture seule.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Block, Drawer, ErrorState, KeyValue, Page, Segmented, useAdminT } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { useLegalAudit, type AuditEntry, type AuditSource } from './data';
import { proHref } from './rules';
import { tOr } from './format';

export default function AuditPage() {
  const { t, lang } = useAdminT();
  const [sp, setSp] = useSearchParams();
  const source = (['admin', 'support', 'agent'].includes(sp.get('source') ?? '') ? sp.get('source') : 'all') as AuditSource;
  const account = sp.get('account') ?? '';
  const [draft, setDraft] = useState(account);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const r = useLegalAudit(source, account, q);
  const rows = useMemo(() => r.data?.rows ?? [], [r.data]);
  const set = (k: string, v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v && v !== 'all') n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const label = (a: string) => tOr(t, `adm.audit.a.${a}`, tOr(t, `adm.lg2.au.a.${a}`, a));
  // La frise : les gestes groupés par jour, du plus récent au plus ancien.
  const days = useMemo(() => {
    const m = new Map<string, AuditEntry[]>();
    for (const e of rows) { const k = e.at.slice(0, 10); (m.get(k) ?? m.set(k, []).get(k)!).push(e); }
    return [...m.entries()];
  }, [rows]);
  const counts = { admin: rows.filter((x) => x.source === 'admin').length, support: rows.filter((x) => x.source === 'support').length, agent: rows.filter((x) => x.source === 'agent').length };

  return (
    <Page title={t('adm.lg2.au.title')} subtitle={t('adm.lg2.au.sub')} period
      actions={<Segmented value={source} onChange={(v) => set('source', v)} label={t('adm.lg2.au.col.source')}
        options={(['all', 'admin', 'support', 'agent'] as const).map((s) => ({ value: s, label: t(`adm.lg2.au.src.${s}`) }))} />}>
      <section className="flex flex-col gap-2">
        <span className="a-kicker">{t('adm.lg3.au.kicker')}</span>
        <p className="a-hero-sentence max-w-[68ch]">
          {r.isLoading ? <span className="a-skel inline-block h-5 w-96 max-w-full align-middle" /> : rows.length === 0 ? t('adm.lg3.au.none') : t('adm.lg3.au.sentence', { n: fmtNum(rows.length, lang), a: counts.admin, s: counts.support, g: counts.agent })}
        </p>
        <form className="flex flex-wrap gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); set('account', draft.trim()); }}>
          <input className="a-input a-mono max-w-[300px]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('adm.lg2.au.account')} aria-label={t('adm.lg2.au.account')} />
          <input className="a-input max-w-[260px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adm.lg2.au.search')} aria-label={t('adm.lg2.au.search')} />
          <button type="submit" className="a-btn">{t('adm.lg2.au.filter')}</button>
          {(account || q) && <button type="button" className="a-btn a-btn--ghost" onClick={() => { setDraft(''); setQ(''); set('account', ''); }}>{t('adm.lg2.clear')}</button>}
        </form>
      </section>
      {r.isError && !r.data ? <ErrorState onRetry={() => void r.refetch()} /> : (
        <div className="flex flex-col gap-6">
          {days.map(([day, list]) => (
            <Block key={day} title={fmtDate(`${day}T12:00:00Z`, lang, 'long')} meta={t('adm.lg3.au.dayCount', { n: list.length })}>
              <ol className="flex flex-col">
                {list.map((e) => (
                  <li key={`${e.source}:${e.id}`}>
                    <button type="button" onClick={() => setOpen(e)} className="a-focus grid w-full grid-cols-1 items-baseline gap-x-4 rounded-md px-1 py-2 text-left hover:bg-[var(--a-hover)] md:grid-cols-[56px_88px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                      <span className="a-mono a-t3 text-[11px]">{new Date(e.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="a-mono text-[10.5px] uppercase tracking-wide" style={{ color: e.source === 'support' ? 'var(--a-warn)' : e.source === 'agent' ? 'var(--a-accent-text)' : 'var(--a-text-3)' }}>{t(`adm.lg2.au.src.${e.source}`)}</span>
                      <span className="a-t1 min-w-0 truncate text-[13px]"><span className="a-t3">{e.actor ?? '—'}</span> · {label(e.action)}</span>
                      <span className="a-t2 min-w-0 truncate text-[12.5px]">{e.target ?? ([e.entity_type, e.entity_id?.slice(0, 40)].filter(Boolean).join(' · ') || '—')}</span>
                      <span className="a-t2 min-w-0 truncate text-[12.5px]">{e.reason ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </Block>
          ))}
        </div>
      )}
      {open && (
        <Drawer open onOpenChange={(v) => { if (!v) setOpen(null); }} title={label(open.action)} description={fmtDate(open.at, lang, 'datetime')}>
          <KeyValue items={[
            { label: t('adm.lg2.au.col.source'), value: t(`adm.lg2.au.src.${open.source}`) },
            { label: t('adm.lg2.au.col.actor'), value: open.actor ?? '—' },
            { label: t('adm.lg2.au.col.target'), value: open.target ?? [open.entity_type, open.entity_id].filter(Boolean).join(' · ') ?? '—', mono: true },
            { label: t('adm.lg2.au.col.reason'), value: open.reason ?? '—' },
            { label: t('adm.lg2.au.code'), value: open.action, mono: true },
          ]} />
          {proHref(open.entity_id) && <Link className="a-btn a-btn--sm mt-3" to={proHref(open.entity_id) as string}>{t('adm.lg2.openPro')}</Link>}
          {open.detail && <pre className="a-subtle a-mono a-t2 mt-4 overflow-x-auto rounded-lg p-3 text-[11.5px]">{JSON.stringify(open.detail, null, 2)}</pre>}
        </Drawer>
      )}
    </Page>
  );
}
