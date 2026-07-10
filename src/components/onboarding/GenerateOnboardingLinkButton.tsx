import { useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2, Copy, Check, Share2, Loader2, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { shareContent } from '@/lib/share';

export type OnboardingRole =
  | 'owner' | 'organizer' | 'barman' | 'bouncer' | 'cloakroom' | 'vip_host' | 'manager' | 'dj' | 'promoter';

interface Props {
  /** Roles this surface is allowed to generate (already scoped by the caller's permissions). */
  roles: OnboardingRole[];
  /** Club scope (mutually exclusive with organizerUserId). */
  venueId?: string | null;
  /** Organizer scope. */
  organizerUserId?: string | null;
  /** Button label override. */
  buttonLabel?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const EXPIRY_OPTIONS = [7, 14, 30, 90];

export function GenerateOnboardingLinkButton({
  roles, venueId, organizerUserId, buttonLabel, variant = 'outline', className, size = 'default',
}: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<OnboardingRole>(roles[0]);
  const [label, setLabel] = useState('');
  const [orgName, setOrgName] = useState(''); // organizer links: name for a personalized onboarding
  const [maxUses, setMaxUses] = useState(''); // blank = unlimited
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwner = role === 'owner'; // ownership transfer is always single-use.

  const roleLabel = (r: OnboardingRole) => t(`join.role.${r}`) || r;

  const reset = () => { setUrl(null); setQr(null); setCopied(false); };

  const generate = async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        // Folded into accept-staff-invitation (edge-function cap forbids new fns).
        action: 'create_onboarding_link',
        role,
        venue_id: venueId ?? undefined,
        organizer_user_id: organizerUserId ?? undefined,
        label: label.trim() || undefined,
        expires_in_days: expiresInDays,
        max_uses: isOwner ? 1 : (maxUses.trim() ? Math.max(1, parseInt(maxUses, 10) || 1) : null),
        // Organizer links carry the org name so the invitee lands on a personalized onboarding.
        config: role === 'organizer' && orgName.trim() ? { organization_name: orgName.trim() } : undefined,
      };
      const { data, error } = await supabase.functions.invoke('accept-staff-invitation', { body });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setUrl(data.url);
      const dataUrl = await QRCode.toDataURL(data.url, { width: 320, margin: 1 });
      setQr(dataUrl);
    } catch (err) {
      console.error('create-onboarding-link error:', err);
      toast.error(err instanceof Error ? err.message : t('genLink.error'));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('genLink.copied'));
      setTimeout(() => setCopied(false), 1800);
    } catch { toast.error(t('genLink.copyFailed')); }
  };

  const share = async () => {
    if (!url) return;
    const outcome = await shareContent({ title: 'Yuno', text: t('genLink.shareText'), url });
    if (outcome === 'copied') copy();
  };

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => { reset(); setOpen(true); }}>
        <Link2 className="h-4 w-4 mr-2" />
        {buttonLabel || t('genLink.button')}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('genLink.title')}</DialogTitle>
            <DialogDescription>{t('genLink.subtitle')}</DialogDescription>
          </DialogHeader>

          {!url ? (
            <div className="space-y-4">
              {roles.length > 1 && (
                <div>
                  <Label>{t('genLink.role')}</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as OnboardingRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {role === 'organizer' && (
                <div>
                  <Label>{t('genLink.orgName')}</Label>
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={t('genLink.orgNamePh')} />
                  <p className="text-[11px] text-muted-foreground mt-1">{t('genLink.orgNameHint')}</p>
                </div>
              )}

              <div>
                <Label>{t('genLink.label')}</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('genLink.labelPh')} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('genLink.maxUses')}</Label>
                  <Input
                    type="number" min={1} inputMode="numeric"
                    value={isOwner ? '1' : maxUses}
                    disabled={isOwner}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder={t('genLink.unlimited')}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isOwner ? t('genLink.ownerSingleUse') : t('genLink.maxUsesHint')}
                  </p>
                </div>
                <div>
                  <Label>{t('genLink.expiry')}</Label>
                  <Select value={String(expiresInDays)} onValueChange={(v) => setExpiresInDays(parseInt(v, 10))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>{d} {t('genLink.days')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button className="w-full" onClick={generate} disabled={loading || (role === 'organizer' && !orgName.trim())}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
                {t('genLink.generate')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {qr && (
                <div className="flex justify-center">
                  <img src={qr} alt="QR" className="rounded-lg bg-white p-2" width={200} height={200} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input readOnly value={url} className="text-xs" onFocus={(e) => e.target.select()} />
                <Button size="icon" variant="outline" onClick={copy}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={share}><Share2 className="h-4 w-4 mr-2" />{t('genLink.share')}</Button>
                <Button className="flex-1" variant="outline" onClick={reset}>{t('genLink.newLink')}</Button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center">{t('genLink.reuseNote')}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default GenerateOnboardingLinkButton;
