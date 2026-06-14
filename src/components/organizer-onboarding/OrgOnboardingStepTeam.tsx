import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Mail, Megaphone, Shield, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type TeamRole = 'admin' | 'editor' | 'scanner';

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function OrgOnboardingStepTeam({ onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [invited, setInvited] = useState(false);

  const invite = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-org-member', {
        body: { email: email.trim(), role },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(tt('Invitation envoyée', 'Invitation sent'));
      setInvited(true);
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? tt('Erreur', 'Error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          {tt('Équipe & promoteurs', 'Team & promoters')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tt(
            "Invitez votre équipe pour partager le travail : co-organisateurs, scanneurs d'entrée, promoteurs avec codes traqués.",
            'Invite your team to share the load: co-organizers, door scanners, promoters with tracked codes.'
          )}
        </p>
      </div>

      {invited ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">{tt('Invitation envoyée 🎉', 'Invitation sent 🎉')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tt(
                "Votre collaborateur recevra un e-mail pour rejoindre l'organisation. Vous pourrez gérer les rôles et permissions depuis « Équipe ».",
                'Your teammate will get an email to join the organization. Manage roles and permissions anytime under "Team".'
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
          <Item icon={Shield} title={tt('Co-organisateurs', 'Co-organizers')} desc={tt('Permissions fines : finances, équipe, exports.', 'Granular permissions: finance, team, exports.')} />
          <Item icon={Megaphone} title={tt('Promoteurs', 'Promoters')} desc={tt('Codes uniques + commissions automatiques par billet vendu.', 'Unique codes + automatic commissions per ticket sold.')} />
          <Item icon={Mail} title={tt('Invitations par email', 'Email invitations')} desc={tt('Ils créent leur compte en 1 clic.', 'They create an account in one click.')} />
        </div>
      )}

      <div className="flex gap-2">
        {invited ? (
          <Button onClick={onComplete} className="flex-1" size="lg">
            {tt('Continuer', 'Continue')}
          </Button>
        ) : (
          <>
            <Button onClick={() => setDialogOpen(true)} className="flex-1" size="lg">
              <Mail className="h-4 w-4 mr-2" />
              {tt('Inviter mon équipe', 'Invite my team')}
            </Button>
            <Button onClick={onSkip} variant="ghost" size="lg">
              {tt('Plus tard', 'Later')}
            </Button>
          </>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('Inviter un membre', 'Invite a member')}</DialogTitle>
            <DialogDescription>
              {tt(
                "Envoyez une invitation par e-mail. Vous pourrez ajuster les permissions ensuite.",
                'Send an email invitation. You can adjust permissions afterwards.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="collaborateur@email.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label>{tt('Rôle', 'Role')}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin · {tt("tout sauf supprimer l'orga", 'everything except delete org')}</SelectItem>
                  <SelectItem value="editor">{tt('Éditeur', 'Editor')} · {tt('créer & modifier événements', 'create & edit events')}</SelectItem>
                  <SelectItem value="scanner">{tt('Scanner Billets', 'Ticket Scanner')} · {tt('check-in entrée', 'entry check-in')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={invite} disabled={submitting || !email.trim()} className="w-full">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tt("Envoyer l'invitation", 'Send invitation')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Item({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
