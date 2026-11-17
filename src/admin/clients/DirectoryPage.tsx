/** Annuaire : DJ, promoteurs, staff, en trois onglets. Mêmes lectures qu'avant ; geste « vérifier un DJ » par motif. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge, DataTable, Page, ReasonDialog, Status, Tabs, cellTint, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { personHref } from './personKey';

const LIMIT = 1000;
const STAFF_ROLES = ['bouncer', 'vip_host', 'cloakroom', 'manager', 'barman'] as const;

async function chunked<T, R>(ids: T[], fn: (part: T[]) => PromiseLike<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await fn(ids.slice(i, i + 150))));
  return out;
}
const venueNames = async (ids: string[]): Promise<Record<string, string>> => {
  const rows = await chunked(ids, async (part) => (await supabase.from('venues').select('id, name').in('id', part)).data ?? []);
  return Object.fromEntries(rows.map((v) => [v.id, v.name]));
};

interface DjRow { id: string; user_id: string | null; name: string; city: string | null; venue: string; events: number; is_active: boolean; is_verified: boolean; created_at: string }
interface PromoRow { id: string; user_id: string | null; name: string; code: string | null; venue: string; pending: number; paid: number; is_active: boolean; created_at: string }
interface StaffRow { id: string; user_id: string; name: string; email: string; role: string; venue: string; has_pin: boolean; created_at: string }

async function loadDjs(): Promise<DjRow[]> {
  const { data, error } = await supabase.from('djs').select('id, user_id, stage_name, first_name, last_name, city, venue_id, is_active, is_verified, created_at').order('created_at', { ascending: false }).limit(LIMIT);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const evs = await chunked(rows.map((d) => d.id), async (part) => (await supabase.from('event_djs').select('dj_id').in('dj_id', part)).data ?? []);
  const count: Record<string, number> = {};
  for (const e of evs) count[e.dj_id] = (count[e.dj_id] ?? 0) + 1;
  const vn = await venueNames([...new Set(rows.map((d) => d.venue_id).filter(Boolean))] as string[]);
  return rows.map((d) => ({
    id: d.id, user_id: d.user_id, name: d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || '—', city: d.city,
    venue: d.venue_id ? vn[d.venue_id] ?? '—' : '—', events: count[d.id] ?? 0, is_active: !!d.is_active, is_verified: !!d.is_verified, created_at: d.created_at,
  }));
}

async function loadPromoters(): Promise<PromoRow[]> {
  const { data, error } = await supabase.from('promoters').select('id, user_id, first_name, last_name, promo_code, venue_id, pending_amount, total_paid, is_active, created_at').order('created_at', { ascending: false }).limit(LIMIT);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const vn = await venueNames([...new Set(rows.map((p) => p.venue_id).filter(Boolean))] as string[]);
  return rows.map((p) => ({
    id: p.id, user_id: p.user_id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—', code: p.promo_code,
    venue: p.venue_id ? vn[p.venue_id] ?? '—' : '—', pending: Number(p.pending_amount ?? 0), paid: Number(p.total_paid ?? 0), is_active: !!p.is_active, created_at: p.created_at,
  }));
}

async function loadStaff(): Promise<StaffRow[]> {
  const { data, error } = await supabase.from('user_roles').select('user_id, role, created_at').in('role', [...STAFF_ROLES]).order('created_at', { ascending: false }).limit(LIMIT);
  if (error) throw new Error(error.message);
  const roles = data ?? [];
  const ids = [...new Set(roles.map((r) => r.user_id))];
  const profiles = await chunked(ids, async (part) => (await supabase.from('profiles').select('id, email, first_name, last_name, staff_display_name, venue_id').in('id', part)).data ?? []);
  // Le PIN lui-même ne quitte jamais la base : seulement son existence.
  const pins = await chunked(ids, async (part) => (await supabase.from('profiles').select('id').in('id', part).not('employee_pin', 'is', null)).data ?? []);
  const pinSet = new Set(pins.map((p) => p.id));
  const pm = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const vn = await venueNames([...new Set(profiles.map((p) => p.venue_id).filter(Boolean))] as string[]);
  return roles.map((r) => {
    const p = pm[r.user_id];
    return {
      id: `${r.user_id}-${r.role}`, user_id: r.user_id, email: p?.email ?? '—',
      name: p ? p.staff_display_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—' : '—',
      role: r.role, venue: p?.venue_id ? vn[p.venue_id] ?? '—' : '—', has_pin: pinSet.has(r.user_id), created_at: r.created_at,
    };
  });
}

export default function DirectoryPage() {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const djs = useQuery({ queryKey: ['adm-dir-djs'], queryFn: loadDjs });
  const promos = useQuery({ queryKey: ['adm-dir-promoters'], queryFn: loadPromoters });
  const staff = useQuery({ queryKey: ['adm-dir-staff'], queryFn: loadStaff });
  const tabs = [
    { value: 'djs', label: t('adm.cl.dir.tab.djs'), count: djs.data?.length },
    { value: 'promoters', label: t('adm.cl.dir.tab.promoters'), count: promos.data?.length },
    { value: 'staff', label: t('adm.cl.dir.tab.staff'), count: staff.data?.length },
  ];
  const [tab, setTab] = useTab(tabs);
  const [verify, setVerify] = useState<DjRow | null>(null);

  const nameCell = (name: string, userId: string | null) => (userId ? <Link className="a-t1 font-medium hover:underline" to={personHref(userId)}>{name}</Link> : <span className="a-t1 font-medium">{name}</span>);
  const roleLabel = (r: string) => { const k = `adm.people.role.${r}`; const v = t(k); return v === k ? r : v; };
  const active = (b: boolean) => <Status tone={b ? 'positive' : 'neutral'}>{t(b ? 'adm.cl.dir.active' : 'adm.cl.dir.inactive')}</Status>;
  const created = (c: { getValue: () => unknown }) => fmtDate(c.getValue() as string, lang);

  const maxEv = Math.max(0, ...(djs.data ?? []).map((d) => d.events));
  const maxPend = Math.max(0, ...(promos.data ?? []).map((p) => p.pending));
  const djCols: ColumnDef<DjRow>[] = [
    { accessorKey: 'name', header: t('adm.cl.dir.col.dj'), cell: (c) => nameCell(c.row.original.name, c.row.original.user_id) },
    { accessorKey: 'city', header: t('adm.cl.dir.col.city'), cell: (c) => c.getValue<string | null>() || '—' },
    { accessorKey: 'venue', header: t('adm.cl.dir.col.venue') },
    { accessorKey: 'events', header: t('adm.cl.dir.col.events'), meta: { align: 'right', tint: (r) => cellTint(r.events, maxEv) }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'is_active', header: t('adm.cl.dir.col.status'), cell: (c) => active(c.getValue<boolean>()) },
    { accessorKey: 'is_verified', header: t('adm.cl.dir.col.verified'), cell: (c) => {
      const r = c.row.original;
      return r.user_id ? (
        <button type="button" className="a-btn a-btn--sm a-btn--ghost" onClick={() => setVerify(r)} style={r.is_verified ? { color: 'var(--a-pos)' } : undefined}>
          <BadgeCheck className="h-3.5 w-3.5" />{t(r.is_verified ? 'adm.cl.dir.verified' : 'adm.cl.dir.verify')}
        </button>
      ) : <Badge>{t('adm.cl.dir.noAccount')}</Badge>;
    } },
    { accessorKey: 'created_at', header: t('adm.cl.dir.col.created'), meta: { align: 'right' }, cell: created },
  ];
  const promoCols: ColumnDef<PromoRow>[] = [
    { accessorKey: 'name', header: t('adm.cl.dir.col.promoter'), cell: (c) => nameCell(c.row.original.name, c.row.original.user_id) },
    { accessorKey: 'code', header: t('adm.cl.dir.col.code'), cell: (c) => <span className="a-mono">{c.getValue<string | null>() ?? '—'}</span> },
    { accessorKey: 'venue', header: t('adm.cl.dir.col.venue') },
    { accessorKey: 'pending', header: t('adm.cl.dir.col.pending'), meta: { align: 'right', tint: (r) => cellTint(r.pending, maxPend) }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'paid', header: t('adm.cl.dir.col.paid'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'is_active', header: t('adm.cl.dir.col.status'), cell: (c) => active(c.getValue<boolean>()) },
    { accessorKey: 'created_at', header: t('adm.cl.dir.col.created'), meta: { align: 'right' }, cell: created },
  ];
  const staffCols: ColumnDef<StaffRow>[] = [
    { accessorKey: 'name', header: t('adm.cl.dir.col.name'), cell: (c) => nameCell(c.row.original.name, c.row.original.user_id) },
    { accessorKey: 'email', header: t('adm.cl.dir.col.email') },
    { accessorKey: 'role', header: t('adm.cl.dir.col.role'), cell: (c) => <Badge>{roleLabel(c.getValue<string>())}</Badge> },
    { accessorKey: 'venue', header: t('adm.cl.dir.col.venue') },
    { accessorKey: 'has_pin', header: t('adm.cl.dir.col.pin'), cell: (c) => <Status tone={c.getValue<boolean>() ? 'positive' : 'neutral'}>{t(c.getValue<boolean>() ? 'adm.cl.dir.pin.set' : 'adm.cl.dir.pin.none')}</Status> },
    { accessorKey: 'created_at', header: t('adm.cl.dir.col.created'), meta: { align: 'right' }, cell: created },
  ];

  const confirmVerify = async (reason: string) => {
    const d = verify; if (!d?.user_id) return;
    const next = !d.is_verified;
    const { error } = await supabase.rpc('admin_set_dj_verified', { p_dj_user_id: d.user_id, p_verified: next });
    if (error) throw new Error(error.message);
    await supabase.rpc('admin_log_action', { _action: next ? 'dj_verified' : 'dj_unverified', _entity_type: 'dj', _entity_id: d.id, _metadata: { reason } });
    toast.success(t(next ? 'adm.cl.dir.done.verified' : 'adm.cl.dir.done.unverified'));
    await qc.invalidateQueries({ queryKey: ['adm-dir-djs'] });
  };

  return (
    <Page title={t('adm.cl.dir.title')} subtitle={t('adm.cl.dir.subtitle')}>
      <div className="flex flex-col gap-4">
        {djs.data && promos.data && staff.data && (
          <p className="a-hero-sentence max-w-[72ch]">
            <b>{fmtNum(djs.data.length, lang)}</b> {t('adm.cl.v3.dir.djs', { v: fmtNum(djs.data.filter((d) => d.is_verified).length, lang) })},{' '}
            <b>{fmtNum(promos.data.length, lang)}</b> {t('adm.cl.v3.dir.promos', { a: fmtNum(promos.data.filter((p) => p.is_active).length, lang) })},{' '}
            <b>{fmtNum(staff.data.length, lang)}</b> {t('adm.cl.v3.dir.staff', { p: fmtNum(staff.data.filter((x) => !x.has_pin).length, lang) })}.
          </p>
        )}
        <Tabs items={tabs} value={tab} onChange={setTab} />
        {tab === 'djs' && <DataTable data={djs.data} columns={djCols} loading={djs.isLoading} error={djs.error} onRetry={() => void djs.refetch()} searchable getRowId={(r) => r.id} />}
        {tab === 'promoters' && <DataTable data={promos.data} columns={promoCols} loading={promos.isLoading} error={promos.error} onRetry={() => void promos.refetch()} searchable getRowId={(r) => r.id} />}
        {tab === 'staff' && <DataTable data={staff.data} columns={staffCols} loading={staff.isLoading} error={staff.error} onRetry={() => void staff.refetch()} searchable getRowId={(r) => r.id} />}
      </div>
      {verify && (
        <ReasonDialog open onOpenChange={(v) => { if (!v) setVerify(null); }}
          title={t(verify.is_verified ? 'adm.cl.dir.unverify.title' : 'adm.cl.dir.verify.title', { name: verify.name })}
          description={t(verify.is_verified ? 'adm.cl.dir.unverify.desc' : 'adm.cl.dir.verify.desc')} onConfirm={confirmVerify} />
      )}
    </Page>
  );
}
