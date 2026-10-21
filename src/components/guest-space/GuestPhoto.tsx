import { Building2, Camera, Users } from 'lucide-react';
import { BORDER, CARD_BG, RED, T2 } from '@/components/org-ui';
import { guestInitials, type GuestKind } from '@/lib/guestSpace';
import { usePhotoPicker } from './guestPhotoActions';

/**
 * La photo de profil d'un invité (logo du club, photo du lieu…), partout où il
 * apparaît : espace, carte du profil, fiche de l'organisateur, « Qui fait
 * vendre ». Sans photo : ses initiales, sinon l'icône de son type.
 */
export function GuestAvatar({ url, name, kind, size = 32, radius }: {
  url?: string | null; name: string; kind?: GuestKind; size?: number; radius?: number;
}) {
  const r = radius ?? size / 2;
  if (url) {
    return <img src={url} alt="" className="flex-none object-cover" style={{ width: size, height: size, borderRadius: r, border: `1px solid ${BORDER}` }} />;
  }
  const initials = guestInitials(name);
  const Icon = kind === 'venue' ? Building2 : Users;
  return (
    <span className="grid flex-none place-items-center" style={{
      width: size, height: size, borderRadius: r, background: 'rgb(var(--ink)/0.06)', border: `1px solid ${BORDER}`,
      color: T2, fontSize: Math.round(size * 0.36), fontWeight: 700,
    }}>
      {initials || <Icon style={{ width: size * 0.45, height: size * 0.45 }} />}
    </span>
  );
}

/** Le rond cliquable : la photo, avec un petit appareil photo pour la changer. */
export function GuestAvatarButton({ url, name, kind, size = 34, radius, onFile, label, disabled }: {
  url?: string | null; name: string; kind?: GuestKind; size?: number; radius?: number;
  onFile: (file: File) => void; label: string; disabled?: boolean;
}) {
  const { input, pick } = usePhotoPicker(onFile);
  return (
    <button type="button" onClick={pick} disabled={disabled} aria-label={label} title={label}
      className="relative flex-none" style={{ borderRadius: radius ?? size / 2 }}>
      <GuestAvatar url={url} name={name} kind={kind} size={size} radius={radius} />
      <span className="absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full"
        style={{ background: RED, color: '#fff', border: `2px solid ${CARD_BG}` }}>
        <Camera className="h-2.5 w-2.5" />
      </span>
      {input}
    </button>
  );
}

