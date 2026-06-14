import { useState, useEffect } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface AgeGateProps {
  userId?: string | null;
  onVerified: (verified: boolean) => void;
}

// Age in full years from a YYYY-MM-DD string, or null if unparseable.
function ageFromDate(dateStr: string): number | null {
  const birth = new Date(dateStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function AgeGate({ userId, onVerified }: AgeGateProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(!!userId);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  // A birth date already saved on the profile that belongs to a minor → block, no re-ask.
  const [storedMinor, setStoredMinor] = useState(false);
  const [birthDate, setBirthDate] = useState('');
  const [attestation, setAttestation] = useState(false);
  // The entered date computes to under 18 (or is in the future) → "date not valid".
  const [invalidDate, setInvalidDate] = useState(false);

  // Reuse what's already on the profile: never ask twice for the same person.
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    const check = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('age_verified_at, birth_date')
        .eq('id', userId)
        .single();
      if (data?.age_verified_at) {
        setAlreadyVerified(true);
        onVerified(true);
      } else if (data?.birth_date) {
        const age = ageFromDate(data.birth_date);
        if (age !== null && age >= 18) {
          // Birth date already on file (e.g. set in profile settings) — treat as verified.
          setAlreadyVerified(true);
          onVerified(true);
          supabase.from('profiles').update({ age_verified_at: new Date().toISOString() }).eq('id', userId).then(() => {});
        } else if (age !== null) {
          setStoredMinor(true);
          onVerified(false);
        }
      }
      setLoading(false);
    };
    check();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate age when both fields are set
  useEffect(() => {
    if (alreadyVerified || storedMinor) return;
    if (!birthDate || !attestation) {
      setInvalidDate(false);
      onVerified(false);
      return;
    }
    const age = ageFromDate(birthDate);
    if (age === null || age < 18) {
      setInvalidDate(true);
      onVerified(false);
      return;
    }
    setInvalidDate(false);
    onVerified(true);

    // Save to profile if logged in
    if (userId) {
      supabase
        .from('profiles')
        .update({ birth_date: birthDate, age_verified_at: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) console.error('Age save error:', error);
        });
    }
  }, [birthDate, attestation, alreadyVerified, storedMinor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null;
  // If logged-in user already verified, render nothing
  if (alreadyVerified) return null;

  // A minor's birth date is already on file — block with a clear message, don't re-ask.
  if (storedMinor) {
    return (
      <div className="space-y-2 p-4 rounded-[10px] border border-primary/40 bg-[#141414]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-white">{t('ageGate.title')}</span>
        </div>
        <p className="text-xs text-primary">{t('ageGate.invalidDate')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 rounded-[10px] border border-white/[0.08] bg-[#141414]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-white">{t('ageGate.title')}</span>
        </div>
        <span
          className="font-mono uppercase text-[9px] font-bold tracking-[0.12em] text-primary px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(232,25,44,0.10)' }}
        >
          {t('consent.required')}
        </span>
      </div>
      <div className="space-y-1.5">
        <Label className="font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]">{t('ageGate.birthDate')}</Label>
        <DateInput
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
          className="h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white focus-visible:ring-0 focus-visible:border-primary/50"
        />
        {invalidDate && (
          <p className="text-[11px] text-primary">{t('ageGate.invalidDate')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setAttestation((v) => !v)}
        className="flex items-start gap-3 w-full text-left"
      >
        <span
          className={[
            'shrink-0 mt-0.5 h-5 w-5 rounded-[4px] border flex items-center justify-center transition-colors',
            attestation ? 'bg-primary border-primary' : 'bg-transparent border-white/25',
          ].join(' ')}
        >
          {attestation && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
        <span className="text-xs text-[#9A9A9A] leading-relaxed">
          {t('ageGate.attestation')}
        </span>
      </button>
    </div>
  );
}
