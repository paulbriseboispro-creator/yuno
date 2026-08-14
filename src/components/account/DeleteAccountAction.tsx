import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { toast } from 'sonner';

/**
 * Suppression de compte in-app — exigence App Store 5.1.1(v), qui vaut pour
 * TOUTE app permettant de créer un compte. L'app Yuno Pro propose l'inscription
 * sur son écran de connexion : elle doit donc offrir la suppression, au même
 * titre que l'app client. Un seul composant pour les deux, sinon les deux
 * chemins divergent et l'un des deux finit par mentir.
 *
 * `variant` habille le déclencheur selon la surface d'accueil ('sidebar' pour
 * les cockpits promoteur / DJ / agence, 'row' pour la fiche compte du staff,
 * 'button' pour la page Réglages client) ; la logique, elle, reste unique.
 */
type Variant = 'sidebar' | 'row' | 'button';

const BLOCKED_KEYS: Record<string, string> = {
  owns_venue: 'settings.deleteBlockedVenue',
  owns_agency: 'settings.deleteBlockedAgency',
  active_purchases: 'settings.deleteBlockedPurchases',
};

export function DeleteAccountAction({
  variant = 'button',
  pro = false,
  redirectTo = '/',
}: {
  variant?: Variant;
  /** Corps de confirmation orienté compte professionnel (club, promoteur, DJ). */
  pro?: boolean;
  redirectTo?: string;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const word = t('settings.deleteConfirmWord');
  const label = t('settings.deleteAccount');

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account');
      if (error) throw error;
      if (data?.error) throw Object.assign(new Error(data.error), { code: data.code });
      toast.success(t('settings.deleteSuccess'));
      await supabase.auth.signOut();
      navigate(redirectTo);
    } catch (error) {
      // supabase-js enveloppe les réponses non-2xx : le motif réel (et son code
      // traduisible) vit dans le corps, pas dans error.message.
      let msg = error instanceof Error ? error.message : t('settings.deleteError');
      let code = (error as { code?: string })?.code;
      try {
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string; code?: string }> } })?.context;
        if (ctx?.json) {
          const body = await ctx.json();
          if (body?.code) code = body.code;
          if (body?.error) msg = body.error;
        }
      } catch { /* garder msg */ }
      if (code && BLOCKED_KEYS[code]) msg = t(BLOCKED_KEYS[code]);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const openDialog = () => { setConfirmText(''); setOpen(true); };

  const trigger =
    variant === 'sidebar' ? (
      <SidebarMenuItem>
        <SidebarMenuButton onClick={openDialog} className="text-muted-foreground" size="sm">
          <Trash2 />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ) : variant === 'row' ? (
      <button
        type="button"
        onClick={openDialog}
        className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.03]"
        style={{ border: '1px solid rgba(255,255,255,0.085)' }}
      >
        <Trash2 className="h-4 w-4 flex-none" style={{ color: 'rgba(255,255,255,0.58)' }} />
        <span className="flex-1 text-left" style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13.5 }}>{label}</span>
      </button>
    ) : (
      <Button variant="ghost" className="w-full text-muted-foreground hover:text-destructive" onClick={openDialog}>
        <Trash2 className="h-4 w-4 mr-2" />
        {label}
      </Button>
    );

  return (
    <>
      {trigger}
      {/* Ancré en haut sur mobile : centré, le clavier iOS fait défiler la page et
          le dialogue passe sous le clavier pendant la saisie du mot de confirmation. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-6 translate-y-0 sm:top-[50%] sm:translate-y-[-50%]">
          <DialogHeader>
            <DialogTitle>{t('settings.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t(pro ? 'settings.deleteConfirmBodyPro' : 'settings.deleteConfirmBody')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="delete_confirm" className="text-xs">
                {t('settings.deleteConfirmLabel').replace('{word}', word)}
              </Label>
              <Input
                id="delete_confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={word}
                autoComplete="off"
                className="mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('profile.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={deleting || confirmText.trim().toUpperCase() !== word.toUpperCase()}
                onClick={handleDelete}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                {t('settings.deleteConfirmCta')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
