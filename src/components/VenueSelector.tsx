import { Check, ChevronDown, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Venue {
  id: string;
  name: string;
  logo_url?: string | null;
}

interface VenueSelectorProps {
  venues: Venue[];
  selectedVenueId: string;
  onSelect: (venueId: string) => void;
  className?: string;
}

export function VenueSelector({ venues, selectedVenueId, onSelect, className }: VenueSelectorProps) {
  const selectedVenue = venues.find(v => v.id === selectedVenueId);

  if (venues.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          {selectedVenue?.logo_url ? (
            <img 
              src={selectedVenue.logo_url} 
              alt="" 
              className="h-5 w-5 rounded-full object-cover mr-2" 
            />
          ) : (
            <Building2 className="h-4 w-4 mr-2" />
          )}
          <span className="max-w-[120px] truncate">{selectedVenue?.name || 'Sélectionner'}</span>
          <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {venues.map((venue) => (
          <DropdownMenuItem
            key={venue.id}
            onClick={() => onSelect(venue.id)}
            className="flex items-center gap-2"
          >
            {venue.logo_url ? (
              <img 
                src={venue.logo_url} 
                alt="" 
                className="h-6 w-6 rounded-full object-cover" 
              />
            ) : (
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                <Building2 className="h-3 w-3" />
              </div>
            )}
            <span className="flex-1 truncate">{venue.name}</span>
            {venue.id === selectedVenueId && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
