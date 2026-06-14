import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ScarcitySettings {
  id?: string;
  event_id: string;
  low_stock_enabled: boolean;
  low_stock_percent: number;
  low_stock_label: string;
  emoji_enabled: boolean;
  show_remaining_count: boolean;
  display_cap_enabled: boolean;
  display_cap_value: number | null;
  display_caps_per_round: Record<string, number> | null;
}

const DEFAULT_SETTINGS: Omit<ScarcitySettings, 'event_id'> = {
  low_stock_enabled: true,
  low_stock_percent: 80,
  low_stock_label: 'few_left',
  emoji_enabled: true,
  show_remaining_count: false,
  display_cap_enabled: false,
  display_cap_value: null,
  display_caps_per_round: null,
};

export function useScarcitySettings(eventId: string | null) {
  const [settings, setSettings] = useState<ScarcitySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const mapData = (data: any): ScarcitySettings => ({
    id: data.id,
    event_id: data.event_id,
    low_stock_enabled: data.low_stock_enabled ?? true,
    low_stock_percent: data.low_stock_percent ?? 80,
    low_stock_label: data.low_stock_label ?? 'few_left',
    emoji_enabled: data.emoji_enabled ?? true,
    show_remaining_count: data.show_remaining_count ?? false,
    display_cap_enabled: data.display_cap_enabled ?? false,
    display_cap_value: data.display_cap_value,
    display_caps_per_round: data.display_caps_per_round ?? null,
  });

  const fetchSettings = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from('event_scarcity_settings')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle() as any);

      if (error) throw error;
      if (data) {
        setSettings(mapData(data));
      } else {
        setSettings({ ...DEFAULT_SETTINGS, event_id: eventId });
      }
    } catch (e) {
      console.error('Error fetching scarcity settings:', e);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = useCallback(async (updated: Partial<ScarcitySettings>) => {
    if (!eventId) return;
    setSaving(true);
    try {
      const payload: any = {
        event_id: eventId,
        low_stock_enabled: updated.low_stock_enabled ?? settings?.low_stock_enabled ?? true,
        low_stock_percent: updated.low_stock_percent ?? settings?.low_stock_percent ?? 80,
        low_stock_label: updated.low_stock_label ?? settings?.low_stock_label ?? 'few_left',
        emoji_enabled: updated.emoji_enabled ?? settings?.emoji_enabled ?? true,
        show_remaining_count: updated.show_remaining_count ?? settings?.show_remaining_count ?? false,
        display_cap_enabled: updated.display_cap_enabled ?? settings?.display_cap_enabled ?? false,
        display_cap_value: updated.display_cap_value !== undefined ? updated.display_cap_value : (settings?.display_cap_value ?? null),
        display_caps_per_round: updated.display_caps_per_round !== undefined ? updated.display_caps_per_round : (settings?.display_caps_per_round ?? null),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await (supabase
        .from('event_scarcity_settings')
        .upsert(payload, { onConflict: 'event_id' })
        .select()
        .single() as any);

      if (error) throw error;
      setSettings(mapData(data));
    } catch (e) {
      console.error('Error saving scarcity settings:', e);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [eventId, settings]);

  return { settings, loading, saving, saveSettings, refetch: fetchSettings };
}

/** Lightweight hook for customer-facing pages - fetches read-only scarcity settings */
export function useEventScarcity(eventId: string | undefined | null) {
  const [settings, setSettings] = useState<ScarcitySettings | null>(null);

  useEffect(() => {
    if (!eventId) return;
    supabase
      .from('event_scarcity_settings')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const d = data as any;
          setSettings({
            id: d.id,
            event_id: d.event_id,
            low_stock_enabled: d.low_stock_enabled ?? true,
            low_stock_percent: d.low_stock_percent ?? 80,
            low_stock_label: d.low_stock_label ?? 'few_left',
            emoji_enabled: d.emoji_enabled ?? true,
            show_remaining_count: d.show_remaining_count ?? false,
            display_cap_enabled: d.display_cap_enabled ?? false,
            display_cap_value: d.display_cap_value,
            display_caps_per_round: d.display_caps_per_round ?? null,
          });
        }
      });
  }, [eventId]);

  return settings;
}
