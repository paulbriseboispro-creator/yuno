import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface AgeVerificationDialogProps {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
}

export const AgeVerificationDialog = ({ open, onVerified, onCancel }: AgeVerificationDialogProps) => {
  const { t } = useLanguage();
  const [birthDate, setBirthDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attestation, setAttestation] = useState(false);

  const handleVerify = async () => {
    if (!birthDate) {
      toast.error(t('ageVerification.errorInvalidDate'));
      return;
    }

    if (!attestation) {
      toast.error(t('ageVerification.attestationRequired'));
      return;
    }

    const birth = new Date(birthDate);
    const today = new Date();

    if (birth > today) {
      toast.error(t('ageVerification.errorFutureDate'));
      return;
    }

    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    if (age < 18) {
      toast.error(t('ageVerification.errorUnderage'));
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from('profiles')
        .update({
          birth_date: birthDate,
          age_verified_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      toast.success(t('ageVerification.verified'));
      setTimeout(() => {
        onVerified();
      }, 100);
    } catch (error) {
      console.error('Error verifying age:', error);
      toast.error(t('ageVerification.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ageVerification.title')}</DialogTitle>
          <DialogDescription>
            {t('ageVerification.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="birthDate">{t('ageVerification.birthDateLabel')}</Label>
            <Input
              id="birthDate"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              required
            />
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={attestation}
              onCheckedChange={(checked) => setAttestation(checked === true)}
              className="mt-0.5"
            />
            <span className="text-xs text-muted-foreground leading-relaxed">
              {t('ageVerification.attestation')}
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('ageVerification.cancel')}
          </Button>
          <Button
            onClick={handleVerify}
            disabled={isSubmitting || !birthDate || !attestation}
          >
            {t('ageVerification.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
