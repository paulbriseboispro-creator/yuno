import { useState, useRef } from 'react';
import { Camera, MapPin, Crown, Star, Sparkles, Settings, Share2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import type { UserBadge } from '@/hooks/useNightlifeProfile';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { AvatarCropperDialog } from '@/components/AvatarCropperDialog';

interface ProfileHeaderProps {
  firstName: string | null;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  city: string | null;
  badge: UserBadge;
  userId: string;
  onAvatarUpdate: (avatarUrl: string, backgroundUrl: string) => void;
  onBack: () => void;
  onShareClick?: () => void;
  onCityUpdate?: (city: string) => void;
}

export function ProfileHeader({ 
  firstName, 
  avatarUrl, 
  backgroundUrl,
  city, 
  badge, 
  userId, 
  onAvatarUpdate,
  onBack,
  onShareClick,
  onCityUpdate,
}: ProfileHeaderProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cityDialogOpen, setCityDialogOpen] = useState(false);
  const [cityInput, setCityInput] = useState('');
  const [savingCity, setSavingCity] = useState(false);

  const handleSaveCity = async () => {
    if (!cityInput.trim()) return;
    setSavingCity(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ city: cityInput.trim() })
        .eq('id', userId);
      if (error) throw error;
      onCityUpdate?.(cityInput.trim());
      setCityDialogOpen(false);
      toast.success(t('profile.city') + ' ✓');
    } catch (e) {
      console.error(e);
      toast.error('Error');
    } finally {
      setSavingCity(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('profile.photoTooLarge'));
      return;
    }

    setSelectedFile(file);
    setCropperOpen(true);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCroppedUpload = async (croppedFile: File) => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      // Upload original (full-size) for background
      const originalPath = `${userId}/original.jpg`;
      const { error: origError } = await supabase.storage
        .from('profile-photos')
        .upload(originalPath, selectedFile, { upsert: true });
      if (origError) throw origError;

      const { data: { publicUrl: originalPublicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(originalPath);

      // Upload cropped for avatar circle
      const avatarPath = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(avatarPath, croppedFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(avatarPath);

      const avatarWithCache = `${publicUrl}?t=${Date.now()}`;
      const bgWithCache = `${originalPublicUrl}?t=${Date.now()}`;
      onAvatarUpdate(avatarWithCache, bgWithCache);
      toast.success(t('profile.photoUpdated'));
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error(t('profile.photoError'));
    } finally {
      setUploading(false);
    }
  };

  const getBadgeConfig = () => {
    switch (badge) {
      case 'vip':
        // Amber = rareté (DA publique)
        return { label: 'VIP', icon: Crown, color: '#F0A742', border: 'rgba(240,167,66,0.45)', bg: 'rgba(240,167,66,0.12)' };
      case 'regular':
        return { label: t('profile.regular'), icon: Star, color: '#E8192C', border: 'rgba(232,25,44,0.45)', bg: 'rgba(232,25,44,0.12)' };
      default:
        return { label: t('profile.new'), icon: Sparkles, color: '#9A9A9A', border: 'rgba(255,255,255,0.14)', bg: 'rgba(255,255,255,0.06)' };
    }
  };

  const badgeConfig = getBadgeConfig();
  const BadgeIcon = badgeConfig.icon;

  return (
    <div className="relative -mx-3 sm:-mx-4 -mt-3 sm:-mt-4">
      {/* Immersive hero area */}
      <div className="relative" style={{ minHeight: '380px', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Background: original photo or gradient */}
        {(backgroundUrl || avatarUrl) ? (
          <>
            <img
              src={backgroundUrl || avatarUrl!}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Dark overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-background" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-primary/15 via-background/60 to-background" />
        )}

        {/* Top nav — contrôles flottants hero (radius tranchant 2px) */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,12px)+8px)]">
          {onShareClick ? (
            <button
              type="button"
              onClick={onShareClick}
              className="flex h-9 w-9 items-center justify-center text-white transition-transform active:scale-95"
              style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <Share2 className="h-4 w-4" />
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex h-9 w-9 items-center justify-center text-white transition-transform active:scale-95"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* Centered avatar */}
        <div className="relative z-10 flex flex-col items-center pt-20">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative"
          >
            {/* Ambient glow behind avatar */}
            <div className="absolute inset-0 bg-primary/30 rounded-full blur-3xl scale-150 pointer-events-none" />
            
            <Avatar className="h-32 w-32 ring-2 ring-white/20 relative shadow-2xl">
              <AvatarImage src={avatarUrl || undefined} alt={firstName || 'Profile'} />
              <AvatarFallback className="bg-primary/20 text-primary text-4xl font-bold">
                {firstName?.charAt(0)?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>

            {/* Camera upload button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 h-10 w-10 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center cursor-pointer hover:bg-white/20 transition-colors"
              disabled={uploading}
            >
              <Camera className="h-4 w-4 text-white" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading}
            />
          </motion.div>
        </div>

        {/* Name + city overlaid at bottom of hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 24 }}
          className="relative z-10 px-6 pt-4 pb-6"
        >
          {/* Kicker mono */}
          <p
            className="font-mono uppercase"
            style={{ fontSize: '10.5px', letterSpacing: '0.18em', color: '#9A9A9A' }}
          >
            {t('profile.welcomeBack')}
          </p>

          {/* Titre hero — Space Grotesk uppercase */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-1.5">
            <h1
              className="font-display uppercase text-white"
              style={{ fontSize: 'clamp(34px, 9vw, 52px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 0.92 }}
            >
              {firstName || t('profile.guest')}
            </h1>
            <span
              className="inline-flex items-center gap-1 font-mono font-bold uppercase"
              style={{
                fontSize: '10px', letterSpacing: '0.12em', color: badgeConfig.color,
                border: `1px solid ${badgeConfig.border}`, background: badgeConfig.bg,
                padding: '4px 9px', borderRadius: 999, backdropFilter: 'blur(12px)',
              }}
            >
              <BadgeIcon className="h-3 w-3" />
              {badgeConfig.label}
            </span>
          </div>

          {/* Ville — metadata mono */}
          {city ? (
            <div className="flex items-center gap-1.5 mt-3">
              <MapPin className="h-3.5 w-3.5" style={{ color: '#5A5A5E' }} />
              <span className="font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
                {city}
              </span>
            </div>
          ) : (
            <button
              onClick={() => { setCityInput(''); setCityDialogOpen(true); }}
              className="flex items-center gap-1.5 mt-3 transition-colors active:scale-[0.97]"
              style={{ color: '#E8192C' }}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span className="font-mono font-medium uppercase" style={{ fontSize: '11px', letterSpacing: '0.06em' }}>
                + {t('profile.addCity')}
              </span>
            </button>
          )}
        </motion.div>

      </div>

      {/* Avatar Cropper Dialog */}
      <AvatarCropperDialog
        open={cropperOpen}
        onOpenChange={setCropperOpen}
        imageFile={selectedFile}
        onCrop={handleCroppedUpload}
      />

      {/* City Dialog */}
      <Dialog open={cityDialogOpen} onOpenChange={setCityDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              {t('profile.addCity')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="Paris, Lyon, Marseille..."
              value={cityInput}
              onChange={e => setCityInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveCity()}
              autoFocus
            />
            <Button onClick={handleSaveCity} disabled={savingCity || !cityInput.trim()} className="w-full">
              {savingCity ? '...' : t('profile.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
