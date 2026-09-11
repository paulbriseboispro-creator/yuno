import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import { toast } from 'sonner';
import { Building2, Copy, ExternalLink, FileSignature, Handshake, HeartHandshake, Mail, Plus, Power, Send, Trash2 } from 'lucide-react';
import { AdminPage, Card, Stat, Btn, Pill, Modal, Field, TableWrap, Th, Td, EmptyState, Spinner, INPUT_STYLE, T1, T3, F_BORDER } from '@/components/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';

interface Agency { id: string; owner_user_id: string; name: string; slug: string | null; city: string | null; is_active: boolean; created_at: string; contact_email: string | null; ownerEmail: string | null; promoters: number; contracts: number; externalVenues: number; externalEvents: number; clicks: number; gross: number; armSlug: string | null; hasArm: boolean }
interface Invite { id: string; email: string; organization_name: string | null; status: string; created_at: string; expires_at: string; token: string }

export default function AdminAgencies() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', city: '', type: 'agency', commission_rate: '10' });

  const load = useCallback(async () => {
    setLoading(true);
    const [ag, inv, demo] = await Promise.all([
      supabase.from('agencies').select('id, owner_user_id, name, slug, city, is_active, created_at, contact_email').order('created_at', { ascending: false }),
      supabase.from('platform_invitations').select('id, email, organization_name, status, created_at, expires_at, token').eq('profile_type', 'affiliate').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.rpc('demo_venue_ids' as never),
    ]);
    if (ag.error) { toast.error(ag.error.message); setLoading(false); return; }
    if (inv.error) toast.error(inv.error.message);
    void demo;
    setInvites((inv.data ?? []) as Invite[]);
    const rows = (ag.data ?? []) as Omit<Agency, 'ownerEmail' | 'promoters' | 'contracts' | 'externalVenues' | 'externalEvents' | 'clicks' | 'gross' | 'armSlug' | 'hasArm'>[];
    const ids = rows.map((a) => a.id);
    const ownerIds = rows.map((a) => a.owner_user_id);
    const [profiles, arms, promoters, contracts, conversions] = await Promise.all([
      ownerIds.length ? supabase.from('profiles').select('id, email').in('id', ownerIds) : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
      ids.length ? supabase.from('affiliates').select('id, agency_id, linktree_slug').in('agency_id', ids) : Promise.resolve({ data: [] as { id: string; agency_id: string | null; linktree_slug: string | null }[] }),
      ids.length ? supabase.from('promoters').select('agency_id').in('agency_id', ids) : Promise.resolve({ data: [] as { agency_id: string | null }[] }),
      ids.length ? supabase.from('agency_venue_contracts').select('agency_id, status').in('agency_id', ids) : Promise.resolve({ data: [] as { agency_id: string; status: string }[] }),
      ids.length ? supabase.from('agency_conversions').select('agency_id, gross_amount').in('agency_id', ids) : Promise.resolve({ data: [] as { agency_id: string; gross_amount: number | null }[] }),
    ]);
    const armIds = (arms.data ?? []).map((a) => a.id);
    const [extVenues, extEvents, clicks] = await Promise.all([
      armIds.length ? supabase.from('affiliate_venues').select('affiliate_id').in('affiliate_id', armIds) : Promise.resolve({ data: [] as { affiliate_id: string }[] }),
      armIds.length ? supabase.from('affiliate_events').select('affiliate_id').in('affiliate_id', armIds) : Promise.resolve({ data: [] as { affiliate_id: string }[] }),
      armIds.length ? supabase.from('affiliate_clicks').select('affiliate_id').in('affiliate_id', armIds) : Promise.resolve({ data: [] as { affiliate_id: string }[] }),
    ]);
    const cnt = (arr: { [k: string]: unknown }[] | null | undefined, key: string) => { const m: Record<string, number> = {}; for (const r of arr ?? []) { const k = String(r[key]); m[k] = (m[k] || 0) + 1; } return m; };
    const emailMap = Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.email]));
    const armByAgency: Record<string, { id: string; linktree_slug: string | null }> = {};
    for (const a of arms.data ?? []) if (a.agency_id) armByAgency[a.agency_id] = { id: a.id, linktree_slug: a.linktree_slug };
    const promC = cnt(promoters.data, 'agency_id'), contrC = cnt((contracts.data ?? []).filter((c) => c.status === 'active' || c.status === 'signed'), 'agency_id');
    const evC = cnt(extEvents.data, 'affiliate_id'), evV = cnt(extVenues.data, 'affiliate_id'), clC = cnt(clicks.data, 'affiliate_id');
    const gross: Record<string, number> = {}; for (const c of conversions.data ?? []) gross[c.agency_id] = (gross[c.agency_id] || 0) + Number(c.gross_amount || 0);
    setAgencies(rows.map((a) => {
      const arm = armByAgency[a.id];
      return { ...a, ownerEmail: emailMap[a.owner_user_id] ?? null, promoters: promC[a.id] || 0, contracts: contrC[a.id] || 0, externalVenues: arm ? evV[arm.id] || 0 : 0, externalEvents: arm ? evC[arm.id] || 0 : 0, clicks: arm ? clC[arm.id] || 0 : 0, gross: gross[a.id] || 0, armSlug: arm?.linktree_slug ?? null, hasArm: !!arm };
    }));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load, includeDemo]);

  const invokeInvite = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('invite-affiliate', { body });
    if (error) {
      let msg = error.message;
      try { const b = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps non JSON */ }
      throw new Error(msg);
    }
    return data as { user_exists?: boolean; email_sent?: boolean; invite_link?: string };
  };
  const handleInvite = async () => {
    if (!form.email || !form.name) { toast.error(t('adm.ag.missing')); return; }
    setBusy('invite');
    try {
      const d = await invokeInvite({ email: form.email, name: form.name, city: form.city || null, type: form.type, commission_rate: parseFloat(form.commission_rate) || 0 });
      if (d?.user_exists) toast.success(t('adm.ag.activated').replace('{name}', form.name));
      else if (d?.email_sent === false && d?.invite_link) toast.warning(t('adm.ag.sentNoEmail').replace('{link}', d.invite_link));
      else toast.success(t('adm.ag.sent').replace('{email}', form.email));
      setInviteOpen(false); setForm({ email: '', name: '', city: '', type: 'agency', commission_rate: '10' }); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const resend = async (inv: Invite) => {
    if (!inv.organization_name) return;
    setBusy(inv.id);
    try { const d = await invokeInvite({ email: inv.email, name: inv.organization_name }); if (d?.email_sent === false && d?.invite_link) toast.warning(t('adm.ag.sentNoEmail').replace('{link}', d.invite_link)); else toast.success(t('adm.ag.resent').replace('{email}', inv.email)); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const revoke = async (id: string) => {
    const { error } = await supabase.from('platform_invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) toast.error(error.message); else { toast.success(t('adm.ag.revoked')); load(); }
  };
  const copyLink = async (token: string) => { try { await navigator.clipboard.writeText(`${window.location.origin}/auth?invite_affiliate=${token}`); toast.success(t('adm.common.copied')); } catch { toast.error(t('adm.common.copyFailed')); } };
  const toggleActive = async (a: Agency) => {
    if (a.is_active && !window.confirm(t('adm.ag.confirmDeactivate'))) return;
    setBusy(a.id);
    const { error } = await supabase.from('agencies').update({ is_active: !a.is_active }).eq('id', a.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adm.ag.toggled')); load();
  };

  const totals = { n: agencies.length, active: agencies.filter((a) => a.is_active).length, promoters: agencies.reduce((s, a) => s + a.promoters, 0), contracts: agencies.reduce((s, a) => s + a.contracts, 0), ext: agencies.reduce((s, a) => s + a.externalVenues, 0) };

  return (
    <AdminPage eyebrow={t('adm.ag.eyebrow')} title={t('adm.ag.title')} subtitle={t('adm.ag.subtitle')} actions={<Btn variant="primary" icon={Plus} onClick={() => setInviteOpen(true)}>{t('adm.ag.invite')}</Btn>}>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat compact label={t('adm.ag.agencies')} value={fmtNum(totals.n, language)} icon={Handshake} highlight sub={`${fmtNum(totals.active, language)} ${t('adm.ag.active').toLowerCase()}`} />
        <Stat compact label={t('adm.ag.promoters')} value={fmtNum(totals.promoters, language)} icon={HeartHandshake} />
        <Stat compact label={t('adm.ag.contracts')} value={fmtNum(totals.contracts, language)} icon={FileSignature} />
        <Stat compact label={t('adm.ag.externalVenues')} value={fmtNum(totals.ext, language)} icon={Building2} />
        <Stat compact label={t('adm.ag.pending')} value={fmtNum(invites.length, language)} icon={Mail} tone={invites.length > 0 ? 'warn' : undefined} />
      </div>

      {invites.length > 0 && (
        <Card title={t('adm.ag.pending')} icon={Mail} accent>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 py-2.5 flex-wrap" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
              <div className="min-w-0 flex-1"><div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{inv.organization_name ?? '—'}</div><div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{inv.email} · {t('adm.ag.expires').replace('{d}', fmtDate(inv.expires_at, language))}</div></div>
              <div className="flex gap-1"><Btn size="sm" variant="subtle" icon={Copy} onClick={() => copyLink(inv.token)} title={t('adm.ag.copyLink')} /><Btn size="sm" variant="subtle" icon={Send} loading={busy === inv.id} onClick={() => resend(inv)} title={t('adm.ag.resend')} /><Btn size="sm" variant="danger" icon={Trash2} onClick={() => revoke(inv.id)} title={t('adm.ag.revoke')} /></div>
            </div>
          ))}
        </Card>
      )}

      <Card title={t('adm.ag.list')} icon={Handshake} flush>
        {loading ? <Spinner /> : agencies.length === 0 ? <EmptyState icon={Handshake} text={t('adm.ag.noAgency')} /> : (
          <TableWrap minWidth={980}>
            <thead><tr><Th>{t('adm.ag.col.agency')}</Th><Th>{t('adm.ag.col.owner')}</Th><Th right>{t('adm.ag.col.promoters')}</Th><Th right>{t('adm.ag.col.contracts')}</Th><Th right>{t('adm.ag.col.external')}</Th><Th right>{t('adm.ag.col.events')}</Th><Th right>{t('adm.ag.col.clicks')}</Th><Th right>{t('adm.ag.col.gross')}</Th><Th>{t('adm.ag.col.status')}</Th><Th right>{t('adm.common.actions')}</Th></tr></thead>
            <tbody>{agencies.map((a) => (
              <tr key={a.id}>
                <Td strong>
                  <div className="flex items-center gap-2"><span>{a.name}</span>{a.slug && <a href={`/agency/${a.slug}`} target="_blank" rel="noopener noreferrer" title={t('adm.common.seePage')}><ExternalLink className="h-3 w-3" style={{ color: T3 }} /></a>}{!a.hasArm && <Pill size="xs" tone="accent">{t('adm.ag.noArm')}</Pill>}</div>
                  <div style={{ color: T3, fontSize: 11, fontWeight: 400 }}>{a.city ?? ''}{a.armSlug ? ` · ${t('adm.ag.linktree')} /p/${a.armSlug}` : ''}</div>
                </Td>
                <Td muted><Link to={`/admin/people/${a.owner_user_id}`} className="hover:underline">{a.ownerEmail ?? a.contact_email ?? '—'}</Link></Td>
                <Td right>{fmtNum(a.promoters, language)}</Td>
                <Td right>{fmtNum(a.contracts, language)}</Td>
                <Td right>{fmtNum(a.externalVenues, language)}</Td>
                <Td right>{fmtNum(a.externalEvents, language)}</Td>
                <Td right>{fmtNum(a.clicks, language)}</Td>
                <Td right strong>{fmtEur(a.gross, language)}</Td>
                <Td><Pill size="xs" tone={a.is_active ? 'pos' : 'neg'}>{a.is_active ? t('adm.common.active') : t('adm.common.inactive')}</Pill></Td>
                <Td right><Btn size="sm" variant={a.is_active ? 'danger' : 'ghost'} icon={Power} loading={busy === a.id} onClick={() => toggleActive(a)}>{a.is_active ? t('adm.ag.deactivate') : t('adm.ag.activate')}</Btn></Td>
              </tr>
            ))}</tbody>
          </TableWrap>
        )}
      </Card>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title={t('adm.ag.inviteTitle')} subtitle={t('adm.ag.inviteHint')}
        footer={<><Btn onClick={() => setInviteOpen(false)}>{t('adm.common.cancel')}</Btn><Btn variant="primary" icon={Send} loading={busy === 'invite'} onClick={handleInvite} disabled={!form.email || !form.name}>{t('adm.ag.send')}</Btn></>}>
        <Field label={t('adm.common.email')}><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={INPUT_STYLE} /></Field>
        <Field label={t('adm.ag.name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('adm.ag.namePh')} style={INPUT_STYLE} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('adm.common.city')}><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={INPUT_STYLE} /></Field>
          <Field label={t('adm.ag.type')}><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={INPUT_STYLE}><option value="agency">{t('adm.ag.type.agency')}</option><option value="independent">{t('adm.ag.type.independent')}</option></select></Field>
          <Field label={t('adm.ag.commission')}><input type="number" min={0} max={100} step={0.5} value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} style={INPUT_STYLE} /></Field>
        </div>
      </Modal>
    </AdminPage>
  );
}
