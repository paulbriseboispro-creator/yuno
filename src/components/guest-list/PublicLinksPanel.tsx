import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, Plus, Share2, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildShareLink } from '@/lib/guestListShare';
import { shareContent } from '@/lib/share';

interface ShareLinkRow {
  id: string;
  label: string;
  token: string;
  is_active: boolean;
  created_at: string;
}

interface PublicLinksPanelProps {
  guestListId: string;
  /** Token de la part — base de tous les liens publics. */
  shareToken: string;
  slug: string;
  eventId: string;
  /** false quand la surface affiche déjà le lien principal ailleurs (PartCard, DJ). */
  showMainLink?: boolean;
}

/**
 * Lien public de la part + liens PAR CANAL (Instagram, WhatsApp, story…).
 * Chaque canal est un token distinct greffé sur le lien de la part (?s=), donc
 * même offre de types, mais les inscriptions sont attribuées au canal — c'est
 * ce qui permet à un promoteur de savoir quel réseau lui rapporte.
 */
export function PublicLinksPanel({ guestListId, shareToken, slug, eventId, showMainLink = true }: PublicLinksPanelProps) {
  const { t } = useLanguage();
  const [links, setLinks] = useState<ShareLinkRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: statRows }] = await Promise.all([
      supabase
        .from('guest_list_share_links')
        .select('id, label, token, is_active, created_at')
        .eq('guest_list_id', guestListId)
        .order('created_at', { ascending: true }),
      supabase.rpc('get_guest_list_share_link_stats', { _guest_list_id: guestListId }),
    ]);
    setLinks((rows as ShareLinkRow[]) || []);
    const tally: Record<string, number> = {};
    ((statRows as { share_link_id: string; signups: number }[]) || []).forEach(r => {
      tally[r.share_link_id] = r.signups;
    });
    setStats(tally);
  }, [guestListId]);

  useEffect(() => { load(); }, [load]);

  const linkUrl = (sourceToken?: string) =>
    buildShareLink({ slug, eventId, token: shareToken, sourceToken });

  const handleCopy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error(t('glTools.segmentCreateError'));
    }
  };

  const handleShare = async (key: string, url: string) => {
    const outcome = await shareContent({ title: 'Yuno', url });
    if (outcome === 'copied') await handleCopy(key, url);
  };

  const handleCreate = async () => {
    const clean = label.trim();
    if (!clean) {
      toast.error(t('glTools.segmentLabelRequired'));
      return;
    }
    setCreating(true);
    const { error } = await supabase
      .from('guest_list_share_links')
      .insert({ guest_list_id: guestListId, label: clean });
    setCreating(false);
    if (error) {
      toast.error(t('glTools.segmentCreateError'));
      return;
    }
    toast.success(t('glTools.segmentCreated'));
    setLabel('');
    setShowForm(false);
    await load();
  };

  const handleDelete = async (link: ShareLinkRow) => {
    const { error } = await supabase.from('guest_list_share_links').delete().eq('id', link.id);
    if (error) {
      toast.error(t('glTools.segmentCreateError'));
      return;
    }
    toast.success(t('glTools.segmentDeleted'));
    await load();
  };

  return (
    <div className="mt-3">
      {showMainLink && (
        <div className="mb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 text-primary" />
            {t('glTools.publicLink')}
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={linkUrl().replace(/^https?:\/\//, '')}
              className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 font-mono text-[11px] text-muted-foreground outline-none"
            />
            <button type="button" onClick={() => handleCopy('main', linkUrl())}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
              {copied === 'main' ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => handleShare('main', linkUrl())}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/70">{t('glTools.publicLinkHint')}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Share2 className="h-3.5 w-3.5 text-primary" />
          {t('glTools.segmentedLinks')}
        </p>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowForm(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('glTools.newSegment')}
        </Button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground/70">{t('glTools.segmentedLinksDesc')}</p>

      {showForm && (
        <div className="mt-2 space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div>
            <Label className="text-xs">{t('glTools.segmentLabel')}</Label>
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              maxLength={60}
              placeholder={t('glTools.segmentLabelPlaceholder')}
              className="h-9"
            />
          </div>
          <Button onClick={handleCreate} disabled={creating || !label.trim()} size="sm" className="w-full">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            {t('glTools.createSegment')}
          </Button>
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {links.map(link => (
            <div key={link.id} className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{link.label}</p>
                  <p className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                    <Users className="h-3 w-3" />
                    {stats[link.id] ?? 0} {t('glTools.signupsLabel')}
                  </p>
                </div>
                <button type="button" onClick={() => handleCopy(link.id, linkUrl(link.token))}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
                  {copied === link.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => handleShare(link.id, linkUrl(link.token))}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
                  <Share2 className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => handleDelete(link)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
