import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { PCard, T1, T3 } from '@/components/dj/dj-ui';
import { DJPayoutFields, djPayoutErrorKey } from '@/components/dj/DJSetPayout';
import { formatIban, isValidIban, normalizeIban } from '@/lib/djPayout';

/**
 * L'IBAN du DJ, une fois pour toutes ses fiches (un DJ a une fiche par club /
 * organisateur, un seul compte en banque). Un club ou un organisateur qui le
 * programme le voit pré-rempli au moment d'ajouter son set.
 */
export function DJBankDetailsCard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<{ holder: string; iban: string } | null>(null);
  const [holder, setHolder] = useState('');
  const [iban, setIban] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('dj_payout_details').select('holder_name, iban').eq('user_id', user.id).maybeSingle();
      if (cancelled) return;
      if (data) {
        setSaved({ holder: data.holder_name, iban: data.iban });
        setHolder(data.holder_name);
        setIban(formatIban(data.iban));
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const valid = holder.trim().length > 0 && isValidIban(iban);

  const save = async () => {
    if (!user || !valid) return;
    setBusy(true);
    try {
      const row = { user_id: user.id, holder_name: holder.trim(), iban: normalizeIban(iban) };
      const { error } = await supabase.from('dj_payout_details').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      setSaved({ holder: row.holder_name, iban: row.iban });
      setIban(formatIban(row.iban));
      setEditing(false);
      toast.success(t('djPay.saved'));
    } catch (e) {
      toast.error(t(djPayoutErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  const showForm = editing || !saved;

  return (
    <PCard icon={<Landmark className="w-4 h-4" />} title={t('djPay.bankTitle')} sub={t('djPay.bankDesc')}>
      {showForm ? (
        <div className="space-y-3">
          <DJPayoutFields holder={holder} iban={iban} onHolder={setHolder} onIban={setIban} />
          <div className="flex justify-end gap-2">
            {saved && (
              <Button variant="outline" disabled={busy} onClick={() => { setEditing(false); setHolder(saved.holder); setIban(formatIban(saved.iban)); }}>
                {t('djPay.cancel')}
              </Button>
            )}
            <Button onClick={save} disabled={busy || !valid}>{busy ? '…' : t('djPay.save')}</Button>
          </div>
          {!saved && <p className="text-xs" style={{ color: T3 }}>{t('djPay.bankEmpty')}</p>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-[560] truncate" style={{ color: T1 }}>{saved.holder}</p>
            <p className="text-sm font-mono tracking-wide" style={{ color: T3 }}>{formatIban(saved.iban)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t('djPay.edit')}</Button>
        </div>
      )}
    </PCard>
  );
}
