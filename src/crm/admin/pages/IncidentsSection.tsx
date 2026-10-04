/**
 * Admin CRM › Légal › Registre des incidents (RGPD art. 33 : la CNIL dans les
 * 72 heures après la découverte). Déclarer, suivre le compte à rebours, noter
 * la notification CNIL, préparer la liste des pros à prévenir (rien n'est
 * envoyé : l'écran donne les adresses et un texte à copier), clore. Chaque
 * geste demande un motif et s'écrit au journal d'audit (crm_admin_incident_*).
 * L'alerte super admin part seule à H-24 et H-6 (crm_incident_deadline_sweep).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { rpc } from '@/crm/lib/rpc';
import { Modal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { useAdminAccounts, useAdminGesture } from '../data';
import { EmptyNote, Section } from '../ui';

interface Incident {
  id: string; declared_at: string; discovered_at: string; nature: string; accounts: string[]; persons_estimate: number | null; measures: string | null;
  cnil_notified_at: string | null; cnil_reference: string | null; pros_notified_at: string | null; closed_at: string | null; deadline: string;
  audit: { at: string; action: string; reason: string | null }[];
}
type Pro = { id: string; name: string; contact: string | null; email: string | null; is_demo: boolean };

const input = { height: 44, borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 12px', font: 'inherit', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 } as const;
const btn = { height: 38, padding: '0 14px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' } as const;

/** « 31 h 12 » restantes, ou dépassé. Rafraîchi chaque minute. */
function useLeft(deadline: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id); }, []);
  return (new Date(deadline).getTime() - now) / 3_600_000;
}

function toLocalInput(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function IncidentsSection() {
  const { t } = useCrmT();
  const q = useQuery({ queryKey: ['crm-admin', 'incidents'], staleTime: 15_000, queryFn: () => rpc<{ at: string; incidents: Incident[] }>('crm_admin_incidents') });
  const [form, setForm] = useState<Incident | 'new' | null>(null);
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  const list = q.data?.incidents ?? [];
  const open = list.filter((i) => !i.closed_at);
  return (
    <Section title={t('adm.crm.in.title')} sub={t('adm.crm.in.sub')} pad={24} gap={12}
      right={<Hv as="button" type="button" onClick={() => setForm('new')} style={{ ...btn, border: 0, background: 'var(--ink)', color: '#fff' }}>{t('adm.crm.in.declare')}</Hv>}>
      {!q.data && <Skel h={120} r={18} />}
      {q.data && list.length === 0 && <EmptyNote>{t('adm.crm.in.none')}</EmptyNote>}
      {list.map((i) => <IncidentRow key={i.id} i={i} onEdit={() => setForm(i)} />)}
      {q.data && open.length === 0 && list.length > 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.in.allClosed')}</span>}
      {form && <IncidentForm incident={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void q.refetch(); }} />}
    </Section>
  );
}

function IncidentRow({ i, onEdit }: { i: Incident; onEdit: () => void }) {
  const { t, dShort, time, n } = useCrmT();
  const left = useLeft(i.deadline);
  const [pros, setPros] = useState<Pro[] | null>(null);
  const toast = useCrmToast();
  const done = !!i.cnil_notified_at;
  const urgent = !done && !i.closed_at;
  const tone = !urgent ? 'var(--sand-600)' : left <= 6 ? 'var(--red-600)' : left <= 24 ? 'var(--amber-700)' : 'var(--ink)';
  const prepare = async () => {
    try { setPros(await rpc<Pro[]>('crm_admin_incident_pros', { p_id: i.id })); } catch { toast(t('adm.crm.ac.err.x')); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 18, background: urgent ? (left <= 24 ? 'var(--red-50)' : 'var(--sand-50)') : '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <b style={{ fontSize: 15.5, lineHeight: 1.35 }}>{i.nature}</b>
          <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>
            {t('adm.crm.in.discovered', { date: `${dShort(i.discovered_at)} ${time(i.discovered_at)}` })} · {t('adm.crm.in.accounts', { n: i.accounts.length })}{i.persons_estimate !== null ? ` · ${t('adm.crm.in.persons', { n: n(i.persons_estimate) })}` : ''}
          </span>
        </span>
        <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-.02em', color: tone, fontVariantNumeric: 'tabular-nums' }}>
            {i.closed_at ? t('adm.crm.in.closed') : done ? t('adm.crm.in.cnilDone') : left <= 0 ? t('adm.crm.in.overdue') : t('adm.crm.in.left', { h: Math.floor(left), m: String(Math.floor((left % 1) * 60)).padStart(2, '0') })}
          </b>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{done ? `${dShort(i.cnil_notified_at as string)}${i.cnil_reference ? ` · ${i.cnil_reference}` : ''}` : t('adm.crm.in.deadline', { date: `${dShort(i.deadline)} ${time(i.deadline)}` })}</span>
        </span>
      </div>
      {i.measures && <span style={{ fontSize: 13.5, color: 'var(--sand-700)', lineHeight: 1.45 }}>{t('adm.crm.in.measuresL')} {i.measures}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Hv as="button" type="button" onClick={onEdit} style={btn} hover={{ background: 'var(--sand-50)' }}>{t('adm.crm.in.update')}</Hv>
        {i.accounts.length > 0 && <Hv as="button" type="button" onClick={() => void prepare()} style={btn} hover={{ background: 'var(--sand-50)' }}>{t('adm.crm.in.warn')}</Hv>}
        <span style={{ alignSelf: 'center', fontSize: 12.5, color: i.pros_notified_at ? 'var(--green-700)' : 'var(--sand-500)' }}>{i.pros_notified_at ? t('adm.crm.in.prosDone', { date: dShort(i.pros_notified_at) }) : t('adm.crm.in.prosNot')}</span>
      </div>
      {pros && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('adm.crm.in.prosList', { n: pros.length })}</span>
          {pros.map((p) => <span key={p.id} style={{ fontSize: 13.5 }}>{p.name}{p.contact ? ` · ${p.contact}` : ''} · <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{p.email ?? '—'}</span>{p.is_demo ? ` (${t('adm.crm.demoTag')})` : ''}</span>)}
          <Hv as="button" type="button" style={{ ...btn, alignSelf: 'flex-start' }}
            onClick={() => { void navigator.clipboard?.writeText(pros.filter((p) => p.email && !p.is_demo).map((p) => p.email).join(', ')).then(() => toast(t('adm.crm.in.copied'))); }}>{t('adm.crm.in.copy')}</Hv>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>{t('adm.crm.in.noSend')}</span>
        </div>
      )}
      {i.audit.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--sand-600)', fontWeight: 600 }}>{t('adm.crm.in.log', { n: i.audit.length })}</summary>
          {i.audit.map((a, k) => <div key={k} style={{ fontSize: 12.5, color: 'var(--sand-600)', padding: '4px 0' }}>{dShort(a.at)} {time(a.at)} · {t(`adm.crm.in.a.${a.action}`)}{a.reason ? ` · « ${a.reason} »` : ''}</div>)}
        </details>
      )}
    </div>
  );
}

function IncidentForm({ incident, onClose, onSaved }: { incident: Incident | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const save = useAdminGesture<{ p_id: string | null; p_patch: Record<string, unknown>; p_reason: string }>('crm_admin_incident_save');
  const accounts = useAdminAccounts().data?.accounts ?? [];
  const [discovered, setDiscovered] = useState(toLocalInput(incident ? new Date(incident.discovered_at) : new Date()));
  const [nature, setNature] = useState(incident?.nature ?? '');
  const [picked, setPicked] = useState<string[]>(incident?.accounts ?? []);
  const [persons, setPersons] = useState<string>(incident?.persons_estimate != null ? String(incident.persons_estimate) : '');
  const [measures, setMeasures] = useState(incident?.measures ?? '');
  const [cnil, setCnil] = useState(incident?.cnil_notified_at ? toLocalInput(new Date(incident.cnil_notified_at)) : '');
  const [cnilRef, setCnilRef] = useState(incident?.cnil_reference ?? '');
  const [prosAt, setProsAt] = useState(incident?.pros_notified_at ? toLocalInput(new Date(incident.pros_notified_at)) : '');
  const [closed, setClosed] = useState(!!incident?.closed_at);
  const [reason, setReason] = useState('');
  const iso = (v: string) => (v ? new Date(v).toISOString() : '');
  const submit = () => {
    const patch: Record<string, unknown> = { discovered_at: iso(discovered), nature, accounts: picked, persons_estimate: persons, measures };
    if (incident) Object.assign(patch, { cnil_notified_at: iso(cnil), cnil_reference: cnilRef, pros_notified_at: iso(prosAt), closed_at: closed ? (incident.closed_at ?? new Date().toISOString()) : '' });
    save.mutate({ p_id: incident?.id ?? null, p_patch: patch, p_reason: reason }, { onSuccess: () => { toast(t('adm.crm.in.saved')); onSaved(); }, onError: () => toast(t('adm.crm.ac.err.x')) });
  };
  const ok = nature.trim().length >= 3 && !!discovered && reason.trim().length >= 3;
  return (
    <Modal open onClose={onClose} width={620} label={t(incident ? 'adm.crm.in.update' : 'adm.crm.in.declare')}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t(incident ? 'adm.crm.in.update' : 'adm.crm.in.declare')}</h2>
        <label style={lbl}>{t('adm.crm.in.f.discovered')}<input type="datetime-local" value={discovered} onChange={(e) => setDiscovered(e.target.value)} style={input} /></label>
        <label style={lbl}>{t('adm.crm.in.f.nature')}<textarea value={nature} onChange={(e) => setNature(e.target.value)} rows={3} maxLength={2000} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        <div style={lbl}>{t('adm.crm.in.f.accounts', { n: picked.length })}
          <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', fontWeight: 400 }}>
            {accounts.map((a) => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))} />{a.name}
              </label>
            ))}
          </div>
        </div>
        <label style={lbl}>{t('adm.crm.in.f.persons')}<input type="number" min={0} value={persons} onChange={(e) => setPersons(e.target.value)} style={input} /></label>
        <label style={lbl}>{t('adm.crm.in.f.measures')}<textarea value={measures} onChange={(e) => setMeasures(e.target.value)} rows={3} maxLength={4000} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        {incident && (
          <>
            <label style={lbl}>{t('adm.crm.in.f.cnil')}<input type="datetime-local" value={cnil} onChange={(e) => setCnil(e.target.value)} style={input} /></label>
            <label style={lbl}>{t('adm.crm.in.f.cnilRef')}<input value={cnilRef} onChange={(e) => setCnilRef(e.target.value)} maxLength={120} style={input} /></label>
            <label style={lbl}>{t('adm.crm.in.f.pros')}<input type="datetime-local" value={prosAt} onChange={(e) => setProsAt(e.target.value)} style={input} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />{t('adm.crm.in.f.closed')}</label>
          </>
        )}
        <label style={lbl}>{t('adm.crm.ac.reason')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" disabled={!ok || save.isPending} onClick={submit} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.5 }}>{t('adm.crm.in.save')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
