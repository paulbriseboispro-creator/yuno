// Première rangée de la carte « Votre commande » : l'affiche, la date et la
// ville en mono, le titre de la soirée. Commune aux paiements billet, table et
// guest list, pour que la soirée se reconnaisse d'un coup d'œil d'une page à l'autre.
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

interface OrderEventRowProps {
  posterUrl?: string | null;
  /** « sam. 25 oct. · 23:30 · Paris » */
  dateLine: string;
  title: string;
}

export function OrderEventRow({ posterUrl, dateLine, title }: OrderEventRowProps) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      {posterUrl ? (
        <img
          src={getOptimizedImageUrl(posterUrl, { width: 112, height: 112 })}
          alt=""
          className="h-[52px] w-[52px] shrink-0 object-cover"
          style={{ borderRadius: 6 }}
        />
      ) : (
        <div aria-hidden className="h-[52px] w-[52px] shrink-0" style={{ borderRadius: 6, background: 'linear-gradient(160deg, #1a0a0d, #7a1428)' }} />
      )}
      <div className="min-w-0">
        <p className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-[#9A9A9A]">{dateLine}</p>
        <p className="mt-1 font-display text-base font-bold uppercase leading-[1.1] tracking-[-0.005em] text-white [overflow-wrap:anywhere]">{title}</p>
      </div>
    </div>
  );
}
