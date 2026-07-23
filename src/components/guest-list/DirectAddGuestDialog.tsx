import { useState } from 'react';
import { Loader2, Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { allowedEntryTypes, entryTypeLabelKey, type GLEntryType, type GLTypeSource } from '@/lib/guestListTypes';

interface DirectAddGuestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guestList: GLTypeSource & { id: string; quota_female: number | null; quota_male: number | null };
  onAdded?: () => void;
}

/**
 * Ajout DIRECT d'un invité par le détenteur d'une part (canal 2) — même flux
 * que le promoteur : nom + prénom + email optionnel, l'invité reçoit son QR
 * par email. Passe par guest-list-manage (action add_guest), qui vérifie
 * can_manage_guest_list_part côté serveur.
 */
export function DirectAddGuestDialog({ open, onOpenChange, guestList, onAdded }: DirectAddGuestDialogProps) {
  const { t } = useLanguage();
  const types = allowedEntryTypes(guestList);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [entryType, setEntryType] = useState<GLEntryType>(types[0] ?? 'normal');
  const [gender, setGender] = useState<'female' | 'male' | ''>('');
  const [adding, setAdding] = useState(false);

  const gendered = (guestList.quota_female ?? 0) > 0 || (guestList.quota_male ?? 0) > 0;

  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error(t('promoterGuestlist.nameRequired'));
      return;
    }
    setAdding(true);
    try {
      const sendType = types.includes(entryType) ? entryType : (types[0] ?? 'normal');
      const { data, error } = await supabase.functions.invoke('guest-list-manage', {
        body: {
          action: 'add_guest',
          guestListId: guestList.id,
          fullName: `${firstName.trim()} ${lastName.trim()}`,
          email: email.trim() || null,
          gender: gender || null,
          entryType: sendType,
        },
      });
      if (error) {
        let fnMessage = '';
        const errorContext = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context;
        if (errorContext && typeof errorContext.json === 'function') {
          try {
            const parsed = await errorContext.json();
            fnMessage = parsed?.error || '';
          } catch { /* ignore parse errors */ }
        }
        throw new Error(fnMessage || (error as Error)?.message || t('promoterGuestlist.addError'));
      }
      if (data?.error) throw new Error(data.error);

      toast.success(t('promoterGuestlist.added'));
      setFirstName(''); setLastName(''); setEmail(''); setGender('');
      onAdded?.();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : t('promoterGuestlist.addError'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            {t('glTools.addGuest')}
          </DialogTitle>
          <DialogDescription>{t('glTools.addGuestDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('promoterGuestlist.firstName')}</Label>
              <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder={t('promoterGuestlist.firstNamePlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('promoterGuestlist.lastName')}</Label>
              <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder={t('promoterGuestlist.lastNamePlaceholder')} />
            </div>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {t('promoterGuestlist.email')}
            </Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('promoterGuestlist.emailPlaceholder')} />
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('promoterGuestlist.emailHint')}</p>
          </div>

          {types.length > 1 && (
            <div>
              <Label className="text-xs">{t('promoterGuestlist.entryType')}</Label>
              <Select value={entryType} onValueChange={v => setEntryType(v as GLEntryType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {types.map(type => (
                    <SelectItem key={type} value={type}>{t(entryTypeLabelKey(type))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {gendered && (
            <div>
              <Label className="text-xs">{t('promoterGuestlist.gender')}</Label>
              <Select value={gender || 'none'} onValueChange={v => setGender(v === 'none' ? '' : v as 'female' | 'male')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('promoterGuestlist.genderUnset')}</SelectItem>
                  <SelectItem value="female">{t('promoterGuestlist.female')}</SelectItem>
                  <SelectItem value="male">{t('promoterGuestlist.male')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <Button onClick={handleAdd} disabled={adding || !firstName.trim() || !lastName.trim()} className="w-full">
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
            {t('promoterGuestlist.addToList')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
