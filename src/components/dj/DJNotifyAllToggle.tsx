import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * A2 — superfan opt-in. By default a follower is only notified about a DJ's gigs in
 * their own city (geo-filtered, no spam). This switch lets a fan who travels opt into
 * notifications for ALL of the DJ's gigs. Only rendered when the viewer follows this DJ.
 */
export function DJNotifyAllToggle({ djId }: { djId: string }) {
  const { isFavorite } = useFavorites();
  const { user } = useAuth();
  const { t } = useLanguage();
  const following = isFavorite('dj', djId);

  const [allLocations, setAllLocations] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!following || !user) return;
    (async () => {
      const { data } = await supabase
        .from('favorites')
        .select('notify_all_locations')
        .eq('user_id', user.id)
        .eq('dj_id', djId)
        .eq('favorite_type', 'dj')
        .maybeSingle();
      if (active) setAllLocations(!!(data as { notify_all_locations?: boolean } | null)?.notify_all_locations);
    })();
    return () => { active = false; };
  }, [following, user, djId]);

  if (!following || !user) return null;

  const handleToggle = async (val: boolean) => {
    setAllLocations(val);
    setSaving(true);
    try {
      await supabase
        .from('favorites')
        .update({ notify_all_locations: val } as never)
        .eq('user_id', user.id)
        .eq('dj_id', djId)
        .eq('favorite_type', 'dj');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
      <Switch
        id={`notify-all-${djId}`}
        checked={allLocations}
        onCheckedChange={handleToggle}
        disabled={saving}
      />
      <label
        htmlFor={`notify-all-${djId}`}
        className="flex items-center gap-1.5 cursor-pointer"
        style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.02em' }}
      >
        <Bell className="h-3 w-3" />
        {t('djPublic.notifyAll')}
      </label>
    </div>
  );
}

export default DJNotifyAllToggle;
