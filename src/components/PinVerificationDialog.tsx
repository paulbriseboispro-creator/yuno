import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { KeyRound } from 'lucide-react';

interface PinVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerify: (pin: string) => Promise<boolean>;
}

export function PinVerificationDialog({ open, onOpenChange, onVerify }: PinVerificationDialogProps) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async () => {
    if (pin.length !== 6) {
      setError('Le code PIN doit contenir 6 chiffres');
      return;
    }

    setLoading(true);
    setError('');

    const isValid = await onVerify(pin);
    
    setLoading(false);

    if (!isValid) {
      setError('Code PIN invalide');
      setPin('');
    } else {
      setPin('');
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    setPin('');
    setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Vérification Barman
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="pin">Code PIN Employé</Label>
            <Input
              id="pin"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
              placeholder="123456"
              className="text-center text-2xl tracking-widest"
            />
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Annuler
            </Button>
            <Button onClick={handleVerify} disabled={loading || pin.length !== 6} className="flex-1">
              {loading ? 'Vérification...' : 'Vérifier'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
