import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Mail, Megaphone, Shield, Check, Loader2, ArrowRight, SkipForward, type LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, DoneRow, OptionalPill, RED, POS, T1, T3 } from '@/components/onboarding/onboardingUI';

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
      const { data, error } = await supabase.functions.invoke('invite-org-member', { body: { email: email.trim(), role } });
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
    <div className="space-y-6">
      <StepHeader
        icon={Users}
        title={tt('Équipe & promoteurs', 'Team & promoters')}
        subtitle={tt(
          'Invitez votre équipe : co-organisateurs, scanneurs, promoteurs avec codes traqués.',
          'Invite your team: co-organizers, scanners, promoters with tracked codes.',
        )}
        right={<OptionalPill label={tt('Optionnel', 'Optional')} />}
      />

      {invited ? (
        <DoneRow>
          <Check className="w-5 h-5 flex-none" style={{ color: POS }} />
          <div>
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{tt('Invitation envoyée', 'Invitation sent')}</p>
            <p style={{ color: T3, fontSize: 12, marginTop: 1 }}>{tt('Gérez rôles et permissions dans « Équipe ».', 'Manage roles and permissions under "Team".')}</p>
          </div>
        </DoneRow>
      ) : (
        <InnerCard>
          <div className="space-y-3.5">
            <Item icon={Shield} title={tt('Co-organisateurs', 'Co-organizers')} desc={tt('Permissions fines : finances, équipe, exports.', 'Granular permissions: finance, team, exports.')} />
            <Item icon={Megaphone} title={tt('Promoteurs', 'Promoters')} desc={tt('Codes uniques + commissions automatiques par billet.', 'Unique codes + automatic commissions per ticket.')} />
            <Item icon={Mail} title={tt('Invitations par email', 'Email invitations')} desc={tt('Ils créent leur compte en 1 clic.', 'They create an account in one click.')} />
          </div>
        </InnerCard>
      )}

      <div className="flex gap-2.5">
        {invited ? (
          <PrimaryButton fullWidth icon={ArrowRight} onClick={onComplete}>
            {tt('Continuer', 'Continue')}
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton fullWidth icon={Mail} onClick={() => setDialogOpen(true)}>
              {tt('Inviter mon équipe', 'Invite my team')}
            </PrimaryButton>
            <GhostButton icon={SkipForward} onClick={onSkip}>
              {tt('Plus tard', 'Later')}
            </GhostButton>
          </>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('Inviter un membre', 'Invite a member')}</DialogTitle>
            <DialogDescription>
              {tt('Envoyez une invitation par e-mail. Permissions ajustables ensuite.', 'Send an email invitation. Permissions adjustable afterwards.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="collaborateur@email.com" className="mt-1" />
            </div>
            <div>
              <Label>{tt('Rôle', 'Role')}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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

function Item({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
        <Icon className="w-4 h-4" style={{ color: RED }} />
      </div>
      <div>
        <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ color: T3, fontSize: 12, marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );
}
