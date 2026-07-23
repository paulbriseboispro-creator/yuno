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

export type TrackedOwnerKind = 'venue' | 'organizer' | 'promoter' | 'dj';
export type TrackedTargetKind = 'event' | 'venue' | 'organizer' | 'guestlist';

interface TrackedLinksManagerProps {
  ownerKind: TrackedOwnerKind;
  /** venue text id — required when ownerKind === 'venue' */
  venueId?: string | null;
  /** auth user id — required when ownerKind === 'organizer' */
  organizerUserId?: string | null;
  /** promoters.id — required when ownerKind === 'promoter' */
  promoterId?: string | null;
  /** djs.id — required when ownerKind === 'dj' */
  djId?: string | null;
  /** what the created links point to */
  targetKind: TrackedTargetKind;
  /** required when targetKind === 'event' */
  eventId?: string | null;
  /** required when targetKind === 'venue' */
  targetVenueId?: string | null;
  /** guest_lists.id — required when targetKind === 'guestlist' */
  guestListId?: string | null;
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

/**
 * Origine PUBLIQUE des liens partagés. Jamais `window.location.origin` : dans
 * la WebView Capacitor (apps Pro / B2C) celui-ci vaut `capacitor://localhost`,
 * donc le lien copié depuis le téléphone était inutilisable ailleurs.
 */
const PUBLIC_BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

function genCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function TrackedLinksManager(props: TrackedLinksManagerProps) {
  const { ownerKind, venueId, organizerUserId, promoterId, djId, targetKind, eventId, targetVenueId, guestListId } = props;
  const { t, language } = useLanguage();
  // Une guest list est gratuite : « ventes » et « CA » n'ont pas de sens, la
  // conversion utile est le nombre d'inscrits.
  const isGuestList = targetKind === 'guestlist';

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
      p_dj_id: ownerKind === 'dj' ? djId ?? null : null,
      p_event_id: targetKind === 'event' ? eventId ?? null : null,
      // Scope to this surface: the club/profile page only shows permanent links,
      // not the per-event links auto-seeded for every soirée.
      p_target_kind: targetKind,
      // Une part guest list a ses propres canaux, distincts de ceux de la soirée.
      p_guest_list_id: targetKind === 'guestlist' ? guestListId ?? null : null,
    });
  }, [ownerKind, venueId, organizerUserId, promoterId, djId, targetKind, eventId, guestListId]);

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
    // Idem pour une part de guest list : les 4 canaux naissent tout seuls, le
    // détenteur n'a plus qu'à partager (même promesse que côté soirée).
    if (
      result.length === 0 &&
      targetKind === 'guestlist' && guestListId &&
      autoSeededRef.current !== guestListId
    ) {
      autoSeededRef.current = guestListId;
      const { error: seedErr } = await supabase.rpc('seed_guest_list_tracked_links', { p_guest_list_id: guestListId });
      if (!seedErr) {
        const { data: seeded, error: refetchErr } = await fetchStats();
        if (!refetchErr) result = (seeded ?? []) as LinkRow[];
      }
    }
    // Same self-heal for a club page → one permanent link per channel (one per origin).
    if (
      result.length === 0 &&
      targetKind === 'venue' && ownerKind === 'venue' && venueId &&
      autoSeededRef.current !== venueId
    ) {
      autoSeededRef.current = venueId;
      const { error: seedErr } = await supabase.rpc('seed_venue_tracked_links', { p_venue_id: venueId });
      if (!seedErr) {
        const { data: seeded, error: refetchErr } = await fetchStats();
        if (!refetchErr) result = (seeded ?? []) as LinkRow[];
      }
    }
    setRows(result);
    setLoading(false);
  }, [fetchStats, ownerKind, targetKind, eventId, venueId, guestListId, t]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const linkUrl = (code: string) => `${PUBLIC_BASE_URL}/l/${code}`;

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
    // One link per origin: block a second link for a channel that already exists.
    if (!editing && rows.some((r) => r.label.trim().toLowerCase() === label.toLowerCase())) {
      toast.error(t('tlink.duplicateChannel'));
      return;
    }
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
        dj_id: ownerKind === 'dj' ? djId ?? null : null,
        target_kind: targetKind,
        // Une part guest list garde l'event_id (filtres + lecture), sa cible
        // réelle étant guest_list_id.
        event_id: targetKind === 'event' || targetKind === 'guestlist' ? eventId ?? null : null,
        target_venue_id: targetKind === 'venue' ? targetVenueId ?? null : null,
        guest_list_id: targetKind === 'guestlist' ? guestListId ?? null : null,
        utm_source: label.toLowerCase().replace(/\s+/g, '-'),
        utm_medium: targetKind === 'event' ? 'event_link'
          : targetKind === 'guestlist' ? 'guestlist_link'
          : 'profile_link',
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
                <span className="max-w-full truncate font-semibold text-white">{row.label}</span>

                {/* flex-wrap : à 390px, 4 stats d'affilée (dont un montant à 4 chiffres)
                    dépassaient la carte — la ligne doit pouvoir casser. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
                  <span><span className="text-white/85 font-medium">{row.clicks}</span> {t('tlink.clicks')}</span>
                  <span>
                    <span className="text-white/85 font-medium">{row.conversions}</span>{' '}
                    {isGuestList ? t('tlink.signups') : t('tlink.sales')}
                  </span>
                  {!isGuestList && (
                    <span><span className="text-white/85 font-medium">{currency.format(Number(row.revenue) || 0)}</span> {t('tlink.revenue')}</span>
                  )}
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
