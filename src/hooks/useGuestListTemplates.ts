import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TemplateHolderType = 'club' | 'dj' | 'promoter';
export type TargetMode = 'all' | 'select' | 'agency';
export type EntryKind = 'normal' | 'drink' | 'table';

export interface GuestListTemplate {
  id: string;
  name: string;
  holder_type: TemplateHolderType;
  is_default: boolean;
  /** Distribution target: DJ → all|select ; promoter → all|select|agency ; club → all. */
  target_mode: TargetMode;
  /** Default/primary entry kind (back-compat). The real allocation is the per-type quotas. */
  entry_kind: EntryKind;
  /** Total = quota_normal + quota_drink + quota_table. */
  quota: number;
  quota_normal: number;
  quota_drink: number;
  quota_table: number;
  quota_female: number | null;
  quota_male: number | null;
  free_before_time: string;
  entry_deadline: string | null;
  includes_drink: boolean;
  visible_on_club_page: boolean;
}

/** The editor's input — everything but the row id. */
export type TemplateInput = Omit<GuestListTemplate, 'id'>;

interface Ctx { isOrganizerScope: boolean; venueId: string | null; organizerUserId: string | null }

const COLS = 'id, name, holder_type, is_default, target_mode, entry_kind, quota, quota_normal, quota_drink, quota_table, quota_female, quota_male, free_before_time, entry_deadline, includes_drink, visible_on_club_page';

/** Reusable, typed guest-list presets (club / DJ / promoter), scoped to the venue or organizer. */
export function useGuestListTemplates(ctx: Ctx) {
  const [templates, setTemplates] = useState<GuestListTemplate[]>([]);
  const ready = ctx.isOrganizerScope ? !!ctx.organizerUserId : !!ctx.venueId;

  const load = useCallback(async () => {
    if (!ready) { setTemplates([]); return; }
    const q = supabase.from('guest_list_templates').select(COLS).order('created_at', { ascending: true });
    const { data } = ctx.isOrganizerScope
      ? await q.eq('organizer_user_id', ctx.organizerUserId as string)
      : await q.eq('venue_id', ctx.venueId as string);
    setTemplates((data || []) as GuestListTemplate[]);
  }, [ready, ctx.isOrganizerScope, ctx.organizerUserId, ctx.venueId]);

  useEffect(() => { load(); }, [load]);

  // Only one default preset per (scope, holder_type): clear the others before setting one.
  const clearDefaults = useCallback(async (holderType: TemplateHolderType) => {
    const q = supabase.from('guest_list_templates').update({ is_default: false }).eq('holder_type', holderType).eq('is_default', true);
    if (ctx.isOrganizerScope) await q.eq('organizer_user_id', ctx.organizerUserId as string);
    else await q.eq('venue_id', ctx.venueId as string);
  }, [ctx.isOrganizerScope, ctx.organizerUserId, ctx.venueId]);

  const createTemplate = useCallback(async (input: TemplateInput) => {
    if (input.is_default) await clearDefaults(input.holder_type);
    const scope = ctx.isOrganizerScope
      ? { organizer_user_id: ctx.organizerUserId, venue_id: null }
      : { venue_id: ctx.venueId, organizer_user_id: null };
    const { error } = await supabase.from('guest_list_templates').insert({ ...scope, ...input });
    if (error) throw error;
    await load();
  }, [ctx.isOrganizerScope, ctx.organizerUserId, ctx.venueId, clearDefaults, load]);

  const updateTemplate = useCallback(async (id: string, input: TemplateInput) => {
    if (input.is_default) await clearDefaults(input.holder_type);
    const { error } = await supabase.from('guest_list_templates').update(input).eq('id', id);
    if (error) throw error;
    await load();
  }, [clearDefaults, load]);

  const deleteTemplate = useCallback(async (id: string) => {
    const { error } = await supabase.from('guest_list_templates').delete().eq('id', id);
    if (error) throw error;
    await load();
  }, [load]);

  return { templates, createTemplate, updateTemplate, deleteTemplate, reload: load };
}
