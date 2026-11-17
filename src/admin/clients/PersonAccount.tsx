/** Onglet « Compte » : rôles, sécurité, suspension. Chaque geste passe par un motif, journalisé. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge, EmptyState, KeyValue, ReasonDialog, Status, useAdminT, Block as Card } from '@/admin/ui';
import { fmtDate } from '@/lib/adminFormat';
import { rpc, type Person } from './data';

const STAFF_ROLES = ['bouncer', 'vip_host', 'cloakroom', 'manager'] as const;
const OWNER_ROLE = 'owner';
// Le pilier boissons est en pause : on n'attribue plus le rôle de barman (les rôles déjà posés restent lisibles).
const ADDABLE = ['client', 'admin', OWNER_ROLE, ...STAFF_ROLES, 'promoter', 'dj', 'organizer'] as const;
const needsVenue = (r: string) => (STAFF_ROLES as readonly string[]).includes(r) || r === OWNER_ROLE;

type Action =
  | { kind: 'mfa' } | { kind: 'password' } | { kind: 'suspend' } | { kind: 'reactivate' }
  | { kind: 'addRole'; role: string; venueId: string | null } | { kind: 'removeRole'; role: string };

async function audit(action: string, userId: string, reason: string, extra: Record<string, unknown> = {}) {
  await supabase.rpc('admin_log_action', { _action: action, _entity_type: 'profile', _entity_id: userId, _metadata: { reason, ...extra } });
}

export default function PersonAccount({ p, onChanged }: { p: Person; onChanged: () => void }) {
  const { t, lang } = useAdminT();
  const [action, setAction] = useState<Action | null>(null);
  const [role, setRole] = useState('');
  const [venueId, setVenueId] = useState('');
  const acc = p.account;
  const venues = useQuery({
    queryKey: ['adm-person-venues'], enabled: !!acc && needsVenue(role),
    queryFn: async () => { const { data, error } = await supabase.from('venues').select('id, name').order('name'); if (error) throw error; return data ?? []; },
  });

  if (!acc) {
    return <EmptyState title={t("adm.cl.acc.none")} body={t("adm.cl.acc.none.body")} />;
  }
  const uid = acc.profile.id;
  const roleLabel = (r: string) => { const k = `adm.role.${r}.label`; const v = t(k); return v === k ? r : v; };
  const have = acc.roles.map((r) => r.role);
  const options = ADDABLE.filter((r) => !have.includes(r));

  const confirm = async (reason: string) => {
    const a = action; if (!a) return;
    const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
    if (a.kind === 'mfa') {
      fail((await supabase.rpc('admin_reset_user_mfa', { _user_id: uid })).error);
      await audit('user_mfa_reset', uid, reason);
      toast.success(t('adm.cl.acc.done.mfa'));
    } else if (a.kind === 'password') {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'reset-password', userId: uid } });
      fail(error);
      if (data && data.success === false) throw new Error(data.error || t('adm.ui.error.title'));
      await audit('user_password_reset_sent', uid, reason);
      toast.success(t('adm.cl.acc.done.password'));
    } else if (a.kind === 'suspend' || a.kind === 'reactivate') {
      const suspend = a.kind === 'suspend';
      fail((await supabase.rpc('admin_set_user_suspended', { _user_id: uid, _suspended: suspend, _reason: suspend ? reason : null })).error);
      if (!suspend) await audit('user_reactivated', uid, reason);
      toast.success(t(suspend ? 'adm.cl.acc.done.suspend' : 'adm.cl.acc.done.reactivate'));
    } else if (a.kind === 'addRole') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roles = supabase.from('user_roles') as any;
      fail((await roles.insert({ user_id: uid, role: a.role, email: acc.profile.email })).error);
      const rollback = () => roles.delete().eq('user_id', uid).eq('role', a.role);
      if ((STAFF_ROLES as readonly string[]).includes(a.role)) {
        const { error } = await supabase.from('profiles').update({ venue_id: a.venueId }).eq('id', uid);
        if (error) { await rollback(); throw new Error(error.message); }
      }
      if (a.role === OWNER_ROLE) {
        const { error } = await supabase.from('venues').update({ owner_id: uid }).eq('id', a.venueId as string);
        if (error) { await rollback(); throw new Error(error.message); }
      }
      await audit(a.role === 'admin' ? 'role_admin_granted' : 'role_granted', uid, reason, { role: a.role, venue_id: needsVenue(a.role) ? a.venueId : null });
      toast.success(`${t('adm.cl.acc.done.roleAdded')} · ${roleLabel(a.role)}`);
      setRole(''); setVenueId('');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('user_roles') as any).delete().eq('user_id', uid).eq('role', a.role);
      fail(error);
      const staffLeft = have.some((r) => r !== a.role && (STAFF_ROLES as readonly string[]).includes(r));
      if ((STAFF_ROLES as readonly string[]).includes(a.role) && !staffLeft) await supabase.from('profiles').update({ venue_id: null }).eq('id', uid);
      await audit(a.role === 'admin' ? 'role_admin_revoked' : 'role_revoked', uid, reason, { role: a.role });
      toast.success(`${t('adm.cl.acc.done.roleRemoved')} · ${roleLabel(a.role)}`);
    }
    onChanged();
  };

  const titles: Record<Action['kind'], string> = {
    mfa: t('adm.cl.acc.mfa.title'), password: t('adm.cl.acc.password.title'), suspend: t('adm.cl.acc.suspend.title'),
    reactivate: t('adm.cl.acc.reactivate.title'), addRole: t('adm.cl.acc.addRole.title'), removeRole: t('adm.cl.acc.removeRole.title'),
  };
  const descs: Record<Action['kind'], string> = {
    mfa: t('adm.cl.acc.mfa.desc'), password: t('adm.cl.acc.password.desc'), suspend: t('adm.cl.acc.suspend.desc'),
    reactivate: t('adm.cl.acc.reactivate.desc'), addRole: t('adm.cl.acc.addRole.desc'), removeRole: t('adm.cl.acc.removeRole.desc'),
  };
  const canAdd = !!role && (!needsVenue(role) || !!venueId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('adm.cl.acc.security')}>
        <KeyValue items={[
          { label: t('adm.cl.acc.id'), value: uid, mono: true },
          { label: t('adm.cl.acc.created'), value: fmtDate(acc.profile.created_at, lang) },
          { label: t('adm.cl.acc.mfa'), value: <Status tone={acc.profile.mfa_enabled ? 'positive' : 'neutral'}>{t(acc.profile.mfa_enabled ? 'adm.cl.acc.mfa.on' : 'adm.cl.acc.mfa.off')}</Status> },
          { label: t('adm.cl.acc.status'), value: acc.profile.is_suspended
              ? <span><Badge tone="negative">{t('adm.cl.flag.suspended')}</Badge>{acc.profile.suspension_reason && <span className="a-t2 ml-2">{acc.profile.suspension_reason}</span>}</span>
              : <Status tone="positive">{t('adm.cl.acc.active')}</Status> },
        ]} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="a-btn" disabled={!acc.profile.mfa_enabled} onClick={() => setAction({ kind: 'mfa' })}>{t('adm.cl.acc.mfa.btn')}</button>
          <button type="button" className="a-btn" onClick={() => setAction({ kind: 'password' })}>{t('adm.cl.acc.password.btn')}</button>
          {acc.profile.is_suspended
            ? <button type="button" className="a-btn" onClick={() => setAction({ kind: 'reactivate' })}>{t('adm.cl.acc.reactivate.btn')}</button>
            : <button type="button" className="a-btn a-btn--danger" onClick={() => setAction({ kind: 'suspend' })}>{t('adm.cl.acc.suspend.btn')}</button>}
        </div>
        {acc.owned_venues.length > 0 && (
          <p className="a-t2 mt-4 text-[12.5px]">
            {t('adm.cl.acc.owns')}{' '}
            {acc.owned_venues.map((v, i) => <span key={v.id}>{i > 0 && ', '}<Link className="underline" to={`/admin/pros/venue:${encodeURIComponent(v.id)}`}>{v.name}</Link></span>)}
          </p>
        )}
      </Card>

      <Card title={t('adm.cl.acc.roles')}>
        <ul className="flex flex-col">
          {acc.roles.length === 0 && <li className="a-t3 text-[12.5px]">{t('adm.cl.acc.roles.empty')}</li>}
          {acc.roles.map((r) => (
            <li key={r.role} className="flex items-center gap-3 border-b py-2 last:border-b-0">
              <span className="a-t1 min-w-0 flex-1 text-[13px]">{roleLabel(r.role)}<span className="a-t3 ml-2 text-[12px]">{fmtDate(r.created_at, lang)}</span></span>
              <button type="button" className="a-btn a-btn--sm a-btn--ghost" onClick={() => setAction({ kind: 'removeRole', role: r.role })}>{t('adm.cl.acc.roles.remove')}</button>
            </li>
          ))}
        </ul>
        {options.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select className="a-input" style={{ width: 'auto', minWidth: 150 }} aria-label={t('adm.cl.acc.roles.pick')} value={role} onChange={(e) => { setRole(e.target.value); setVenueId(''); }}>
              <option value="">{t('adm.cl.acc.roles.pick')}</option>
              {options.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            {needsVenue(role) && (
              <select className="a-input" style={{ width: 'auto', minWidth: 180 }} aria-label={t('adm.cl.acc.roles.venue')} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">{t('adm.cl.acc.roles.venue')}</option>
                {(venues.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            <button type="button" className="a-btn" disabled={!canAdd} onClick={() => setAction({ kind: 'addRole', role, venueId: needsVenue(role) ? venueId : null })}>{t('adm.cl.p.add')}</button>
          </div>
        )}
      </Card>

      {action && (
        <ReasonDialog open onOpenChange={(v) => { if (!v) setAction(null); }} title={titles[action.kind]}
          description={`${acc.profile.email} · ${descs[action.kind]}${(action.kind === 'addRole' || action.kind === 'removeRole') && action.role === 'admin' ? ` ${t('adm.cl.acc.adminWarn')}` : ''}`}
          tone={action.kind === 'suspend' || action.kind === 'removeRole' ? 'danger' : 'primary'} onConfirm={confirm} />
      )}
    </div>
  );
}
