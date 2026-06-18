import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProfilePhotoUpload } from '@/components/ProfilePhotoUpload';
import { toast } from 'sonner';
import { Save, MessageCircle, User, Landmark, AlertTriangle, Loader2 } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { useLanguage } from '@/contexts/LanguageContext';

interface Promoter {
  id: string;
  user_id: string;
  promo_code: string;
  instagram_url: string | null;
  profile_image_url: string | null;
  iban?: string | null;
  bic?: string | null;
  venue?: { id: string; name: string; logo_url?: string };
}

interface PromoterProfileTabProps {
  promoter: Promoter;
  allPromoterProfiles?: Promoter[];
  onSaved?: () => void;
}

export function PromoterProfileTab({ promoter, allPromoterProfiles, onSaved }: PromoterProfileTabProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [instagram, setInstagram] = useState(promoter.instagram_url || '');
  const [whatsapp, setWhatsapp] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Bank info state
  const allProfiles = allPromoterProfiles || [promoter];
  const globalIban = allProfiles[0]?.iban || '';
  const globalBic = allProfiles[0]?.bic || '';
  const [showIbanDialog, setShowIbanDialog] = useState(false);
  const [confirmOldIban, setConfirmOldIban] = useState('');
  const [newIban, setNewIban] = useState('');
  const [newBic, setNewBic] = useState('');
  const [savingBank, setSavingBank] = useState(false);

  // Load profile data on first render
  if (!loaded && user) {
    setLoaded(true);
    supabase.from('profiles').select('first_name, last_name, phone').eq('id', user.id).single()
      .then(({ data }) => {
        if (data) {
          setFirstName(data.first_name || '');
          setLastName(data.last_name || '');
          setWhatsapp(data.phone || '');
        }
      });
    supabase.from('promoters').select('whatsapp_number, instagram_url').eq('id', promoter.id).single()
      .then(({ data }) => {
        if (data) {
          if (data.whatsapp_number) setWhatsapp(data.whatsapp_number);
          if (data.instagram_url) setInstagram(data.instagram_url);
        }
      });
  }

  function generatePromoCode(first: string, last: string): string {
    const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    const f = clean(first);
    const l = clean(last);
    if (!f) return '';
    return f + (l ? l[0] : '');
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const { error: profErr } = await supabase.from('profiles').update({
        first_name: firstName || null,
        last_name: lastName || null,
      }).eq('id', user.id);
      if (profErr) throw profErr;

      const newCode = generatePromoCode(firstName, lastName);
      const updateData: Record<string, any> = {
        instagram_url: instagram || null,
        whatsapp_number: whatsapp || null,
      };

      if (newCode) {
        const { data: existing } = await supabase.from('promoters')
          .select('id')
          .ilike('promo_code', newCode)
          .neq('user_id', user.id)
          .limit(1);

        if (existing && existing.length > 0) {
          let suffix = 2;
          let uniqueCode = `${newCode}${suffix}`;
          while (true) {
            const { data: check } = await supabase.from('promoters')
              .select('id')
              .ilike('promo_code', uniqueCode)
              .neq('user_id', user.id)
              .limit(1);
            if (!check || check.length === 0) break;
            suffix++;
            uniqueCode = `${newCode}${suffix}`;
          }
          updateData.promo_code = uniqueCode;
        } else {
          updateData.promo_code = newCode;
        }
      }

      const { error: promErr } = await supabase.from('promoters').update(updateData as TablesUpdate<'promoters'>).eq('user_id', user.id);
      if (promErr) throw promErr;

      toast.success('Profil mis à jour');
      onSaved?.();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  const handleOpenIbanDialog = () => {
    setNewIban(globalIban);
    setNewBic(globalBic);
    setConfirmOldIban('');
    setShowIbanDialog(true);
  };

  const handleSaveBankInfo = async () => {
    if (globalIban && confirmOldIban !== globalIban) {
      toast.error(t('promoter.oldIbanMismatch'));
      return;
    }
    setSavingBank(true);
    try {
      const updates = allProfiles.map(p =>
        supabase.from('promoters').update({ iban: newIban || null, bic: newBic || null }).eq('id', p.id)
      );
      const results = await Promise.all(updates);
      const firstError = results.find(r => r.error)?.error;
      if (firstError) throw firstError;
      onSaved?.();
      setShowIbanDialog(false);
      toast.success(t('promoter.bankInfoSaved'));
    } catch {
      toast.error(t('promoter.saveError'));
    } finally {
      setSavingBank(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Profile */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Mon profil
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <ProfilePhotoUpload
              currentImageUrl={promoter.profile_image_url}
              onUpload={async (url) => {
                const { error } = await supabase.from('promoters').update({ profile_image_url: url }).eq('user_id', user!.id);
                if (error) { toast.error('Erreur lors de la sauvegarde'); return; }
                onSaved?.();
              }}
              size="lg"
              fallback={firstName?.[0] || promoter.promo_code[0]}
            />
            <div className="flex-1">
              <p className="text-sm font-medium">Photo de profil</p>
              <p className="text-xs text-muted-foreground">Visible sur votre page promoteur</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Prénom</Label>
              <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Paul" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nom</Label>
              <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Dupont" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Instagram className="h-3 w-3" /> Instagram
            </Label>
            <Input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="https://instagram.com/..." />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </Label>
            <Input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+33612345678" />
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            {saving ? '...' : 'Enregistrer'}
          </Button>
        </CardContent>
      </Card>

      {/* Banking Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4" /> {t('promoter.bankInfo')}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t('promoter.sharedBetweenClubs')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">{t('promoter.currentIban')}</Label>
            <Input value={globalIban || t('promoter.notProvided')} readOnly className="text-sm font-mono bg-muted" />
          </div>
          {globalBic && (
            <div className="space-y-2">
              <Label className="text-xs">BIC</Label>
              <Input value={globalBic} readOnly className="text-sm font-mono bg-muted" />
            </div>
          )}
          <Button onClick={handleOpenIbanDialog} variant="outline" className="w-full">
            {globalIban ? t('promoter.modifyIban') : t('promoter.addIban')}
          </Button>
        </CardContent>
      </Card>

      {/* IBAN Dialog */}
      <Dialog open={showIbanDialog} onOpenChange={setShowIbanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {globalIban && <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {globalIban ? t('promoter.modifyIbanTitle') : t('promoter.addIbanTitle')}
            </DialogTitle>
            <DialogDescription>
              {globalIban ? t('promoter.modifyIbanDesc') : t('promoter.addIbanDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {globalIban && (
              <div className="space-y-2">
                <Label>{t('promoter.confirmOldIban')}</Label>
                <Input value={confirmOldIban} onChange={(e) => setConfirmOldIban(e.target.value)} placeholder={t('promoter.enterOldIban')} className="font-mono" />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('promoter.newIban')}</Label>
              <Input value={newIban} onChange={(e) => setNewIban(e.target.value)} placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX" className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>{t('promoter.bicOptional')}</Label>
              <Input value={newBic} onChange={(e) => setNewBic(e.target.value)} placeholder="BNPAFRPP" className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIbanDialog(false)}>{t('promoter.cancel')}</Button>
            <Button onClick={handleSaveBankInfo} disabled={savingBank || (!!globalIban && !confirmOldIban) || !newIban}>
              {savingBank ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('promoter.registering')}</>) : t('promoter.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
