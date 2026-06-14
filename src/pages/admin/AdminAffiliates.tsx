import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus, Mail, Building2, MapPin, TrendingUp, CheckCircle, XCircle, Send, Trash2, Copy } from 'lucide-react';
import { format } from 'date-fns';

type AffiliateRow = {
  id: string;
  name: string;
  type: string;
  city: string | null;
  commission_rate: number;
  is_active: boolean;
  created_at: string;
  user_id: string;
  venueCount?: number;
  eventCount?: number;
  clickCount?: number;
};

type InviteForm = {
  email: string;
  name: string;
  city: string;
  type: 'city_agency' | 'independent' | 'yuno_internal';
  commission_rate: string;
};

type PendingInvite = {
  id: string;
  email: string;
  organization_name: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  token: string;
};

const TYPE_LABELS: Record<string, string> = {
  yuno_internal: 'Yuno Interne',
  city_agency: 'Agence Ville',
  independent: 'Indépendant',
};

const TYPE_COLORS: Record<string, string> = {
  yuno_internal: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  city_agency: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  independent: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
};

export default function AdminAffiliates() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [form, setForm] = useState<InviteForm>({
    email: '',
    name: '',
    city: '',
    type: 'city_agency',
    commission_rate: '0',
  });

  useEffect(() => {
    fetchAffiliates();
  }, []);

  const fetchAffiliates = async () => {
    setLoading(true);
    try {
      const [{ data, error }, { data: invites }] = await Promise.all([
        supabase.from('affiliates').select('*').order('created_at', { ascending: false }),
        supabase
          .from('platform_invitations')
          .select('id, email, organization_name, status, created_at, expires_at, token')
          .eq('profile_type', 'affiliate')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);

      if (error) throw error;

      setPendingInvites((invites ?? []) as PendingInvite[]);

      // Enrich affiliates with counts
      const enriched = await Promise.all(
        (data ?? []).map(async (aff) => {
          const [{ count: venueCount }, { count: eventCount }, { count: clickCount }] =
            await Promise.all([
              supabase
                .from('affiliate_venues')
                .select('*', { count: 'exact', head: true })
                .eq('affiliate_id', aff.id),
              supabase
                .from('affiliate_events')
                .select('*', { count: 'exact', head: true })
                .eq('affiliate_id', aff.id),
              supabase
                .from('affiliate_clicks')
                .select('*', { count: 'exact', head: true })
                .eq('affiliate_id', aff.id),
            ]);
          return {
            ...aff,
            venueCount: venueCount ?? 0,
            eventCount: eventCount ?? 0,
            clickCount: clickCount ?? 0,
          };
        })
      );

      setAffiliates(enriched);
    } catch (err) {
      console.error(err);
      toast({ title: 'Erreur', description: 'Impossible de charger les affiliés.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleResendInvite = async (invite: PendingInvite) => {
    if (!invite.organization_name) return;
    try {
      const { data, error } = await supabase.functions.invoke('invite-affiliate', {
        body: {
          email: invite.email,
          name: invite.organization_name,
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }
      if (data?.email_sent === false) {
        toast({ title: 'Invitation mise à jour', description: `Email non envoyé — vérifiez la configuration Resend. Lien : ${data.invite_link}` });
      } else {
        toast({ title: 'Email renvoyé', description: `Invitation renvoyée à ${invite.email}.` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    }
  };

  const handleRevokeInvite = async (id: string) => {
    const { error } = await supabase
      .from('platform_invitations')
      .update({ status: 'revoked' })
      .eq('id', id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Invitation révoquée' });
    fetchAffiliates();
  };

  const handleInvite = async () => {
    if (!form.email || !form.name) {
      toast({ title: 'Champs manquants', description: 'Email et nom sont requis.', variant: 'destructive' });
      return;
    }

    setInviteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-affiliate', {
        body: {
          email: form.email,
          name: form.name,
          city: form.city || null,
          type: form.type,
          commission_rate: parseFloat(form.commission_rate) || 0,
        },
      });

      if (error) {
        // Extract the real error message from the function response body
        let msg = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }

      if (data?.user_exists) {
        toast({ title: 'Affilié activé', description: `${form.name} a été activé directement.` });
      } else if (data?.email_sent === false && data?.invite_link) {
        toast({
          title: 'Invitation créée (email non envoyé)',
          description: `L'invitation a été créée mais l'email a échoué. Lien : ${data.invite_link}`,
        });
      } else {
        toast({ title: 'Invitation envoyée', description: `Un email a été envoyé à ${form.email}.` });
      }

      setInviteOpen(false);
      setForm({ email: '', name: '', city: '', type: 'city_agency', commission_rate: '0' });
      fetchAffiliates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleToggleActive = async (aff: AffiliateRow) => {
    const { error } = await supabase
      .from('affiliates')
      .update({ is_active: !aff.is_active })
      .eq('id', aff.id);

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }

    setAffiliates((prev) =>
      prev.map((a) => (a.id === aff.id ? { ...a, is_active: !aff.is_active } : a))
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Affiliés</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Gérez les agences ville et indépendants qui publient des clubs et soirées partenaires.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="bg-red-600 hover:bg-red-700">
          <Plus className="h-4 w-4 mr-2" />
          Inviter un affilié
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Affiliés actifs', value: affiliates.filter((a) => a.is_active).length, icon: Building2 },
          { label: 'Clubs partenaires', value: affiliates.reduce((s, a) => s + (a.venueCount ?? 0), 0), icon: MapPin },
          { label: 'Soirées affiliées', value: affiliates.reduce((s, a) => s + (a.eventCount ?? 0), 0), icon: CheckCircle },
          { label: 'Clics ce mois', value: affiliates.reduce((s, a) => s + (a.clickCount ?? 0), 0), icon: TrendingUp },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
              <Icon className="h-4 w-4" />
              {label}
            </div>
            <div className="text-2xl font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Pending invitations */}
      {(pendingInvites.length > 0 || loading) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Mail className="h-4 w-4 text-red-500" />
            Invitations en attente ({pendingInvites.length})
          </h2>
          {loading ? (
            <div className="text-zinc-500 text-sm text-center py-4">Chargement…</div>
          ) : (
            <div className="space-y-2">
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-800/50">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{inv.organization_name}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {inv.email} · expire le {format(new Date(inv.expires_at), 'dd/MM/yyyy')}
                    </div>
                  </div>
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs border">
                    En attente
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-400 hover:text-white"
                    title="Copier le lien d'activation"
                    onClick={() => {
                      const link = `${window.location.origin}/auth?invite_affiliate=${inv.token}&email=${encodeURIComponent(inv.email)}`;
                      navigator.clipboard.writeText(link);
                      toast({ title: 'Lien copié', description: 'Le lien d\'activation est dans le presse-papiers.' });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-400 hover:text-white"
                    title="Renvoyer l'invitation par email"
                    onClick={() => handleResendInvite(inv)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:text-red-400"
                    title="Révoquer"
                    onClick={() => handleRevokeInvite(inv.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Nom</TableHead>
              <TableHead className="text-zinc-400">Type</TableHead>
              <TableHead className="text-zinc-400">Ville</TableHead>
              <TableHead className="text-zinc-400 text-center">Clubs</TableHead>
              <TableHead className="text-zinc-400 text-center">Soirées</TableHead>
              <TableHead className="text-zinc-400 text-center">Clics</TableHead>
              <TableHead className="text-zinc-400 text-center">Commission</TableHead>
              <TableHead className="text-zinc-400 text-center">Statut</TableHead>
              <TableHead className="text-zinc-400" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-zinc-500 py-12">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : affiliates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-zinc-500 py-12">
                  Aucun affilié pour l'instant.
                </TableCell>
              </TableRow>
            ) : (
              affiliates.map((aff) => (
                <TableRow key={aff.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="font-medium text-white">{aff.name}</TableCell>
                  <TableCell>
                    <Badge className={`text-xs border ${TYPE_COLORS[aff.type] ?? ''}`}>
                      {TYPE_LABELS[aff.type] ?? aff.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-zinc-400">{aff.city ?? '—'}</TableCell>
                  <TableCell className="text-center text-zinc-300">{aff.venueCount}</TableCell>
                  <TableCell className="text-center text-zinc-300">{aff.eventCount}</TableCell>
                  <TableCell className="text-center text-zinc-300">{aff.clickCount}</TableCell>
                  <TableCell className="text-center text-zinc-300">{aff.commission_rate}%</TableCell>
                  <TableCell className="text-center">
                    {aff.is_active ? (
                      <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                    ) : (
                      <XCircle className="h-4 w-4 text-zinc-500 mx-auto" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-zinc-400 hover:text-white text-xs"
                      onClick={() => handleToggleActive(aff)}
                    >
                      {aff.is_active ? 'Désactiver' : 'Activer'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-red-500" />
              Inviter un affilié
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Email *</Label>
              <Input
                placeholder="contact@agence-madrid.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Nom de l'entité *</Label>
              <Input
                placeholder="Agence Madrid Nightlife"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Ville</Label>
                <Input
                  placeholder="Madrid"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="bg-zinc-900 border-zinc-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Commission (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder="0"
                  value={form.commission_rate}
                  onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                  className="bg-zinc-900 border-zinc-700 text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as InviteForm['type'] })}
              >
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="city_agency">Agence Ville</SelectItem>
                  <SelectItem value="independent">Indépendant</SelectItem>
                  <SelectItem value="yuno_internal">Yuno Interne</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} className="text-zinc-400">
              Annuler
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviteLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {inviteLoading ? 'Envoi…' : 'Envoyer l\'invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
