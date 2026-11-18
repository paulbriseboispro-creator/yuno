/**
 * Légal › Incidents (`/admin/legal/incidents`) : le registre des violations de
 * données (`crm_incidents`), ouvert aux deux produits (colonne `product`).
 *
 * Deux échéances lues dans le dépôt : la CNIL sous 72 h après la découverte
 * (RGPD art. 33, déjà portée par crm_incident_deadline_sweep) ; les pros sous
 * 48 h pour Yuno CRM (Accord de sous-traitance, 12.8) et « dans les meilleurs
 * délais » pour la Billetterie (même accord, article 7). Préparer la liste des
 * pros à prévenir n'envoie rien. Chaque geste demande un motif (journal).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Block, Checkbox, Drawer, ErrorState, KeyValue, Page, ReasonDialog, Section, Timeline, useAdminT, Countdown, EmptyLine, Ledger, LedgerRow, Status, Steps, useNow, Verdict, type Tone } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { prepareIncidentPros, useIncidentSave, useLegalAccounts, useLegalIncidents, type Incident } from './data';
import { hoursUntil, proHref, type LegalState, stateTone } from './rules';
import { SourceNote } from './ui';
import { Field, Segmented } from '@/admin/ui';
import { fromLocalInput, toLocalInput } from './format';

type Product = Incident['product'];

function incidentState(i: Incident, now: number): LegalState {
  if (i.closed_at) return 'ok';
  if (!i.cnil_notified_at && (hoursUntil(i.deadline, now) ?? 1) <= 0) return 'late';
  return 'todo';
}

export default function IncidentsPage() {
  const { t, lang } = useAdminT();
  const q = useLegalIncidents();
  const now = useNow();
  const [open, setOpen] = useState<Incident | 'new' | null>(null);
  const list = useMemo(() => q.data?.incidents ?? [], [q.data]);
  const openList = useMemo(() => list.filter((i) => !i.closed_at).sort((a, b) => a.deadline.localeCompare(b.deadline)), [list]);
  // L'incident qui presse : le premier dont la CNIL n'est pas encore prévenue, sinon le premier ouvert.
  const lead = openList.find((i) => !i.cnil_notified_at) ?? openList[0] ?? null;
  const late = list.filter((i) => incidentState(i, now) === 'late');

  const rowState = (i: Incident): Tone => stateTone(incidentState(i, now));
  const cnilLabel = (i: Incident) => {
    if (i.closed_at) return t('adm.lg2.in.closed');
    if (i.cnil_notified_at) return t('adm.lg2.in.cnilDone');
    const h = hoursUntil(i.deadline, now) ?? 0;
    return h <= 0 ? t('adm.lg2.in.overdue') : t('adm.lg2.in.left', { h: Math.floor(h) });
  };

  return (
    <Page title={t('adm.lg2.in.title')} subtitle={t('adm.lg2.in.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setOpen('new')}><Plus className="h-4 w-4" />{t('adm.lg2.in.declare')}</button>}>
      {q.isError && !q.data ? <ErrorState onRetry={() => void q.refetch()} /> : !q.data ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[26rem] max-w-full" /><div className="a-skel h-16 w-72" /></div>
      ) : !lead ? (
        <Verdict tone="positive" kicker={t('adm.lg3.in.kicker')} headline={t('adm.lg2.in.none')} sub={t(list.length === 0 ? 'adm.lg3.in.emptySub' : 'adm.lg3.in.noneSub', { n: list.length })} />
      ) : (
        <section className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Countdown label={t('adm.lg3.in.cnilClock')} hours={hoursUntil(lead.deadline, now) ?? 0} total={72} tone={rowState(lead)}
            done={lead.cnil_notified_at ? t('adm.lg2.in.cnilDone') : undefined} />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="a-kicker">{t('adm.lg3.in.lead', { n: openList.length })}</span>
              <button type="button" className="a-focus a-t1 rounded-md text-left text-[20px] font-semibold leading-snug tracking-[-0.02em] hover:underline" onClick={() => setOpen(lead)}>{lead.nature}</button>
              <span className="a-t2 text-[12.5px]">{t(`adm.lg2.in.product.${lead.product}`)} · {t('adm.lg3.in.accounts', { n: lead.accounts.length })}{lead.persons_estimate != null ? ` · ${t('adm.lg3.in.persons', { n: fmtNum(lead.persons_estimate, lang) })}` : ''}</span>
            </div>
            <Steps items={[
              { key: 'found', label: t('adm.lg3.in.step.found'), when: fmtDate(lead.discovered_at, lang, 'datetime'), done: true },
              { key: 'cnil', label: t('adm.lg3.in.step.cnil'), when: lead.cnil_notified_at ? fmtDate(lead.cnil_notified_at, lang, 'datetime') : fmtDate(lead.deadline, lang, 'datetime'), done: !!lead.cnil_notified_at, current: !lead.cnil_notified_at },
              { key: 'pros', label: t('adm.lg3.in.step.pros'), when: lead.pros_notified_at ? fmtDate(lead.pros_notified_at, lang, 'datetime') : undefined, done: !!lead.pros_notified_at, current: !!lead.cnil_notified_at && !lead.pros_notified_at },
              { key: 'closed', label: t('adm.lg3.in.step.closed'), when: lead.closed_at ? fmtDate(lead.closed_at, lang, 'datetime') : undefined, done: !!lead.closed_at },
            ]} />
            <div><button type="button" className="a-btn a-btn--sm" onClick={() => setOpen(lead)}>{t('adm.lg3.in.openLead')}</button></div>
          </div>
        </section>
      )}

      <Block title={t('adm.lg3.in.register')} meta={q.data ? t('adm.lg3.in.registerMeta', { n: list.length, l: late.length }) : undefined}>
        {!q.data ? <div className="a-skel h-20 w-full" /> : list.length === 0 ? <EmptyLine>{t('adm.lg2.in.noneBody')}</EmptyLine> : (
          <Ledger>
            {list.map((i) => {
              const st = incidentState(i, now);
              return (
                <LedgerRow key={i.id} onClick={() => setOpen(i)} selected={i.id === lead?.id} className="grid-cols-1 md:grid-cols-[120px_minmax(0,1.6fr)_minmax(0,1fr)_130px]">
                  <Status strong tone={stateTone(st)}>{t(`adm.lg2.state.${st}`)}</Status>
                  <div className="flex min-w-0 flex-col"><span className="a-t1 line-clamp-1 text-[13.5px] font-medium">{i.nature}</span>
                    <span className="a-t3 text-[12px]">{fmtDate(i.discovered_at, lang, 'datetime')} · {t(`adm.lg2.in.product.${i.product}`)}</span></div>
                  <span className="a-t2 text-[12.5px]">{t('adm.lg3.in.accounts', { n: i.accounts.length })}</span>
                  <span className="a-mono text-[11.5px]" style={{ color: st === 'late' ? 'var(--a-neg)' : undefined }}>{cnilLabel(i)}</span>
                </LedgerRow>
              );
            })}
          </Ledger>
        )}
      </Block>
      <SourceNote jurist>{t('adm.lg2.in.note')}</SourceNote>
      {open && <IncidentDrawer incident={open === 'new' ? null : open} now={now} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function IncidentDrawer({ incident, now, onClose }: { incident: Incident | null; now: number; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const save = useIncidentSave();
  const accounts = useLegalAccounts(true).data ?? [];
  const [confirm, setConfirm] = useState(false);
  const [product, setProduct] = useState<Product>(incident?.product ?? 'tickets');
  const [discovered, setDiscovered] = useState(toLocalInput(incident?.discovered_at ?? new Date().toISOString()));
  const [nature, setNature] = useState(incident?.nature ?? '');
  const [picked, setPicked] = useState<string[]>(incident?.accounts.map((a) => a.key) ?? []);
  const [filter, setFilter] = useState('');
  const [persons, setPersons] = useState(incident?.persons_estimate != null ? String(incident.persons_estimate) : '');
  const [measures, setMeasures] = useState(incident?.measures ?? '');
  const [cnil, setCnil] = useState(toLocalInput(incident?.cnil_notified_at));
  const [cnilRef, setCnilRef] = useState(incident?.cnil_reference ?? '');
  const [prosAt, setProsAt] = useState(toLocalInput(incident?.pros_notified_at));
  const [closed, setClosed] = useState(!!incident?.closed_at);
  const [pros, setPros] = useState<{ key: string; name: string; email: string | null; is_demo: boolean }[] | null>(null);

  const ok = nature.trim().length >= 3 && !!discovered;
  const patch: Record<string, unknown> = { product, discovered_at: fromLocalInput(discovered), nature, accounts: picked, persons_estimate: persons, measures };
  if (incident) Object.assign(patch, { cnil_notified_at: fromLocalInput(cnil), cnil_reference: cnilRef, pros_notified_at: fromLocalInput(prosAt), closed_at: closed ? (incident.closed_at ?? new Date().toISOString()) : '' });
  const shown = accounts.filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || picked.includes(a.key));
  const prosDue = incident && (incident.product !== 'tickets')
    ? new Date(new Date(incident.discovered_at).getTime() + 48 * 3_600_000).toISOString() : null;

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={incident ? t('adm.lg2.in.update') : t('adm.lg2.in.declare')}
      description={incident ? t('adm.lg2.in.cnilBy', { date: fmtDate(incident.deadline, lang, 'datetime') }) : t('adm.lg2.in.declareSub')}
      actions={<button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={!ok} onClick={() => setConfirm(true)}>{t('adm.lg2.save')}</button>}>
      <div className="flex flex-col gap-4">
        {incident && (
          <KeyValue items={[
            { label: t('adm.lg2.in.cnilDeadline'), value: incident.cnil_notified_at ? t('adm.lg2.in.cnilDoneAt', { date: fmtDate(incident.cnil_notified_at, lang, 'datetime') }) : `${fmtDate(incident.deadline, lang, 'datetime')} · ${Math.max(0, Math.floor(hoursUntil(incident.deadline, now) ?? 0))} h` },
            { label: t('adm.lg2.in.prosDeadline'), value: incident.pros_notified_at ? t('adm.lg2.in.prosDoneAt', { date: fmtDate(incident.pros_notified_at, lang, 'datetime') }) : prosDue ? fmtDate(prosDue, lang, 'datetime') : t('adm.lg2.in.prosAsap') },
          ]} />
        )}
        <Field label={t('adm.lg2.in.f.product')}>
          <Segmented value={product} onChange={setProduct} options={(['tickets', 'crm', 'both'] as const).map((p) => ({ value: p, label: t(`adm.lg2.in.product.${p}`) }))} />
        </Field>
        <Field label={t('adm.lg2.in.f.discovered')}><input type="datetime-local" className="a-input" value={discovered} onChange={(e) => setDiscovered(e.target.value)} /></Field>
        <Field label={t('adm.lg2.in.f.nature')}><textarea className="a-input" rows={3} maxLength={2000} value={nature} onChange={(e) => setNature(e.target.value)} /></Field>
        <Field label={t('adm.lg2.in.f.accounts', { n: picked.length })}>
          <input className="a-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('adm.lg2.in.f.accountsFilter')} />
          <div className="a-card flex max-h-[180px] flex-col gap-1 overflow-y-auto p-2">
            {shown.map((a) => (
              <label key={a.key} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={picked.includes(a.key)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.key] : p.filter((x) => x !== a.key)))} />
                <span className="a-t1 truncate">{a.name}</span>{a.is_demo && <span className="a-t3">· {t('adm.lg2.demo')}</span>}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('adm.lg2.in.f.persons')}><input type="number" min={0} className="a-input" value={persons} onChange={(e) => setPersons(e.target.value)} /></Field>
        <Field label={t('adm.lg2.in.f.measures')}><textarea className="a-input" rows={3} maxLength={4000} value={measures} onChange={(e) => setMeasures(e.target.value)} /></Field>
        {incident && (<>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('adm.lg2.in.f.cnil')}><input type="datetime-local" className="a-input" value={cnil} onChange={(e) => setCnil(e.target.value)} /></Field>
            <Field label={t('adm.lg2.in.f.cnilRef')}><input className="a-input" maxLength={120} value={cnilRef} onChange={(e) => setCnilRef(e.target.value)} /></Field>
          </div>
          <Field label={t('adm.lg2.in.f.pros')}><input type="datetime-local" className="a-input" value={prosAt} onChange={(e) => setProsAt(e.target.value)} /></Field>
          <Checkbox checked={closed} onChange={setClosed}>{t('adm.lg2.in.f.closed')}</Checkbox>
          {incident.accounts.length > 0 && (
            <div className="flex flex-col gap-2">
              <button type="button" className="a-btn a-btn--sm self-start" onClick={() => void prepareIncidentPros(incident.id).then(setPros)}>{t('adm.lg2.in.prepare')}</button>
              {pros && (
                <div className="a-card flex flex-col gap-1 p-3 text-[13px]">
                  {pros.map((p) => (
                    <span key={p.key} className="a-t1">
                      {proHref(p.key) ? <Link to={proHref(p.key) as string} className="underline-offset-2 hover:underline">{p.name}</Link> : p.name}
                      {' · '}<span className="a-mono a-t2">{p.email ?? '—'}</span>{p.is_demo && <span className="a-t3"> ({t('adm.lg2.demo')})</span>}
                    </span>
                  ))}
                  <button type="button" className="a-btn a-btn--sm mt-1 self-start"
                    onClick={() => void navigator.clipboard?.writeText(pros.filter((p) => p.email && !p.is_demo).map((p) => p.email).join(', '))}>{t('adm.lg2.in.copy')}</button>
                  <span className="a-t3 text-[12px]">{t('adm.lg2.in.noSend')}</span>
                </div>
              )}
            </div>
          )}
          <Section title={t('adm.lg2.in.log')}>
            <Timeline items={incident.audit.map((a, i) => ({ id: String(i), at: a.at, title: t(`adm.lg2.in.a.${a.action}`), body: a.reason ?? undefined }))} />
          </Section>
        </>)}
      </div>
      <ReasonDialog open={confirm} onOpenChange={setConfirm} title={incident ? t('adm.lg2.in.update') : t('adm.lg2.in.declare')} description={t('adm.lg2.reasonSub')}
        confirmLabel={t('adm.lg2.save')}
        onConfirm={async (reason) => { await save.mutateAsync({ p_id: incident?.id ?? null, p_patch: patch, p_reason: reason }); onClose(); }} />
    </Drawer>
  );
}
