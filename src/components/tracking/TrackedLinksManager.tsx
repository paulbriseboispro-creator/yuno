/**
 * TrackedLinksManager — reusable per-channel tracked-links panel.
 *
 * Lets an owner / organizer / promoter create named links (instagram, tiktok,
 * newsletter, flyer-paris…) pointing to an event, venue or organizer profile,
 * then see clicks + conversions + attributed revenue per link.
 *
 * Used across the Owner, Organizer and Promoter surfaces. Pro dark design
 * system (docs/DESIGN_SYSTEM.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Pencil, Plus, Check, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

export type TrackedOwnerKind = 'venue' | 'organizer' | 'promoter';
export type TrackedTargetKind = 'event' | 'venue' | 'organizer';

interface TrackedLinksManagerProps {
  ownerKind: TrackedOwnerKind;
  /** venue text id — required when ownerKind === 'venue' */
  venueId?: string | null;
  /** auth user id — required when ownerKind === 'organizer' */
  organizerUserId?: string | null;
  /** promoters.id — required when ownerKind === 'promoter' */
  promoterId?: string | null;
  /** what the created links point to */
  targetKind: TrackedTargetKind;
  /** required when targetKind === 'event' */
  eventId?: string | null;
  /** required when targetKind === 'venue' */
  targetVenueId?: string | null;
}

interface LinkRow {
  id: string;
  code: string;
  label: string;
  target_kind: string;
  event_id: string | null;
  is_active: boolean;
  created_at: string;
  clicks: number;
  conversions: number;
  revenue: number;
}

const CHANNEL_PRESETS = ['instagram', 'tiktok', 'newsletter', 'facebook', 'whatsapp', 'flyer', 'snapchat'];

function genCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function TrackedLinksManager(props: TrackedLinksManagerProps) {
  const { ownerKind, venueId, organizerUserId, promoterId, targetKind, eventId, targetVenueId } = props;
  const { t, language } = useLanguage();

  const [rows, setRows] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LinkRow | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [saving, setSaving] = useState(false);
  // Self-heal: auto-seed default channels at most once per event when the list
  // comes back empty (covers events whose trigger seeding silently failed).
  const autoSeededRef = useRef<string | null>(null);

  const currency = useMemo(
    () => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    [language],
  );

  const fetchStats = useCallback(async () => {
    return supabase.rpc('get_tracked_link_stats', {
      p_owner_kind: ownerKind,
      p_venue_id: ownerKind === 'venue' ? venueId ?? null : null,
      p_organizer_user_id: ownerKind === 'organizer' ? organizerUserId ?? null : null,
      p_promoter_id: ownerKind === 'promoter' ? promoterId ?? null : null,
      p_event_id: targetKind === 'event' ? eventId ?? null : null,
    });
  }, [ownerKind, venueId, organizerUserId, promoterId, targetKind, eventId]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchStats();
    if (error) {
      toast.error(t('tlink.loadError'));
      setRows([]);
      setLoading(false);
      return;
    }
    let result = (data ?? []) as LinkRow[];
    // No links for an event the owner controls → seed the defaults once, then refetch.
    if (
      result.length === 0 &&
      targetKind === 'event' && eventId &&
      ownerKind !== 'promoter' &&
      autoSeededRef.current !== eventId
    ) {
      autoSeededRef.current = eventId;
      const { error: seedErr } = await supabase.rpc('seed_event_tracked_links', { p_event_id: eventId });
      if (!seedErr) {
        const { data: seeded, error: refetchErr } = await fetchStats();
        if (!refetchErr) result = (seeded ?? []) as LinkRow[];
      }
    }
    setRows(result);
    setLoading(false);
  }, [fetchStats, ownerKind, targetKind, eventId, t]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const linkUrl = (code: string) => `${window.location.origin}/l/${code}`;

  const copyLink = async (row: LinkRow) => {
    try {
      await navigator.clipboard.writeText(linkUrl(row.code));
      setCopiedId(row.id);
      toast.success(t('tlink.copied'));
      setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1500);
    } catch {
      toast.error(t('tlink.copyError'));
    }
  };

  const openCreate = () => { setEditing(null); setLabelInput(''); setDialogOpen(true); };
  const openEdit = (row: LinkRow) => { setEditing(row); setLabelInput(row.label); setDialogOpen(true); };

  const save = async () => {
    const label = labelInput.trim();
    if (!label) { toast.error(t('tlink.labelRequired')); return; }
    setSaving(true);

    if (editing) {
      const { error } = await supabase.from('tracked_links').update({ label }).eq('id', editing.id);
      if (error) { toast.error(t('tlink.saveError')); setSaving(false); return; }
      toast.success(t('tlink.saved'));
    } else {
      const insert = {
        code: genCode(),
        label,
        owner_kind: ownerKind,
        venue_id: ownerKind === 'venue' ? venueId ?? null : null,
        organizer_user_id: ownerKind === 'organizer' ? organizerUserId ?? null : null,
        promoter_id: ownerKind === 'promoter' ? promoterId ?? null : null,
        target_kind: targetKind,
        event_id: targetKind === 'event' ? eventId ?? null : null,
        target_venue_id: targetKind === 'venue' ? targetVenueId ?? null : null,
        utm_source: label.toLowerCase().replace(/\s+/g, '-'),
        utm_medium: targetKind === 'event' ? 'event_link' : 'profile_link',
      };
      const { error } = await supabase.from('tracked_links').insert(insert);
      if (error) {
        // Extremely rare code collision → retry once.
        if (error.code === '23505') {
          const { error: retryErr } = await supabase.from('tracked_links').insert({ ...insert, code: genCode() });
          if (retryErr) { toast.error(t('tlink.saveError')); setSaving(false); return; }
        } else {
          toast.error(t('tlink.saveError')); setSaving(false); return;
        }
      }
      toast.success(t('tlink.created'));
    }
    setSaving(false);
    setDialogOpen(false);
    fetchRows();
  };

  const remove = async (row: LinkRow) => {
    const { error } = await supabase.from('tracked_links').delete().eq('id', row.id);
    if (error) { toast.error(t('tlink.deleteError')); return; }
    toast.success(t('tlink.deleted'));
    fetchRows();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">{t('tlink.title')}</h3>
        <Button
          onClick={openCreate}
          variant="outline"
          size="sm"
          className="border-white/15 bg-white/5 text-white hover:bg-white/10 uppercase tracking-wider text-xs"
        >
          <Plus className="h-4 w-4 mr-1.5" />{t('tlink.create')}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-5 py-8 text-center text-sm text-white/40">
          {t('tlink.empty')}
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`group rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent px-4 py-3.5 transition-colors hover:border-white/20 ${row.is_active ? '' : 'opacity-50'}`}
            >
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="font-semibold text-white">{row.label}</span>

                <div className="flex items-center gap-4 text-xs text-white/55">
                  <span><span className="text-white/85 font-medium">{row.clicks}</span> {t('tlink.clicks')}</span>
                  <span><span className="text-white/85 font-medium">{row.conversions}</span> {t('tlink.sales')}</span>
                  <span><span className="text-white/85 font-medium">{currency.format(Number(row.revenue) || 0)}</span> {t('tlink.revenue')}</span>
                  <span className="text-white/35">{row.clicks > 0 ? Math.round((row.conversions / row.clicks) * 100) : 0}% {t('tlink.convRate')}</span>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <code className="hidden sm:block max-w-[220px] truncate rounded-md bg-black/30 px-2 py-1 text-xs text-white/45">
                    /l/{row.code}
                  </code>
                  <button onClick={() => copyLink(row)} title={t('tlink.copy')} className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                    {copiedId === row.id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a href={linkUrl(row.code)} target="_blank" rel="noreferrer" title={t('tlink.open')} className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button onClick={() => openEdit(row)} title={t('tlink.edit')} className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(row)} title={t('tlink.delete')} className="rounded-md p-1.5 text-white/50 hover:bg-red-500/15 hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>{editing ? t('tlink.editTitle') : t('tlink.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              autoFocus
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              placeholder={t('tlink.labelPlaceholder')}
              className="bg-white/5 border-white/15 text-white"
            />
            {!editing && (
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setLabelInput(c)}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} className="text-white/60 hover:text-white">
              {t('tlink.cancel')}
            </Button>
            <Button onClick={save} disabled={saving} className="bg-white text-black hover:bg-white/90">
              {saving ? t('tlink.saving') : editing ? t('tlink.save') : t('tlink.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
