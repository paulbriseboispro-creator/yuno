import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Mail, Plus, Ticket as TicketIcon, Wine, Crown, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildInviteLink } from '@/lib/guestListShare';
import { allowedEntryTypes, entryTypeLabelKey, type GLEntryType, type GLTypeSource } from '@/lib/guestListTypes';

const TYPE_ICON: Record<GLEntryType, typeof TicketIcon> = { normal: TicketIcon, drink: Wine, table: Crown };

interface InviteRow {
  id: string;
  token: string;
  entry_type: string;
  max_uses: number;
  used_count: number;
  guest_name: string | null;
  guest_email: string | null;
  email_sent_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface InviteLinksPanelProps {
  guestList: GLTypeSource & { id: string };
  slug: string;
  eventId: string;
}

/**
 * Liens UNIQUES personnels (canal 3) : le détenteur génère un lien à type
 * imposé et nombre de places limité (ex. 2 places VIP), le copie ou l'envoie
 * par email. Lecture via RLS (can_manage_guest_list_part), création par insert
 * direct (le trigger DB valide le type), envoi email via guest-list-manage.
 */
export function InviteLinksPanel({ guestList, slug, eventId }: InviteLinksPanelProps) {
  const { t } = useLanguage();
  const types = allowedEntryTypes(guestList);

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [entryType, setEntryType] = useState<GLEntryType>(types[0] ?? 'normal');
  const [maxUses, setMaxUses] = useState(1);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('guest_list_invites')
      .select('id, token, entry_type, max_uses, used_count, guest_name, guest_email, email_sent_at, revoked_at, created_at')
      .eq('guest_list_id', guestList.id)
      .order('created_at', { ascending: false });
    setInvites((data as InviteRow[]) || []);
  }, [guestList.id]);

  useEffect(() => { load(); }, [load]);

  const sendInviteEmail = async (inviteId: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('guest-list-manage', {
      body: { action: 'send_invite_email', inviteId },
    });
    return !error && !data?.error && data?.sent !== false;
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data: created, error } = await supabase
        .from('guest_list_invites')
        .insert({
          guest_list_id: guestList.id,
          entry_type: types.includes(entryType) ? entryType : (types[0] ?? 'normal'),
          max_uses: Math.min(50, Math.max(1, maxUses)),
          guest_name: guestName.trim() || null,
          guest_email: guestEmail.trim().toLowerCase() || null,
        })
        .select('id, guest_email')
        .single();
      if (error || !created) throw error ?? new Error('insert failed');

      if (created.guest_email) {
        const sent = await sendInviteEmail(created.id);
        toast.success(sent ? t('glTools.inviteCreatedSent') : t('glTools.inviteCreatedEmailFailed'));
      } else {
        toast.success(t('glTools.inviteCreated'));
      }
      setGuestName(''); setGuestEmail(''); setMaxUses(1); setShowForm(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(t('glTools.inviteCreateError'));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (invite: InviteRow) => {
    try {
      await navigator.clipboard.writeText(buildInviteLink({ slug, eventId, token: invite.token }));
      setCopied(invite.id);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error(t('glTools.inviteCreateError'));
    }
  };

  const handleResend = async (invite: InviteRow) => {
    setSendingId(invite.id);
    const sent = await sendInviteEmail(invite.id);
    setSendingId(null);
    if (sent) {
      toast.success(t('glTools.inviteEmailSent'));
      await load();
    } else {
      toast.error(t('glTools.inviteEmailFailed'));
    }
  };

  const handleRevoke = async (invite: InviteRow) => {
    const { error } = await supabase
      .from('guest_list_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', invite.id);
    if (error) {
      toast.error(t('glTools.inviteCreateError'));
      return;
    }
    toast.success(t('glTools.inviteRevoked'));
    await load();
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Mail className="h-3.5 w-3.5 text-primary" />
          {t('glTools.inviteLinks')}
        </p>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowForm(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('glTools.newInvite')}
        </Button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground/70">{t('glTools.inviteLinksDesc')}</p>

      {showForm && (
        <div className="mt-2 space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-2.5">
            {types.length > 1 && (
              <div>
                <Label className="text-xs">{t('promoterGuestlist.entryType')}</Label>
                <Select value={entryType} onValueChange={v => setEntryType(v as GLEntryType)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {types.map(type => (
                      <SelectItem key={type} value={type}>{t(entryTypeLabelKey(type))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">{t('glTools.maxUses')}</Label>
              <Input type="number" min={1} max={50} value={maxUses} className="h-9"
                onChange={e => setMaxUses(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">{t('glTools.inviteNameOpt')}</Label>
              <Input value={guestName} onChange={e => setGuestName(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">{t('glTools.inviteEmailOpt')}</Label>
              <Input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} className="h-9" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">{t('glTools.inviteEmailHint')}</p>
          <Button onClick={handleCreate} disabled={creating} size="sm" className="w-full">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            {t('glTools.createInvite')}
          </Button>
        </div>
      )}

      {invites.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {invites.map(invite => {
            const type = (['normal', 'drink', 'table'].includes(invite.entry_type) ? invite.entry_type : 'normal') as GLEntryType;
            const Icon = TYPE_ICON[type];
            const revoked = !!invite.revoked_at;
            const exhausted = invite.used_count >= invite.max_uses;
            return (
              <div key={invite.id}
                className={`flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 ${revoked ? 'opacity-50' : ''}`}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {invite.guest_name || invite.guest_email || t('glTools.inviteAnonymous')}
                  </p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {t(entryTypeLabelKey(type))} · {invite.used_count}/{invite.max_uses} {t('glTools.usedLabel')}
                    {revoked && <> · {t('glTools.inviteRevokedBadge')}</>}
                  </p>
                </div>
                {!revoked && exhausted && (
                  <Badge variant="secondary" className="shrink-0 text-[9px]">{t('promoterGuestlist.full')}</Badge>
                )}
                {!revoked && (
                  <>
                    <button type="button" onClick={() => handleCopy(invite)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
                      {copied === invite.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    {invite.guest_email && (
                      <button type="button" onClick={() => handleResend(invite)} disabled={sendingId === invite.id}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
                        {sendingId === invite.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button type="button" onClick={() => handleRevoke(invite)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-destructive">
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
