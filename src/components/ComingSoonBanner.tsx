import { Rocket } from 'lucide-react';

interface ComingSoonBannerProps {
  title?: string;
  description?: string;
}

export function ComingSoonBanner({
  title = 'Bientôt disponible',
  description = 'Cette fonctionnalité sera disponible prochainement.',
}: ComingSoonBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm">
      <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div>
        <p className="font-medium text-amber-300">{title}</p>
        <p className="mt-0.5 text-amber-300/70">{description}</p>
      </div>
    </div>
  );
}
