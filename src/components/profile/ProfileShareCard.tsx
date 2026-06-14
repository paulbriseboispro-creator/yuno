import { useState } from 'react';
import { motion } from 'framer-motion';
import { Share2, Copy, Check, Flame, MapPin, GlassWater, Calendar } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { UserBadge } from '@/hooks/useNightlifeProfile';

interface ProfileShareCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firstName: string | null;
  avatarUrl: string | null;
  badge: UserBadge;
  nightsAttended: number;
  venuesVisited: number;
  drinksOrdered: number;
  citiesExplored: number;
  currentStreak: number;
  favoriteClub: string | null;
}

const badgeConfig: Record<UserBadge, { label: string; color: string }> = {
  new: { label: 'Newcomer', color: '#9A9A9A' },
  regular: { label: 'Regular', color: '#E8192C' },
  vip: { label: 'VIP', color: '#F0A742' },
};

export function ProfileShareCard({
  open,
  onOpenChange,
  firstName,
  avatarUrl,
  badge,
  nightsAttended,
  venuesVisited,
  drinksOrdered,
  citiesExplored,
  currentStreak,
  favoriteClub,
}: ProfileShareCardProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const shareUrl = window.location.origin + '/profile';

  const shareText = `${firstName || 'Someone'} — ${nightsAttended} ${t('profile.shareNights')}, ${venuesVisited} clubs${currentStreak > 0 ? `, ${currentStreak}🔥` : ''} | Yuno`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${firstName} — Yuno`,
          text: shareText,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    } else {
      handleCopy();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopied(true);
      toast.success(t('profile.shareCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const badgeInfo = badgeConfig[badge];

  return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border/30 bg-background px-4 pb-8 pt-2 max-h-[92vh] overflow-y-auto">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border/50" />
          <SheetHeader className="mb-4">
            <SheetTitle className="text-center font-display font-bold uppercase text-white" style={{ fontSize: '18px', letterSpacing: '-0.01em' }}>
              {t('profile.shareProfile')}
            </SheetTitle>
          </SheetHeader>

          {/* Wrapped Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="mx-auto w-full max-w-[360px] overflow-hidden"
            style={{
              aspectRatio: '9 / 16',
              background: 'linear-gradient(160deg, #0A0A0A 0%, #050505 40%, rgba(232,25,44,0.10) 100%)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8,
            }}
          >
            <div className="flex h-full flex-col justify-between p-6">
              {/* Haut : avatar + nom */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full overflow-hidden flex-shrink-0" style={{ border: '2px solid rgba(255,255,255,0.14)', background: '#1B1B1E' }}>
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-display font-bold" style={{ fontSize: '18px', color: '#9A9A9A' }}>
                        {firstName?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-bold uppercase text-white truncate" style={{ fontSize: '20px', letterSpacing: '-0.02em', lineHeight: 1 }}>
                      {firstName || 'Anonymous'}
                    </p>
                    <p className="font-mono font-bold uppercase mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.16em', color: badgeInfo.color }}>
                      {badgeInfo.label}
                    </p>
                  </div>
                </div>

                {/* Filet */}
                <div style={{ height: 1, width: '100%', background: 'rgba(255,255,255,0.08)' }} />
              </div>

              {/* Centre : grille de stats */}
              <div className="flex-1 flex flex-col justify-center space-y-5">
                {/* Gros chiffre : nuits */}
                <div className="text-center">
                  <p className="font-display font-bold text-white" style={{ fontSize: '64px', letterSpacing: '-0.05em', lineHeight: 0.85 }}>
                    {nightsAttended}
                  </p>
                  <p className="mt-2 font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.20em', color: '#9A9A9A' }}>
                    {t('profile.shareNights')}
                  </p>
                </div>

                {/* Ligne de stats */}
                <div className="grid grid-cols-3 gap-3">
                  <StatBlock
                    icon={<MapPin className="h-3.5 w-3.5" />}
                    value={venuesVisited}
                    label="Clubs"
                  />
                  <StatBlock
                    icon={<GlassWater className="h-3.5 w-3.5" />}
                    value={drinksOrdered}
                    label="Drinks"
                  />
                  <StatBlock
                    icon={<Calendar className="h-3.5 w-3.5" />}
                    value={citiesExplored}
                    label={t('profile.shareCities')}
                  />
                </div>

                {/* Streak */}
                {currentStreak > 0 && (
                  <div className="flex items-center justify-center gap-2 py-2.5 px-4" style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4 }}>
                    <Flame className="h-4 w-4" style={{ color: '#E8192C' }} />
                    <span className="font-mono font-bold uppercase" style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#E8192C' }}>
                      {currentStreak} {t('profile.streakWeekends')}
                    </span>
                  </div>
                )}

                {/* Club favori */}
                {favoriteClub && (
                  <div className="text-center">
                    <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.15em', color: '#5A5A5E' }}>
                      {t('profile.shareFavClub')}
                    </p>
                    <p className="font-display font-bold uppercase text-white mt-1" style={{ fontSize: '14px', letterSpacing: '-0.005em' }}>
                      {favoriteClub}
                    </p>
                  </div>
                )}
              </div>

              {/* Bas : branding */}
              <div className="flex items-center justify-center pt-2">
                <span className="font-display font-bold lowercase" style={{ fontSize: '14px', letterSpacing: '-0.02em', color: '#E8192C' }}>
                  yuno
                </span>
              </div>
            </div>
          </motion.div>

          {/* Boutons d'action */}
          <div className="mt-4 flex gap-3 max-w-[360px] mx-auto">
            <button
              className="btn btn--ghost flex-1"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4" style={{ color: '#E8192C' }} />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? t('profile.shareCopied') : t('profile.shareCopy')}
            </button>
            <button
              className="btn btn--primary flex-1"
              onClick={handleShare}
            >
              <Share2 className="h-4 w-4" />
              {t('profile.shareAction')}
            </button>
          </div>
        </SheetContent>
    </Sheet>
  );
}

function StatBlock({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center py-3 px-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}>
      <div className="mb-1.5" style={{ color: '#5A5A5E' }}>{icon}</div>
      <p className="font-display font-bold text-white leading-none" style={{ fontSize: '20px', letterSpacing: '-0.02em' }}>{value}</p>
      <p className="mt-1 font-mono uppercase" style={{ fontSize: '8px', letterSpacing: '0.10em', color: '#5A5A5E' }}>{label}</p>
    </div>
  );
}
