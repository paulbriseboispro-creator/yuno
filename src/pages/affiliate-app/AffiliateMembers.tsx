import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Users, UserCheck, UserX, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AffPage, AffHeading, AffCard, AffCardHeader, Pill, AffButton, AffAvatar, AffSpinner,
  FieldLabel, DarkInput, DarkSelect,
  RED, POS, T1, T2, T3, BORDER, C_FAINT, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

type Member = {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
  linktree_slug?: string | null;
  email?: string;
};

const ROLE_LABELS: Record<string, string> = { promoter: 'Promoteur', manager: 'Manager' };
const ROLE_TONE: Record<string, 'muted' | 'red'> = { promoter: 'muted', manager: 'red' };

export default function AffiliateMembers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState<'promoter' | 'manager'>('promoter');

  useEffect(() => {
    if (user) fetchMembers();
  }, [user]);

  const fetchMembers = async () => {
    setLoading(true);
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user!.id).single();
    if (!aff) { setLoading(false); return; }
    setAffiliateId(aff.id);

    const { data: memberRows } = await supabase
      .from('affiliate_members')
      .select('id, user_id, role, is_active, created_at, first_name, last_name, linktree_slug')
      .eq('affiliate_id', aff.id)
      .order('created_at', { ascending: false });

    setMembers(memberRows ?? []);
    setLoading(false);
  };

  const handleInvite = async () => {
    if (!affiliateId || !inviteEmail.trim() || !inviteFirstName.trim() || !inviteLastName.trim()) return;
    setInviteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-affiliate-member', {
        body: {
          email: inviteEmail.trim().toLowerCase(),
          first_name: inviteFirstName.trim(),
          last_name: inviteLastName.trim(),
          role: inviteRole,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: 'Invitation envoyée', description: data?.message ?? `${inviteEmail} a reçu une invitation.` });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      fetchMembers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleToggleActive = async (member: Member) => {
    const { error } = await supabase
      .from('affiliate_members')
      .update({ is_active: !member.is_active })
      .eq('id', member.id);

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, is_active: !member.is_active } : m));
    toast({ title: member.is_active ? 'Membre désactivé' : 'Membre réactivé' });
  };

  const inviteValid = inviteEmail.trim() && inviteFirstName.trim() && inviteLastName.trim();

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title="Équipe"
          subtitle="Gérez les promoteurs et managers de votre organisation."
          right={<AffButton size="sm" onClick={() => setInviteOpen(true)}><Plus className="h-4 w-4" /> Inviter un membre</AffButton>}
        />
      </motion.div>

      {/* Role explanation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AffCard padding={16}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
              <UserCheck className="h-3.5 w-3.5" style={{ color: T2 }} />
            </div>
            <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>Promoteur</span>
          </div>
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
            Peut créer et gérer des soirées. Utilise le lien affilié pour ses billets.
          </p>
        </AffCard>
        <AffCard padding={16}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Users className="h-3.5 w-3.5" style={{ color: RED }} />
            </div>
            <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>Manager</span>
          </div>
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
            Accès complet à la gestion des clubs, soirées et promoteurs.
          </p>
        </AffCard>
      </div>

      {/* Members list */}
      <AffCard padding={0}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <h2 style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{members.length} membre{members.length !== 1 ? 's' : ''}</h2>
        </div>

        {loading ? (
          <div className="py-12"><AffSpinner /></div>
        ) : members.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
            <p style={{ color: T2, fontSize: 13 }}>Aucun membre pour l'instant.</p>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>Invitez des promoteurs pour gérer les soirées ensemble.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {members.map(member => {
              const name = member.first_name && member.last_name
                ? `${member.first_name} ${member.last_name}`
                : member.email ?? `${member.user_id.slice(0, 8)}…`;
              return (
                <div key={member.id} className="flex items-center gap-4 px-5 py-4" style={{ opacity: member.is_active ? 1 : 0.5 }}>
                  <AffAvatar fallback={(member.first_name ?? name).slice(0, 1)} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{name}</p>
                    {member.linktree_slug && (
                      <p className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>yunoapp.eu/promo/{member.linktree_slug}</p>
                    )}
                    <p style={{ color: T3, fontSize: 11, marginTop: 1 }}>
                      Ajouté le {format(new Date(member.created_at), 'd MMM yyyy', { locale: fr })}
                    </p>
                  </div>
                  <Pill tone={ROLE_TONE[member.role] ?? 'muted'}>{ROLE_LABELS[member.role] ?? member.role}</Pill>
                  <AffButton size="sm" variant="ghost" onClick={() => handleToggleActive(member)}>
                    {member.is_active
                      ? <><UserX className="h-3.5 w-3.5" /> Désactiver</>
                      : <><UserCheck className="h-3.5 w-3.5" style={{ color: POS }} /> Réactiver</>}
                  </AffButton>
                </div>
              );
            })}
          </div>
        )}
      </AffCard>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md border-0 text-white" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}` }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: T1 }}>
              <Mail className="h-5 w-5" style={{ color: RED }} />
              Inviter un membre
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Prénom *</FieldLabel>
                <DarkInput value={inviteFirstName} onChange={setInviteFirstName} placeholder="Jean" />
              </div>
              <div>
                <FieldLabel>Nom *</FieldLabel>
                <DarkInput value={inviteLastName} onChange={setInviteLastName} placeholder="Dupont" />
              </div>
            </div>

            <div>
              <FieldLabel>Email *</FieldLabel>
              <DarkInput type="email" value={inviteEmail} onChange={setInviteEmail} placeholder="promoteur@example.com" />
            </div>

            <div>
              <FieldLabel>Rôle</FieldLabel>
              <DarkSelect value={inviteRole} onChange={(v) => setInviteRole(v as 'promoter' | 'manager')}>
                <option value="promoter">Promoteur — créer et gérer des soirées</option>
                <option value="manager">Manager — accès complet</option>
              </DarkSelect>
            </div>

            <div className="rounded-lg p-3 space-y-1" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
              <p style={{ color: T1, fontSize: 12, fontWeight: 600 }}>Ce qui va se passer :</p>
              <p style={{ color: T3, fontSize: 11.5 }}>• Un compte promoteur est créé immédiatement</p>
              <p style={{ color: T3, fontSize: 11.5 }}>• L'invité reçoit un email pour choisir son mot de passe</p>
              <p style={{ color: T3, fontSize: 11.5 }}>• Il accède à son espace promoteur et sa page linktree</p>
            </div>
          </div>

          <DialogFooter>
            <AffButton variant="ghost" size="sm" onClick={() => setInviteOpen(false)}>Annuler</AffButton>
            <AffButton size="sm" onClick={handleInvite} disabled={inviteLoading || !inviteValid}>
              {inviteLoading ? 'Envoi…' : "Envoyer l'invitation"}
            </AffButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AffPage>
  );
}
