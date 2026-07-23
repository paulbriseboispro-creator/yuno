import { useState } from 'react';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildShareLink } from '@/lib/guestListShare';
import { shareContent } from '@/lib/share';
import TrackedLinksManager, { type TrackedOwnerKind } from '@/components/tracking/TrackedLinksManager';

interface PublicLinksPanelProps {
  guestListId: string;
  /** Token de la part — base du lien public brut. */
  shareToken: string;
  slug: string;
  eventId: string;
  /** false quand la surface affiche déjà le lien principal ailleurs (PartCard, DJ). */
  showMainLink?: boolean;
  /** Détenteur de la part — gouverne à qui appartiennent les liens par canal. */
  ownerKind: TrackedOwnerKind;
  venueId?: string | null;
  organizerUserId?: string | null;
  promoterId?: string | null;
  djId?: string | null;
}

/**
 * Partage d'une part de guest list :
 *  - le lien public brut (copier / partager) ;
 *  - les liens PAR CANAL, qui réutilisent le système `tracked_links` déjà en
 *    place pour les soirées : les quatre canaux naissent tout seuls, les clics,
 *    inscriptions et taux de conversion sont suivis, et un lien de promoteur
 *    réinjecte son code de parrainage (donc sa commission) à l'arrivée.
 */
export function PublicLinksPanel({
  guestListId, shareToken, slug, eventId, showMainLink = true,
  ownerKind, venueId, organizerUserId, promoterId, djId,
}: PublicLinksPanelProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const url = buildShareLink({ slug, eventId, token: shareToken });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('tlink.copyError'));
    }
  };

  const handleShare = async () => {
    const outcome = await shareContent({ title: 'Yuno', url });
    if (outcome === 'copied') await handleCopy();
  };

  return (
    <div className="mt-3">
      {showMainLink && (
        <div className="mb-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 text-primary" />
            {t('glTools.publicLink')}
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url.replace(/^https?:\/\//, '')}
              className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 font-mono text-[11px] text-muted-foreground outline-none"
            />
            <button type="button" onClick={handleCopy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={handleShare}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground">
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/70">{t('glTools.publicLinkHint')}</p>
        </div>
      )}

      <TrackedLinksManager
        ownerKind={ownerKind}
        venueId={venueId}
        organizerUserId={organizerUserId}
        promoterId={promoterId}
        djId={djId}
        targetKind="guestlist"
        guestListId={guestListId}
        eventId={eventId}
      />
    </div>
  );
}
