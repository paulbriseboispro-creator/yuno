import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, BookMarked, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { fmtEuro } from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

interface GuestProfile {
  ok: boolean;
  nights: number;
  reservations: number;
  last_seen: string | null;
  days_since_last: number | null;
  lifetime_value: number;
  avg_per_night: number;
  nights_min_met: number;
  favorite_category: string | null;
  top_bottles: { name: string; qty: number; revenue: number }[];
  notes: { note: string; note_type: string; created_at: string }[];
}

interface GuestProfileCardProps {
  venueId: string;
  userId?: string | null;
  email?: string | null;
}

/**
 * Black book : la fiche 360° du client, servie par le RPC agrégé
 * get_vip_guest_profile (jamais de PII ligne à ligne). Notes maison
 * possibles quand le client a un compte.
 */
export function GuestProfileCard({ venueId, userId, email }: GuestProfileCardProps) {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_vip_guest_profile', {
        p_venue_id: venueId,
        p_user_id: userId ?? null,
        p_email: email ?? null,
      });
      if (error) throw error;
      setProfile(data as unknown as GuestProfile);
    } catch (error) {
      console.error('get_vip_guest_profile failed:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, userId, email]);

  const saveNote = async () => {
    if (!noteDraft.trim() || !userId) return;
    setSavingNote(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from('vip_customer_notes').insert({
        venue_id: venueId,
        user_id: userId,
        note: noteDraft.trim(),
        note_type: 'general',
        created_by: auth?.user?.id,
      });
      if (error) throw error;
      setNoteDraft('');
      toast.success(t('vipnight.notePersisted'));
      await fetchProfile();
    } catch (error) {
      console.error('save note failed:', error);
      toast.error(t('vipnight.error'));
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  if (!profile || !profile.ok) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: T3 }}>
        {t('vipnight.guestUnavailable')}
      </p>
    );
  }

  const isNew = (profile.nights || 0) <= 1;

  const stat = (label: string, value: string) => (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.032)', border: `1px solid ${BORDER}` }}>
      <p style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 2 }}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {isNew && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.22)' }}
        >
          <BookMarked className="h-4 w-4 shrink-0" style={{ color: '#FCA5A5' }} />
          <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('vipnight.guestNew')}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {stat(t('vipnight.guestVisits'), String(profile.nights || 0))}
        {stat(t('vipnight.guestLifetime'), fmtEuro(profile.lifetime_value || 0))}
        {stat(t('vipnight.guestAvg'), fmtEuro(profile.avg_per_night || 0))}
        {stat(
          t('vipnight.guestLastSeen'),
          profile.days_since_last != null ? t('vipnight.daysAgo').replace('{days}', String(profile.days_since_last)) : '—'
        )}
      </div>

      {profile.favorite_category && (
        <p style={{ color: T2, fontSize: 12.5 }}>
          {t('vipnight.guestFavorite')} :{' '}
          <span style={{ color: T1, fontWeight: 600, textTransform: 'capitalize' }}>{profile.favorite_category}</span>
        </p>
      )}

      {(profile.top_bottles || []).length > 0 && (
        <div>
          <p className="mb-1.5" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {t('vipnight.guestTopBottles')}
          </p>
          <div className="space-y-1">
            {profile.top_bottles.slice(0, 5).map((b, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2">
                <span className="truncate" style={{ color: T2, fontSize: 12.5 }}>
                  <span className="tabular-nums" style={{ color: T3 }}>{b.qty}×</span> {b.name}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: T3, fontSize: 12 }}>{fmtEuro(b.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 flex items-center gap-1" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          <StickyNote className="h-3 w-3" />
          {t('vipnight.guestNotes')}
        </p>
        {(profile.notes || []).length > 0 && (
          <div className="mb-2 space-y-1.5">
            {profile.notes.slice(0, 4).map((n, i) => (
              <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
                <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.45 }}>{n.note}</p>
              </div>
            ))}
          </div>
        )}
        {userId ? (
          <div className="flex gap-2">
            <Input
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder={t('vipnight.addNote')}
              className="h-9 flex-1 text-sm"
            />
            <Button size="sm" className="h-9" disabled={!noteDraft.trim() || savingNote} onClick={saveNote}>
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : t('vipnight.save')}
            </Button>
          </div>
        ) : (
          (profile.notes || []).length === 0 && (
            <p style={{ color: T3, fontSize: 12 }}>—</p>
          )
        )}
      </div>
    </div>
  );
}
