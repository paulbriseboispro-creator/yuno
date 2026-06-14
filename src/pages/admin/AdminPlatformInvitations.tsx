import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Mail, Sparkles, Trash2, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Invitation {
  id: string;
  email: string;
  profile_type: string;
  organization_name: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

interface OrgAccount {
  id: string;
  email: string | null;
  organization_name: string | null;
  profile_type: string | null;
  created_at: string;
}

export default function AdminPlatformInvitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [accounts, setAccounts] = useState<OrgAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<OrgAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [inv, accs] = await Promise.all([
      supabase.from('platform_invitations').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles')
        .select('id, email, organization_name, profile_type, created_at')
        .eq('profile_type', 'organizer')
        .order('created_at', { ascending: false }),
    ]);
    setInvitations((inv.data ?? []) as Invitation[]);
    setAccounts((accs.data ?? []) as OrgAccount[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!email || !orgName) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-platform-user', {
        body: { email, organization_name: orgName },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.user_exists
        ? 'Compte existant lié au profil organisateur'
        : 'Invitation envoyée par email');
      setEmail(''); setOrgName('');
      setInviteOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async (inv: Invitation) => {
    if (!inv.organization_name) return;
    try {
      const { data, error } = await supabase.functions.invoke('invite-platform-user', {
        body: { email: inv.email, organization_name: inv.organization_name },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Email d\'invitation renvoyé');
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from('platform_invitations')
      .update({ status: 'revoked' })
      .eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Invitation révoquée'); load(); }
  };

  const deleteInvitation = async (id: string) => {
    const { error } = await supabase.from('platform_invitations').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Invitation supprimée'); load(); }
  };

  const openEdit = (acc: OrgAccount) => {
    setEditTarget(acc);
    setEditName(acc.organization_name ?? '');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ organization_name: editName })
        .eq('id', editTarget.id);
      if (error) throw error;
      // also update public organizer_profiles display_name if exists
      await supabase
        .from('organizer_profiles')
        .update({ display_name: editName })
        .eq('user_id', editTarget.id);
      toast.success('Organisation mise à jour');
      setEditOpen(false);
      setEditTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setEditSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Revert profile to default 'club' type (profile_type is NOT NULL in DB)
      const { error: pErr } = await supabase
        .from('profiles')
        .update({ profile_type: 'club', organization_name: null, onboarding_completed: false })
        .eq('id', deleteTarget.id);
      if (pErr) throw pErr;

      // Drop the public organizer profile (if any)
      await supabase.from('organizer_profiles').delete().eq('user_id', deleteTarget.id);

      // Remove the 'organizer' role so they no longer access the V2 dashboard
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', deleteTarget.id)
        .eq('role', 'organizer');

      // Drop any platform invitation for this email
      if (deleteTarget.email) {
        await supabase
          .from('platform_invitations')
          .delete()
          .eq('email', deleteTarget.email.toLowerCase());
      }

      toast.success('Compte organisateur retiré');
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setDeleting(false);
    }
  };

  const TypeIcon = () => <Sparkles className="h-3.5 w-3.5" />;
  const pending = invitations.filter(i => i.status === 'pending');
  const past = invitations.filter(i => i.status !== 'pending');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organisateurs</h1>
          <p className="text-muted-foreground mt-1">
            Invitez, modifiez ou retirez les comptes organisateurs (publics et BDE/privés via le type d'événement).
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Inviter</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nouvelle invitation organisateur</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>Email</Label>
                <Input
                  type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@orga.com" className="mt-1"
                />
              </div>
              <div>
                <Label>Nom de l'organisation</Label>
                <Input
                  value={orgName} onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Ex: BDE Sciences Po, Viva Events…" className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Si l'email a déjà un compte Yuno, il sera lié au profil organisateur instantanément.
                  Sinon, un email d'invitation sera envoyé.
                </p>
              </div>
              <Button onClick={submit} disabled={submitting || !email || !orgName} className="w-full">
                {submitting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />}
                Envoyer l'invitation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <Card className="p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />Invitations en attente ({pending.length})
        </h2>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">…</div>
        ) : pending.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">Aucune invitation en attente.</div>
        ) : (
          <div className="space-y-2">
            {pending.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{inv.organization_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {inv.email} · expire le {format(new Date(inv.expires_at), 'dd/MM/yyyy')}
                  </div>
                </div>
                <Badge variant="outline" className="gap-1"><TypeIcon />Organisateur</Badge>
                <Button variant="ghost" size="icon" onClick={() => resend(inv)} title="Renvoyer l'email" className="h-8 w-8">
                  <Send className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => revoke(inv.id)} title="Révoquer" className="h-8 w-8 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold text-lg mb-4">Comptes actifs ({accounts.length})</h2>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">…</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">Aucun compte actif.</div>
        ) : (
          <div className="space-y-2">
            {accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{acc.organization_name ?? '—'}</div>
                  <div className="text-xs text-muted-foreground truncate">{acc.email}</div>
                </div>
                <Badge variant="secondary" className="gap-1"><TypeIcon />Organisateur</Badge>
                <Button variant="ghost" size="icon" onClick={() => openEdit(acc)} title="Modifier" className="h-8 w-8">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(acc)} title="Retirer" className="h-8 w-8 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {past.length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4 text-muted-foreground">Historique invitations</h2>
          <div className="space-y-2">
            {past.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/20">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{inv.organization_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {inv.email} · {inv.status} · {format(new Date(inv.created_at), 'dd/MM/yyyy')}
                  </div>
                </div>
                <Badge variant="outline">{inv.status}</Badge>
                {inv.status !== 'accepted' && inv.organization_name && (
                  <Button variant="ghost" size="icon" onClick={() => resend(inv)} title="Renvoyer l'email" className="h-8 w-8">
                    <Send className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => deleteInvitation(inv.id)} title="Supprimer" className="h-8 w-8 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier l'organisation</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Email (lecture seule)</Label>
              <Input value={editTarget?.email ?? ''} disabled className="mt-1" />
            </div>
            <div>
              <Label>Nom de l'organisation</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Annuler</Button>
            <Button onClick={saveEdit} disabled={editSaving || !editName}>
              {editSaving && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer le profil organisateur ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.organization_name}</strong> ({deleteTarget?.email}) ne pourra plus accéder
              au tableau de bord organisateur. Le compte utilisateur reste actif (rôle client conservé).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Suppression…' : 'Retirer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
