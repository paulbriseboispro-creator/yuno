import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Users, Trash2, Settings2, Beer, ShieldAlert, Shirt, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgPill, OrgButton, OrgEmptyState,
  FieldLabel, DarkInput, DarkSelect,
  T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';
import { useTabParam } from '@/hooks/useTabParam';
import { capturePosthog } from '@/lib/posthog';
import { DRINKS_PILLAR_LIVE } from '@/lib/drinksPillar';
import { useCrmLimitToast } from '@/hooks/useCrmLimitToast';

type TeamRole = 'admin' | 'editor' | 'scanner';
type StaffRole = 'barman' | 'bouncer' | 'cloakroom';

interface Member {
  id: string; member_email: string; member_user_id: string | null; role: TeamRole;
  invitation_status: 'pending' | 'accepted' | 'revoked'; created_at: string;
  can_view_finance: boolean; can_refund: boolean; can_export: boolean; can_manage_team: boolean;
  scanner_pin_hash: string | null; scanner_pin_set_at: string | null;
}

interface Staff {
  id: string; email: string; display_name: string | null; role: StaffRole;
  invitation_status: 'pending' | 'accepted' | 'revoked'; pin_hash: string | null;
  pin_set_at: string | null; created_at: string; user_id: string | null;
}

export default function OrgAppTeam() {
  // Scope organisation. L'onglet Équipe reste au fondateur : `org_members`
  // n'accepte d'écriture que de `organizer_user_id = auth.uid()`, un membre
  // admin n'y peut rien — lui montrer le bouton « Inviter » serait lui
  // promettre un refus serveur. Le staff opérationnel, lui, accepte un admin
  // d'équipe (`invite-staff` vérifie `is_org_team_member(…, 'admin')`).
  const { organizerId, can, isOwner } = useActingOrganizer();

  // Prix du vestiaire (soirées sans club) — lu dans organizer_profiles, écrit
  // par la RPC set_organizer_cloakroom_price (fondateur seulement).
  const [cloakPrice, setCloakPrice] = useState('');
  const [savingCloakPrice, setSavingCloakPrice] = useState(false);
  useEffect(() => {
    if (!organizerId) return;
    (supabase as unknown as SupabaseClient)
      .from('organizer_profiles')
      .select('cloakroom_price')
      .eq('user_id', organizerId)
      .maybeSingle()
      .then(({ data }) => {
        const v = (data as { cloakroom_price: number | null } | null)?.cloakroom_price;
        setCloakPrice(v != null ? String(v) : '');
      });
  }, [organizerId]);
  const saveCloakPrice = async () => {
    const value = Number(cloakPrice.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error(t('Prix invalide', 'Invalid price'));
      return;
    }
    setSavingCloakPrice(true);
    const { data, error } = await (supabase as unknown as SupabaseClient).rpc('set_organizer_cloakroom_price', { p_price: value });
    setSavingCloakPrice(false);
    if (error || !data) toast.error(t("Enregistrement impossible", 'Could not save'));
    else toast.success(t('Prix du vestiaire enregistré', 'Cloakroom price saved'));
  };
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const limitToast = useCrmLimitToast();

  const [tab, setTab] = useTabParam<'team' | 'staff'>(isOwner ? 'team' : 'staff', ['team', 'staff']);

  // -------- TEAM (admin/editor/scanner) --------
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [teamOpen, setTeamOpen] = useState(false);
  const [submittingTeam, setSubmittingTeam] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<TeamRole>('editor');
  const [permsTarget, setPermsTarget] = useState<Member | null>(null);

  // -------- STAFF (barman/bouncer/cloakroom) --------
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pendingStaffInvites, setPendingStaffInvites] = useState<{ id: string; email: string; role: StaffRole; created_at: string }[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffOpen, setStaffOpen] = useState(false);
  const [submittingStaff, setSubmittingStaff] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  // Pilier boissons en pause : le barman n'est plus proposé (voir src/lib/drinksPillar.ts).
  const [staffRole, setStaffRole] = useState<StaffRole>(DRINKS_PILLAR_LIVE ? 'barman' : 'bouncer');
  // Langue de l'e-mail d'invitation : celle de la Console par défaut, mais un
  // videur de Ségovie se recrute depuis une Console en français.
  const [staffLang, setStaffLang] = useState<'fr' | 'en' | 'es'>(language === 'en' || language === 'es' ? language : 'fr');

  const loadMembers = async () => {
    if (!organizerId) return;
    setLoadingMembers(true);
    const { data } = await supabase
      .from('org_members').select('*')
      .eq('organizer_user_id', organizerId)
      .order('created_at', { ascending: false });
    setMembers((data ?? []) as Member[]);
    setLoadingMembers(false);
  };

  const loadStaff = async () => {
    if (!organizerId) return;
    setLoadingStaff(true);
    const { data } = await supabase
      .from('org_staff').select('*')
      .eq('organizer_user_id', organizerId)
      .order('created_at', { ascending: false });
    const staffRows = (data ?? []) as Staff[];
    setStaff(staffRows);

    // Pending email invitations (not accepted yet — not in org_staff).
    const { data: invs } = await supabase
      .from('staff_invitations')
      .select('id, email, role, created_at')
      .eq('organizer_user_id', organizerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setPendingStaffInvites((invs ?? []) as { id: string; email: string; role: StaffRole; created_at: string }[]);

    setLoadingStaff(false);
  };

  useEffect(() => { loadMembers(); loadStaff(); }, [organizerId]);

  // -------- TEAM ACTIONS --------
  const inviteMember = async () => {
    setSubmittingTeam(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-org-member', {
        body: { email: memberEmail, role: memberRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      capturePosthog('team_member_invited', { scope: 'organizer', role: memberRole, kind: 'team', organizer_user_id: organizerId });
      toast.success(t('Invitation envoyée', 'Invitation sent'));
      setMemberEmail(''); setMemberRole('editor'); setTeamOpen(false); loadMembers();
    } catch (e) { if (!limitToast(e)) toast.error((e as Error).message ?? 'Erreur'); }
    finally { setSubmittingTeam(false); }
  };

  const removeMember = async (id: string) => {
    if (!confirm(t('Retirer ce membre ?', 'Remove this member?'))) return;
    const { error } = await supabase.from('org_members').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(t('Membre retiré', 'Member removed')); loadMembers(); }
  };

  const updatePermission = async (m: Member, field: keyof Member, value: boolean) => {
    const { error } = await supabase.from('org_members').update({ [field]: value } as TablesUpdate<'org_members'>).eq('id', m.id);
    if (error) toast.error(error.message);
    else { toast.success(t('Mis à jour', 'Updated')); loadMembers(); }
  };

  // -------- STAFF ACTIONS --------
  const inviteStaff = async () => {
    if (!staffEmail || !staffName) {
      toast.error(t('Nom et email requis', 'Name and email required'));
      return;
    }
    if (!organizerId) return;
    setSubmittingStaff(true);
    try {
      const { data, error } = await invokeEdgeFunction('invite-staff', {
        body: { email: staffEmail, display_name: staffName, role: staffRole, organizer_user_id: organizerId, language: staffLang },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      capturePosthog('team_member_invited', { scope: 'organizer', role: staffRole, kind: 'staff', organizer_user_id: organizerId });
      toast.success(t('Invitation envoyée', 'Invitation sent'));
      setStaffEmail(''); setStaffName(''); setStaffRole(DRINKS_PILLAR_LIVE ? 'barman' : 'bouncer'); setStaffOpen(false);
      loadStaff();
    } catch (e) { toast.error((e as Error).message ?? 'Erreur'); }
    finally { setSubmittingStaff(false); }
  };

  const removeStaff = async (id: string) => {
    if (!confirm(t('Retirer ce staff ? Son accès sera révoqué immédiatement.', 'Remove this staff? Access will be revoked immediately.'))) return;
    const { error } = await supabase.from('org_staff').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(t('Staff retiré', 'Staff removed')); loadStaff(); }
  };

  const resendStaffInvite = async (email: string, role: StaffRole) => {
    if (!organizerId) return;
    try {
      const { data, error } = await invokeEdgeFunction('invite-staff', {
        body: { email, role, organizer_user_id: organizerId, resend: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(t('Invitation renvoyée', 'Invitation resent'));
    } catch (e) { toast.error((e as Error).message ?? 'Erreur'); }
  };

  const cancelStaffInvite = async (id: string) => {
    const { error } = await supabase.from('staff_invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(t('Invitation annulée', 'Invitation cancelled')); loadStaff(); }
  };

  // -------- HELPERS --------
  const teamRoleLabel = (r: TeamRole) =>
    r === 'admin' ? 'Admin' : r === 'editor' ? t('Éditeur', 'Editor') : t('Scanner Billets', 'Ticket Scanner');
  const teamRoleTone = (r: TeamRole): 'default' | 'info' | 'success' =>
    r === 'admin' ? 'default' : r === 'editor' ? 'info' : 'success';

  const staffRoleLabel = (r: StaffRole) =>
    r === 'barman' ? t('Barman', 'Barman') : r === 'bouncer' ? t('Videur', 'Bouncer') : t('Vestiaire', 'Cloakroom');
  const staffRoleIcon = (r: StaffRole) =>
    r === 'barman' ? <Beer className="h-4 w-4" /> : r === 'bouncer' ? <ShieldAlert className="h-4 w-4" /> : <Shirt className="h-4 w-4" />;
  const staffRoleTone = (r: StaffRole): 'warn' | 'danger' | 'info' =>
    r === 'barman' ? 'warn' : r === 'bouncer' ? 'danger' : 'info';

  const dialogStyle = { background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 18 } as const;

  return (
    <OrgPage>
      <OrgPageHeader
        title={t('Équipe & Staff', 'Team & Staff')}
        subtitle={t('Gérez vos collaborateurs administratifs et votre staff opérationnel sur place.', 'Manage your administrative team and on-site operational staff.')}
      />

      {/* Segmented tabs */}
      <div className="mb-5 inline-flex items-center gap-1 rounded-xl p-0.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        {(isOwner ? (['team', 'staff'] as const) : (['staff'] as const)).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="rounded-lg px-4 py-1.5 text-[12.5px] font-semibold transition-all duration-150"
            style={tab === key ? { background: 'rgb(var(--ink)/0.1)', color: T1 } : { background: 'transparent', color: T3 }}
          >
            {key === 'team' ? t('Équipe', 'Team') : t('Staff Opérationnel', 'Operational Staff')}
          </button>
        ))}
      </div>

      {/* ---------- TEAM TAB ---------- */}
      {tab === 'team' && isOwner && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p style={{ color: T3, fontSize: 12.5 }}>{t('Admins, éditeurs et scanners de billets.', 'Admins, editors and ticket scanners.')}</p>
            <OrgButton variant="primary" onClick={() => setTeamOpen(true)}>
              <Plus className="h-4 w-4" />{t('Inviter', 'Invite')}
            </OrgButton>
          </div>

          {loadingMembers ? (
            <Loading />
          ) : members.length === 0 ? (
            <OrgEmptyState icon={Users} title={t('Aucun membre pour le moment.', 'No team members yet.')} />
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <OrgCard key={m.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{m.member_email}</div>
                      <div className="mt-0.5 flex items-center gap-2" style={{ color: T3, fontSize: 11.5 }}>
                        <span>{m.invitation_status === 'accepted' ? t('Actif', 'Active') : t('Invitation en attente', 'Pending')}</span>
                      </div>
                    </div>
                    <OrgPill tone={teamRoleTone(m.role)}>{teamRoleLabel(m.role)}</OrgPill>
                    {(m.role === 'editor' || m.role === 'admin') && (
                      <OrgButton size="sm" variant="secondary" onClick={() => setPermsTarget(m)}>
                        <Settings2 className="h-3.5 w-3.5" />{t('Permissions', 'Permissions')}
                      </OrgButton>
                    )}
                    <OrgButton size="sm" variant="danger" onClick={() => removeMember(m.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </OrgButton>
                  </div>
                </OrgCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- STAFF TAB ---------- */}
      {tab === 'staff' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p style={{ color: T3, fontSize: 12.5 }}>{t("Barmans, videurs, vestiaires. Ils définissent leur propre PIN après connexion à leur compte.", 'Barmen, bouncers, cloakroom staff. They set their own PIN after logging into their account.')}</p>
            <OrgButton variant="primary" onClick={() => setStaffOpen(true)}>
              <Plus className="h-4 w-4" />{t('Inviter un staff', 'Invite staff')}
            </OrgButton>
          </div>

          {/* Prix du vestiaire des soirées SANS club (dans un club, c'est le
              prix du club qui s'applique). Réglé par le fondateur. */}
          {isOwner && staff.some(s => s.role === 'cloakroom') && (
            <OrgCard>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('Prix du vestiaire', 'Cloakroom price')}</p>
                  <p style={{ color: T3, fontSize: 12 }}>
                    {t("Par emplacement, pour vos soirées sans club. 0 € = vestiaire gratuit.", 'Per item, for your events without a club. €0 = free cloakroom.')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DarkInput type="number" value={cloakPrice} onChange={setCloakPrice} placeholder="4" />
                  <OrgButton variant="secondary" onClick={saveCloakPrice} disabled={savingCloakPrice}>
                    {savingCloakPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Enregistrer', 'Save')}
                  </OrgButton>
                </div>
              </div>
            </OrgCard>
          )}

          {loadingStaff ? (
            <Loading />
          ) : staff.length === 0 ? (
            <OrgEmptyState icon={Beer} title={t("Aucun staff opérationnel.", 'No operational staff yet.')} description={t('Ajoutez vos barmans, videurs et vestiaires.', 'Add your barmen, bouncers and cloakroom team.')} />
          ) : (
            <div className="space-y-2">
              {staff.map((s) => {
                return (
                  <OrgCard key={s.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{s.display_name ?? s.email}</div>
                        <div className="mt-0.5 flex items-center gap-2" style={{ color: T3, fontSize: 11.5 }}>
                          <span className="truncate">{s.email}</span>
                        </div>
                      </div>
                      <OrgPill tone={staffRoleTone(s.role)}>
                        {staffRoleIcon(s.role)} {staffRoleLabel(s.role)}
                      </OrgPill>
                      <OrgButton size="sm" variant="danger" onClick={() => removeStaff(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </OrgButton>
                    </div>
                  </OrgCard>
                );
              })}
            </div>
          )}

          {/* Pending email invitations (not accepted yet) */}
          {pendingStaffInvites.length > 0 && (
            <div className="space-y-2 pt-1">
              <h3 style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{t('Invitations en attente', 'Pending invitations')}</h3>
              {pendingStaffInvites.map((inv) => (
                <OrgCard key={inv.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ color: T1, fontSize: 13.5 }}>{inv.email}</div>
                      <div className="mt-0.5" style={{ color: 'var(--acc-fcd34d)', fontSize: 11.5 }}>{t('En attente d\'acceptation', 'Awaiting acceptance')}</div>
                    </div>
                    <OrgPill tone={staffRoleTone(inv.role)}>{staffRoleIcon(inv.role)} {staffRoleLabel(inv.role)}</OrgPill>
                    <OrgButton size="sm" variant="secondary" onClick={() => resendStaffInvite(inv.email, inv.role)}>
                      <RefreshCw className="h-3.5 w-3.5" />{t('Renvoyer', 'Resend')}
                    </OrgButton>
                    <OrgButton size="sm" variant="danger" onClick={() => cancelStaffInvite(inv.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </OrgButton>
                  </div>
                </OrgCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- DIALOGS ---------- */}
      {/* Invite team member */}
      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="border-0 p-0" style={dialogStyle}>
          <div className="p-6">
            <DialogHeader>
              <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('Nouveau membre', 'New member')}</DialogTitle>
              <DialogDescription className="sr-only">{t('Nouveau membre', 'New member')}</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div>
                <FieldLabel>Email</FieldLabel>
                <DarkInput type="email" value={memberEmail} onChange={setMemberEmail} placeholder="collaborateur@email.com" />
              </div>
              <div>
                <FieldLabel>{t('Rôle', 'Role')}</FieldLabel>
                <DarkSelect value={memberRole} onChange={(v) => setMemberRole(v as TeamRole)}>
                  <option value="admin" style={{ background: 'var(--sf-0a0a0c)' }}>Admin · {t("tout sauf supprimer l'orga", 'everything except delete org')}</option>
                  <option value="editor" style={{ background: 'var(--sf-0a0a0c)' }}>{t('Éditeur', 'Editor')} · {t('créer & modifier événements', 'create & edit events')}</option>
                  <option value="scanner" style={{ background: 'var(--sf-0a0a0c)' }}>{t('Scanner Billets', 'Ticket Scanner')} · {t('check-in entrée', 'entry check-in')}</option>
                </DarkSelect>
              </div>
              <OrgButton variant="primary" className="w-full" onClick={inviteMember} disabled={submittingTeam || !memberEmail}>
                {submittingTeam && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Envoyer l'invitation", 'Send invitation')}
              </OrgButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add staff */}
      <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
        <DialogContent className="border-0 p-0" style={dialogStyle}>
          <div className="p-6">
            <DialogHeader>
              <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('Nouveau staff opérationnel', 'New operational staff')}</DialogTitle>
              <DialogDescription className="sr-only">{t('Nouveau staff opérationnel', 'New operational staff')}</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div>
                <FieldLabel>{t('Nom complet', 'Full name')}</FieldLabel>
                <DarkInput value={staffName} onChange={setStaffName} placeholder="Marie Dupont" />
              </div>
              <div>
                <FieldLabel>Email</FieldLabel>
                <DarkInput type="email" value={staffEmail} onChange={setStaffEmail} />
              </div>
              <div>
                <FieldLabel>{t('Poste', 'Role')}</FieldLabel>
                <DarkSelect value={staffRole} onChange={(v) => setStaffRole(v as StaffRole)}>
                  {DRINKS_PILLAR_LIVE && (
                  <option value="barman" style={{ background: 'var(--sf-0a0a0c)' }}>🍺 {t('Barman · gère les boissons offertes', 'Barman · manages free drinks')}</option>
                  )}
                  <option value="bouncer" style={{ background: 'var(--sf-0a0a0c)' }}>🛡️ {t('Videur · check-in entrée', 'Bouncer · entry check-in')}</option>
                  <option value="cloakroom" style={{ background: 'var(--sf-0a0a0c)' }}>🧥 {t('Vestiaire · gestion des dépôts', 'Cloakroom · deposit management')}</option>
                </DarkSelect>
              </div>
              <div>
                <FieldLabel>{t("Langue de l'e-mail", 'Email language', 'Idioma del correo')}</FieldLabel>
                <DarkSelect value={staffLang} onChange={(v) => setStaffLang(v as 'fr' | 'en' | 'es')}>
                  <option value="fr" style={{ background: 'var(--sf-0a0a0c)' }}>Français</option>
                  <option value="en" style={{ background: 'var(--sf-0a0a0c)' }}>English</option>
                  <option value="es" style={{ background: 'var(--sf-0a0a0c)' }}>Español</option>
                </DarkSelect>
              </div>
              <p style={{ color: T3, fontSize: 11.5 }}>
                {t(
                  "L'employé recevra un email d'invitation, créera son mot de passe puis définira son propre code PIN. Le soir, il travaille dans l'app Yuno Pro : l'e-mail lui donne le lien de l'App Store.",
                  'The employee will receive an invitation email, set their password, then choose their own PIN. On the night they work in the Yuno Pro app: the email gives them the App Store link.',
                  'El empleado recibirá un correo de invitación, creará su contraseña y luego elegirá su propio PIN. La noche del evento trabaja en la app Yuno Pro: el correo le da el enlace del App Store.',
                )}
              </p>
              <OrgButton variant="primary" className="w-full" onClick={inviteStaff} disabled={submittingStaff || !staffEmail || !staffName}>
                {submittingStaff && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Envoyer l'invitation", 'Send invitation')}
              </OrgButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Permissions */}
      <Dialog open={!!permsTarget} onOpenChange={(o) => !o && setPermsTarget(null)}>
        <DialogContent className="border-0 p-0" style={dialogStyle}>
          <div className="p-6">
            <DialogHeader>
              <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('Permissions granulaires', 'Granular permissions')}</DialogTitle>
              <DialogDescription className="sr-only">Permissions</DialogDescription>
            </DialogHeader>
            {permsTarget && (
              <div className="mt-4 space-y-3">
                <p style={{ color: T3, fontSize: 12.5 }}>{permsTarget.member_email}</p>
                {([
                  { key: 'can_view_finance', fr: 'Voir analytics & factures', en: 'View analytics & invoices' },
                  { key: 'can_refund', fr: 'Effectuer des remboursements', en: 'Process refunds' },
                  { key: 'can_export', fr: 'Exporter les données (CSV/PDF)', en: 'Export data (CSV/PDF)' },
                  { key: 'can_manage_team', fr: "Gérer l'équipe", en: 'Manage team' },
                ] as const).map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <span style={{ color: T2, fontSize: 12.5 }}>{t(p.fr, p.en)}</span>
                    <Switch
                      checked={permsTarget[p.key] as boolean}
                      onCheckedChange={(v) => {
                        updatePermission(permsTarget, p.key, v);
                        setPermsTarget({ ...permsTarget, [p.key]: v });
                      }}
                      disabled={permsTarget.role === 'admin'}
                    />
                  </div>
                ))}
                {permsTarget.role === 'admin' && (
                  <p style={{ color: T3, fontSize: 11, fontStyle: 'italic' }}>
                    {t('Les admins ont toutes les permissions par défaut.', 'Admins have all permissions by default.')}
                  </p>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </OrgPage>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
    </div>
  );
}
