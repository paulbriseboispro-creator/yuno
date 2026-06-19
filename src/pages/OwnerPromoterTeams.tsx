import { useState, useEffect } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId } from '@/lib/promoterScopeHelpers';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Users, Crown, ChevronDown, ChevronUp, Target } from 'lucide-react';
import {
  PromoHeader, PromoPage, PromoCard, SectionLabel, PromoPill, PromoButton, PromoProgress, PromoEmpty,
  RED, T1, T2, T3, BORDER, F_BORDER, TILE_BG, INNER_BG, C_FAINT,
} from '@/components/promoter/promoter-ui';

interface MemberDetail {
  id: string; label: string; clicks: number; conversions: number;
  revenue: number; commission: number; isLeader: boolean;
}
interface TeamRow {
  id: string; name: string; leaderPromoterId: string | null; leaderName: string | null;
  maxSales: number | null; memberCount: number; members: Array<{ id: string; label: string }>;
  totalRevenue: number; totalConversions: number;
  overrideType: 'fixed' | 'percentage' | null; overrideValue: number;
}
interface PromoterOption { id: string; label: string; teamId: string | null; }

export default function OwnerPromoterTeams() {
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [promoters, setPromoters] = useState<PromoterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [memberDetails, setMemberDetails] = useState<Record<string, MemberDetail[]>>({});
  const [sortBy, setSortBy] = useState<'revenue' | 'conversions' | 'commission'>('revenue');

  const [name, setName] = useState('');
  const [leaderId, setLeaderId] = useState<string>('none');
  const [maxSales, setMaxSales] = useState<string>('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [overrideType, setOverrideType] = useState<'fixed' | 'percentage'>('fixed');
  const [overrideValue, setOverrideValue] = useState<string>('');

  useEffect(() => { if (sid) { fetchTeams(); fetchPromoters(); } }, [sid]);

  async function fetchPromoters() {
    if (!sid) return;
    const { data: promoData } = await supabase.from('promoters')
      .select('id, promo_code, team_id, user_id, first_name, last_name')
      .eq(scopeFilter.column, sid).eq('is_active', true);
    if (!promoData || promoData.length === 0) { setPromoters([]); return; }

    const userIds = promoData.map(p => p.user_id).filter(Boolean);
    let profileMap: Record<string, { first_name: string | null; last_name: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds);
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
    }
    setPromoters(promoData.map(p => {
      const prof = profileMap[p.user_id];
      const displayName = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim()
        : p.first_name ? `${p.first_name} ${p.last_name || ''}`.trim() : p.promo_code;
      return { id: p.id, label: displayName, teamId: p.team_id };
    }));
  }

  async function fetchTeams() {
    if (!sid) return;
    const { data: teamsData } = await supabase.from('promoter_teams')
      .select('*').eq(scopeFilter.column, sid).order('created_at', { ascending: false });
    if (!teamsData) { setLoading(false); return; }

    const teamIds = teamsData.map(t => t.id);
    const { data: membersData } = teamIds.length > 0
      ? await supabase.from('promoters').select('id, team_id, promo_code, first_name, last_name, user_id, pending_amount, total_paid').in('team_id', teamIds)
      : { data: [] };

    const memberUserIds = (membersData || []).map(m => m.user_id).filter(Boolean);
    let memberProfileMap: Record<string, { first_name: string | null; last_name: string | null }> = {};
    if (memberUserIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name').in('id', memberUserIds);
      (profiles || []).forEach(p => { memberProfileMap[p.id] = p; });
    }

    const leaderIds = teamsData.filter(t => t.leader_promoter_id).map(t => t.leader_promoter_id!);
    let leaderMap: Record<string, string> = {};
    if (leaderIds.length > 0) {
      const { data: leaderData } = await supabase.from('promoters').select('id, promo_code, first_name, last_name, user_id').in('id', leaderIds);
      (leaderData || []).forEach((p: any) => {
        const prof = memberProfileMap[p.user_id];
        leaderMap[p.id] = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim()
          : p.first_name ? `${p.first_name} ${p.last_name || ''}`.trim() : p.promo_code;
      });
    }

    const promoterIds = (membersData || []).map(m => m.id);
    let convMap: Record<string, { revenue: number; count: number; commission: number }> = {};
    if (promoterIds.length > 0) {
      const { data: convs } = await supabase.from('promoter_conversions').select('promoter_id, amount, commission').in('promoter_id', promoterIds);
      (convs || []).forEach((c: any) => {
        if (!convMap[c.promoter_id]) convMap[c.promoter_id] = { revenue: 0, count: 0, commission: 0 };
        convMap[c.promoter_id].revenue += Number(c.amount || 0);
        convMap[c.promoter_id].count++;
        convMap[c.promoter_id].commission += Number(c.commission || 0);
      });
    }

    let clickMap: Record<string, number> = {};
    if (promoterIds.length > 0) {
      const { data: clicks } = await supabase.from('promoter_clicks').select('promoter_id').in('promoter_id', promoterIds);
      (clicks || []).forEach(c => { clickMap[c.promoter_id] = (clickMap[c.promoter_id] || 0) + 1; });
    }

    const membersByTeam: Record<string, Array<{ id: string; label: string }>> = {};
    const teamStats: Record<string, { revenue: number; conversions: number }> = {};
    const detailsByTeam: Record<string, MemberDetail[]> = {};

    (membersData || []).forEach((m: any) => {
      if (!membersByTeam[m.team_id]) membersByTeam[m.team_id] = [];
      if (!teamStats[m.team_id]) teamStats[m.team_id] = { revenue: 0, conversions: 0 };
      if (!detailsByTeam[m.team_id]) detailsByTeam[m.team_id] = [];
      const prof = memberProfileMap[m.user_id];
      const label = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim()
        : m.first_name ? `${m.first_name} ${m.last_name || ''}`.trim() : m.promo_code || m.id.slice(0, 6);
      membersByTeam[m.team_id].push({ id: m.id, label });
      const cs = convMap[m.id] || { revenue: 0, count: 0, commission: 0 };
      teamStats[m.team_id].revenue += cs.revenue;
      teamStats[m.team_id].conversions += cs.count;
      const team = teamsData.find(t => t.id === m.team_id);
      detailsByTeam[m.team_id].push({
        id: m.id, label, clicks: clickMap[m.id] || 0, conversions: cs.count,
        revenue: cs.revenue, commission: cs.commission, isLeader: team?.leader_promoter_id === m.id,
      });
    });

    setMemberDetails(detailsByTeam);
    setTeams(teamsData.map(t => ({
      id: t.id, name: t.name, leaderPromoterId: t.leader_promoter_id,
      leaderName: t.leader_promoter_id ? leaderMap[t.leader_promoter_id] || null : null,
      maxSales: t.max_sales, memberCount: membersByTeam[t.id]?.length || 0,
      members: membersByTeam[t.id] || [],
      totalRevenue: teamStats[t.id]?.revenue || 0, totalConversions: teamStats[t.id]?.conversions || 0,
      overrideType: (t as any).override_type ?? null, overrideValue: Number((t as any).override_value || 0),
    })));
    setLoading(false);
  }

  function openCreate() { setEditing(null); setName(''); setLeaderId('none'); setMaxSales(''); setSelectedMembers([]); setOverrideType('fixed'); setOverrideValue(''); setDialogOpen(true); }
  function openEdit(team: TeamRow) {
    setEditing(team); setName(team.name); setLeaderId(team.leaderPromoterId || 'none');
    setMaxSales(team.maxSales?.toString() || ''); setSelectedMembers(team.members.map(m => m.id));
    setOverrideType(team.overrideType || 'fixed'); setOverrideValue(team.overrideValue > 0 ? String(team.overrideValue) : '');
    setDialogOpen(true);
  }
  function toggleMember(promoterId: string) {
    setSelectedMembers(prev => prev.includes(promoterId) ? prev.filter(id => id !== promoterId) : [...prev, promoterId]);
  }

  async function handleSave() {
    if (!sid || !name.trim()) return;
    setSaving(true);
    const ovVal = overrideValue ? parseFloat(overrideValue) : 0;
    const payload = {
      ...scopeFilter.payload, name: name.trim(),
      leader_promoter_id: leaderId === 'none' ? null : leaderId,
      max_sales: maxSales ? parseInt(maxSales) : null,
      override_type: ovVal > 0 ? overrideType : null,
      override_value: ovVal,
    };
    try {
      let teamId: string;
      if (editing) {
        const { error } = await supabase.from('promoter_teams').update(payload).eq('id', editing.id);
        if (error) throw error; teamId = editing.id;
      } else {
        const { data, error } = await supabase.from('promoter_teams').insert(payload).select('id').single();
        if (error) throw error; teamId = data.id;
      }
      await supabase.from('promoters').update({ team_id: null }).eq('team_id', teamId);
      if (selectedMembers.length > 0) {
        for (const memberId of selectedMembers) {
          await supabase.from('promoters').update({ team_id: teamId }).eq('id', memberId);
        }
      }
      toast.success(t('promoterTeams.saved'));
      setDialogOpen(false); fetchTeams(); fetchPromoters();
    } catch { toast.error(t('promoterTeams.saveError')); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    await supabase.from('promoters').update({ team_id: null }).eq('team_id', deleteId);
    await supabase.from('promoter_teams').delete().eq('id', deleteId);
    toast.success(t('promoterTeams.deleted'));
    setDeleteId(null); fetchTeams();
  }

  const availablePromoters = promoters.filter(p => !p.teamId || p.teamId === editing?.id || selectedMembers.includes(p.id));
  const getSortedMembers = (teamId: string) => [...(memberDetails[teamId] || [])].sort((a, b) => b[sortBy] - a[sortBy]);

  if (loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={t('promoterTeams.title')}
        subtitle={tt('Agences & équipes de promoteurs', 'Agencies & promoter teams')}
        backTo={`${basePath}/promoters`}
        right={<PromoButton size="sm" onClick={openCreate}><Plus className="h-4 w-4" />{t('promoterTeams.create')}</PromoButton>}
      />

      <PromoPage maxWidth={720}>
        {teams.length === 0 ? (
          <PromoEmpty
            icon={Users}
            title={t('promoterTeams.empty')}
            description={tt('Regroupez vos promoteurs en équipes avec un chef, un objectif commun et un classement interne.', 'Group your promoters into teams with a leader, a shared goal and an internal ranking.')}
            action={<PromoButton onClick={openCreate}><Plus className="h-4 w-4" />{t('promoterTeams.create')}</PromoButton>}
          />
        ) : (
          <div className="space-y-2.5">
            {teams.map(team => {
              const isExpanded = expandedTeam === team.id;
              const goalProgress = team.maxSales ? Math.min(100, (team.totalConversions / team.maxSales) * 100) : null;
              return (
                <PromoCard key={team.id}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpandedTeam(isExpanded ? null : team.id)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 style={{ color: T1, fontSize: 15, fontWeight: 640, margin: 0 }}>{team.name}</h3>
                        <PromoPill tone="muted"><span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{team.memberCount}</span></PromoPill>
                      </div>
                      {team.leaderName && (
                        <p className="flex items-center gap-1" style={{ color: T3, fontSize: 11.5, margin: 0, marginTop: 3 }}>
                          <Crown className="h-3 w-3" style={{ color: RED }} /> {team.leaderName}
                          {team.overrideValue > 0 && (
                            <span style={{ color: RED, marginLeft: 4 }}>
                              · {tt(`+${team.overrideValue}${team.overrideType === 'percentage' ? '%' : '€'}/vente`, `+${team.overrideValue}${team.overrideType === 'percentage' ? '%' : '€'}/sale`, `+${team.overrideValue}${team.overrideType === 'percentage' ? '%' : '€'}/venta`)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0 items-center">
                      {[
                        { icon: isExpanded ? ChevronUp : ChevronDown, onClick: () => setExpandedTeam(isExpanded ? null : team.id), danger: false },
                        { icon: Pencil, onClick: () => openEdit(team), danger: false },
                        { icon: Trash2, onClick: () => setDeleteId(team.id), danger: true },
                      ].map(({ icon: Icon, onClick, danger }, i) => (
                        <button key={i} onClick={onClick} style={{ width: 30, height: 30, borderRadius: 8, background: danger ? 'rgba(255,92,99,0.08)' : INNER_BG, border: `1px solid ${danger ? 'rgba(255,92,99,0.2)' : BORDER}`, color: danger ? '#FF5C63' : T2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Team KPIs */}
                  <div className="grid grid-cols-3 gap-2" style={{ marginTop: 12 }}>
                    {[
                      { v: team.totalConversions, l: tt('Ventes', 'Sales') },
                      { v: `${team.totalRevenue.toFixed(0)}€`, l: tt('CA', 'Revenue') },
                      { v: team.memberCount > 0 ? (team.totalConversions / team.memberCount).toFixed(1) : 0, l: tt('Moy/membre', 'Avg/member') },
                    ].map((s, i) => (
                      <div key={i} style={{ background: TILE_BG, borderRadius: 9, padding: '9px 8px', textAlign: 'center' }}>
                        <p style={{ color: T1, fontSize: 15, fontWeight: 700, margin: 0 }}>{s.v}</p>
                        <p style={{ color: T3, fontSize: 10, margin: 0 }}>{s.l}</p>
                      </div>
                    ))}
                  </div>

                  {goalProgress !== null && team.maxSales && (
                    <div style={{ marginTop: 12 }}>
                      <div className="flex justify-between" style={{ fontSize: 11, marginBottom: 5 }}>
                        <span className="flex items-center gap-1" style={{ color: T2 }}><Target className="h-3 w-3" /> {tt('Objectif équipe', 'Team goal')}</span>
                        <span style={{ color: T2, fontWeight: 600 }}>{team.totalConversions}/{team.maxSales}</span>
                      </div>
                      <PromoProgress value={goalProgress} tone={goalProgress >= 100 ? 'pos' : 'red'} height={6} />
                    </div>
                  )}

                  {/* Expanded member performance */}
                  {isExpanded && (
                    <div style={{ marginTop: 14, borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                        <h4 style={{ color: T1, fontSize: 13, fontWeight: 620, margin: 0 }}>{tt('Classement interne', 'Internal ranking')}</h4>
                        <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
                          <SelectTrigger className="h-7 text-xs w-28" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="revenue">{tt('CA', 'Revenue')}</SelectItem>
                            <SelectItem value="conversions">{tt('Ventes', 'Sales')}</SelectItem>
                            <SelectItem value="commission">Commission</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        {getSortedMembers(team.id).map((member, idx) => (
                          <div key={member.id} className="transition-colors"
                            style={{ padding: 11, background: TILE_BG, borderRadius: 10, cursor: 'pointer' }}
                            onClick={() => navigate(`${basePath}/promoters/${member.id}`)}
                            onMouseEnter={(e) => (e.currentTarget.style.background = C_FAINT)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = TILE_BG)}>
                            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                              <span style={{ color: idx === 0 ? RED : T3, fontSize: 12, fontWeight: 760, width: 18, textAlign: 'center' }}>{idx + 1}</span>
                              <span style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{member.label}</span>
                              {member.isLeader && <PromoPill tone="red"><span className="inline-flex items-center gap-0.5"><Crown className="h-2.5 w-2.5" />{tt('Chef', 'Lead')}</span></PromoPill>}
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-center">
                              {[
                                { v: member.clicks, l: tt('Clics', 'Clicks') }, { v: member.conversions, l: tt('Ventes', 'Sales') },
                                { v: `${member.revenue.toFixed(0)}€`, l: tt('CA', 'Rev.') },
                              ].map((s, i) => (
                                <div key={i}><p style={{ color: T1, fontSize: 12, fontWeight: 700, margin: 0 }}>{s.v}</p><p style={{ color: T3, fontSize: 9, margin: 0 }}>{s.l}</p></div>
                              ))}
                              <div><p style={{ color: RED, fontSize: 12, fontWeight: 700, margin: 0 }}>{member.commission.toFixed(0)}€</p><p style={{ color: T3, fontSize: 9, margin: 0 }}>Comm.</p></div>
                            </div>
                          </div>
                        ))}
                        {(memberDetails[team.id] || []).length === 0 && (
                          <p style={{ color: T3, fontSize: 12, textAlign: 'center', padding: '12px 0' }}>{tt('Aucun membre dans cette équipe', 'No members in this team')}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Collapsed member chips */}
                  {!isExpanded && team.members && team.members.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" style={{ marginTop: 12 }}>
                      {team.members.map(m => (
                        <span key={m.id} className="inline-flex items-center gap-1" style={{ padding: '3px 9px', borderRadius: 7, fontSize: 11, color: T2, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                          {m.id === team.leaderPromoterId && <Crown className="h-2.5 w-2.5" style={{ color: RED }} />}
                          {m.label}
                        </span>
                      ))}
                    </div>
                  )}
                </PromoCard>
              );
            })}
          </div>
        )}
      </PromoPage>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? t('promoterTeams.edit') : t('promoterTeams.create')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('promoterTeams.name')}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('owner.promoB.teamNamePlaceholder')} />
            </div>
            <div>
              <Label>{t('promoterTeams.leader')}</Label>
              <Select value={leaderId} onValueChange={setLeaderId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('promoterTeams.noLeader')}</SelectItem>
                  {promoters.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('promoterTeams.maxSales')}</Label>
              <Input type="number" min={0} value={maxSales} onChange={e => setMaxSales(e.target.value)} placeholder={tt('Illimité', 'Unlimited')} />
              <p className="text-xs text-muted-foreground mt-1">{t('promoterTeams.maxSalesHint')}</p>
            </div>
            <div>
              <Label className="flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-primary" />{tt("Override chef d'équipe", 'Team leader override')}</Label>
              <p className="text-xs text-muted-foreground mb-2">{tt("Part de la commission de chaque membre reversée au chef à chaque vente ou scan.", "Share of each member's commission paid to the leader on every sale or scan.")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Select value={overrideType} onValueChange={v => setOverrideType(v as 'fixed' | 'percentage')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">€ {tt('par vente', 'per sale')}</SelectItem>
                    <SelectItem value="percentage">% {tt('de la commission', 'of commission')}</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min={0} value={overrideValue} onChange={e => setOverrideValue(e.target.value)} placeholder="0" />
              </div>
              {leaderId === 'none' && !!overrideValue && (
                <p className="text-xs text-amber-500 mt-1">{tt("Choisissez un chef pour activer l'override.", 'Set a leader to enable the override.')}</p>
              )}
            </div>
            <div>
              <Label className="mb-2 block">{t('promoterTeams.members')}</Label>
              <div className="border border-border rounded-lg max-h-48 overflow-y-auto">
                {availablePromoters.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">{t('owner.promoB.noPromoterAvailable')}</p>
                ) : (
                  availablePromoters.map(p => (
                    <label key={p.id} className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer border-b border-border last:border-0">
                      <Checkbox checked={selectedMembers.includes(p.id)} onCheckedChange={() => toggleMember(p.id)} />
                      <span className="text-sm">{p.label}</span>
                      {p.id === leaderId && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary"><Crown className="h-2.5 w-2.5" />{tt('Chef', 'Lead')}</span>}
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('owner.promoB.selectedCount').replace('{n}', String(selectedMembers.length))}</p>
            </div>
          </div>
          <DialogFooter>
            <PromoButton variant="secondary" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</PromoButton>
            <PromoButton onClick={handleSave} disabled={saving || !name.trim()}>{saving ? '...' : t('common.save')}</PromoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('promoterTeams.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('promoterTeams.deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
