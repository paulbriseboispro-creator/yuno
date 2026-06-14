import { Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';

export const CGV_VERSION = '2025-03-01';

interface CGVCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function CGVCheckbox({ checked, onCheckedChange }: CGVCheckboxProps) {
  const { t } = useLanguage();

  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className="flex items-center gap-2.5 w-full text-left py-1"
    >
      <span
        className={[
          'shrink-0 h-5 w-5 rounded-md border flex items-center justify-center transition-colors',
          checked
            ? 'bg-primary border-primary'
            : 'bg-transparent border-white/30',
        ].join(' ')}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      <span className="text-sm text-white/70 leading-snug" onClick={(e) => e.stopPropagation()}>
        {t('cgv.acceptText')}{' '}
        <a
          href="/legal/cgv-utilisateurs"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary/80"
          onClick={(e) => e.stopPropagation()}
        >
          {t('cgv.linkText')}
        </a>
      </span>
    </button>
  );
}

/** Record CGV acceptance in database. Returns the acceptance ID. */
export async function recordCgvAcceptance(params: {
  userId: string | null;
  userEmail: string;
  orderType: 'drink' | 'ticket' | 'table';
  referenceId?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('cgv_acceptances' as any)
      .insert({
        user_id: params.userId,
        user_email: params.userEmail,
        cgv_version: CGV_VERSION,
        order_type: params.orderType,
        reference_id: params.referenceId || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('CGV acceptance recording error:', error);
      return null;
    }
    return (data as any)?.id || null;
  } catch (err) {
    console.error('CGV acceptance error:', err);
    return null;
  }
}

/** Update the reference_id on an existing CGV acceptance record */
export async function updateCgvReference(acceptanceId: string, referenceId: string) {
  try {
    await supabase
      .from('cgv_acceptances' as any)
      .update({ reference_id: referenceId })
      .eq('id', acceptanceId);
  } catch (err) {
    console.error('CGV reference update error:', err);
  }
}
