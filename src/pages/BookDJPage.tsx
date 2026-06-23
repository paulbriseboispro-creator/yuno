import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { useVenueContext } from '@/hooks/useVenueContext';
import { DJDiscovery } from '@/components/dj-marketplace/DJDiscovery';

// "Book a DJ" — the booker-facing marketplace. Mounted under both /owner and
// /organizer-app; DJDiscovery + useVenueContext adapt the scope (venue XOR organizer)
// automatically, so one page serves both clubs and organizers.
export default function BookDJPage() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  // OwnerHeader consumes OwnerVenueProvider, which is mounted only in the /owner
  // subtree. Organizers run under OrgAppLayout (no such provider) and already get
  // its OrgAppHeader, so rendering OwnerHeader in organizer scope throws and
  // white-screens the page. Show an inline title for them instead.
  const { scope } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const title = tt('Booking DJ', 'Booking DJ', 'Booking DJ');

  return (
    <div className="min-h-screen bg-background">
      {isOrganizerScope ? (
        <header className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
          <h1 className="text-xl font-semibold">{title}</h1>
        </header>
      ) : (
        <OwnerHeader title={title} />
      )}
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
