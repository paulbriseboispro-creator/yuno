import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { DJDiscovery } from '@/components/dj-marketplace/DJDiscovery';

// "Book a DJ" — the booker-facing marketplace. Mounted under both /owner and
// /organizer-app; DJDiscovery + useVenueContext adapt the scope (venue XOR organizer)
// automatically, so one page serves both clubs and organizers.
export default function BookDJPage() {
  const { language } = useLanguage();
  const tt = makeDjT(language);

  return (
    <div className="min-h-screen bg-background">
      <OwnerHeader title={tt('Réserver un DJ', 'Book a DJ', 'Reservar un DJ')} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <p className="mb-5 text-sm text-muted-foreground">
          {tt(
            'Trouve un DJ, vérifie ses dispos et envoie une demande de booking. Les profils les mieux tenus remontent en premier.',
            'Find a DJ, check availability and send a booking request. The best-kept profiles rise to the top.',
            'Encuentra un DJ, comprueba su disponibilidad y envía una solicitud de reserva. Los perfiles mejor cuidados aparecen primero.',
          )}
        </p>
        <DJDiscovery mode="booker" />
      </main>
    </div>
  );
}
