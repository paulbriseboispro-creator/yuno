import { useRef } from 'react';
import { guestSetPhoto, uploadGuestPhoto } from '@/lib/guestSpace';

/** Un champ fichier caché derrière n'importe quel bouton : `pick()` l'ouvre. */
export function usePhotoPicker(onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input ref={ref} type="file" accept="image/webp,image/jpeg,image/png" className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
  );
  return { input, pick: () => ref.current?.click() };
}

/** L'invité change (ou retire, `null`) sa photo depuis son espace. */
export async function saveGuestPhoto(
  p: { token: string; w: (k: 'guestSpace.photo.saved' | 'guestSpace.photo.removed') => string; reload: () => Promise<void>; toast: (m: string, tone?: 'ok' | 'err') => void },
  file: File | null,
  errorText: (err: unknown) => string,
): Promise<void> {
  try {
    const url = file ? await uploadGuestPhoto(p.token, file) : null;
    await guestSetPhoto(p.token, url);
    p.toast(p.w(file ? 'guestSpace.photo.saved' : 'guestSpace.photo.removed'));
    await p.reload();
  } catch (err) {
    p.toast(errorText(err), 'err');
  }
}
