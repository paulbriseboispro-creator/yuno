import { useState, useEffect } from 'react';
import { X, Search, Music } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';

interface DJ {
  id: string;
  stage_name: string | null;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

interface DJLineupSelectorProps {
  eventId?: string;
  selectedDJIds: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Scope-aware DJ selector.
 * - Owner / manager (venue scope): can search any active DJ on the platform.
 * - Organizer scope: restricted to DJs explicitly linked to the organizer's roster
 *   (djs.organizer_user_id = current user). Prevents organizers from poaching
 *   DJs they have not invited.
 */
export function DJLineupSelector({ eventId, selectedDJIds, onChange }: DJLineupSelectorProps) {
  const { t } = useLanguage();
  const { scope, organizerUserId } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DJ[]>([]);
  const [selectedDJs, setSelectedDJs] = useState<DJ[]>([]);
  const [orgRoster, setOrgRoster] = useState<DJ[] | null>(null);

  // Load selected DJs info on mount
  useEffect(() => {
    if (selectedDJIds.length > 0) {
      loadSelectedDJs();
    }
  }, []);

  // For organizer scope, prefetch the entire roster (small list, no search needed)
  useEffect(() => {
    if (!isOrganizerScope || !organizerUserId) return;
    (async () => {
      const { data } = await supabase
        .from('djs')
        .select('id, stage_name, first_name, last_name, profile_image_url')
        .eq('organizer_user_id', organizerUserId)
        .eq('is_active', true)
        .order('stage_name', { ascending: true });
      setOrgRoster(data || []);
    })();
  }, [isOrganizerScope, organizerUserId]);

  const loadSelectedDJs = async () => {
    const { data } = await supabase
      .from('djs')
      .select('id, stage_name, first_name, last_name, profile_image_url')
      .in('id', selectedDJIds);
    if (data) setSelectedDJs(data);
  };

  useEffect(() => {
    if (query.length < 2 && !isOrganizerScope) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => searchDJs(query), 300);
    return () => clearTimeout(timer);
  }, [query, isOrganizerScope, orgRoster]);

  const searchDJs = async (q: string) => {
    if (isOrganizerScope) {
      // Filter the cached roster locally — no remote search.
      const roster = orgRoster ?? [];
      const lc = q.trim().toLowerCase();
      const filtered = roster.filter((d) => {
        if (selectedDJIds.includes(d.id)) return false;
        if (!lc) return true;
        return (
          (d.stage_name || '').toLowerCase().includes(lc) ||
          d.first_name.toLowerCase().includes(lc) ||
          d.last_name.toLowerCase().includes(lc)
        );
      });
      setResults(filtered.slice(0, 20));
      return;
    }
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const searchTerm = `%${q}%`;
    const { data } = await supabase
      .from('djs')
      .select('id, stage_name, first_name, last_name, profile_image_url')
      .eq('is_active', true)
      .or(`stage_name.ilike.${searchTerm},first_name.ilike.${searchTerm},last_name.ilike.${searchTerm}`)
      .limit(10);

    setResults((data || []).filter(d => !selectedDJIds.includes(d.id)));
  };

  const addDJ = (dj: DJ) => {
    setSelectedDJs(prev => [...prev, dj]);
    onChange([...selectedDJIds, dj.id]);
    setQuery('');
    setResults(isOrganizerScope ? results.filter(r => r.id !== dj.id) : []);
  };

  const removeDJ = (djId: string) => {
    setSelectedDJs(prev => prev.filter(d => d.id !== djId));
    onChange(selectedDJIds.filter(id => id !== djId));
  };

  const getDJName = (dj: DJ) => dj.stage_name || `${dj.first_name} ${dj.last_name}`;

  const showRosterEmpty = isOrganizerScope && orgRoster !== null && orgRoster.length === 0;

  return (
    <div className="space-y-2">
      <Label className="text-sm flex items-center gap-1">
        <Music className="h-3 w-3" /> {t('owner.djLineup')}
      </Label>

      {/* Selected DJs chips */}
      {selectedDJs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedDJs.map(dj => (
            <Badge key={dj.id} variant="secondary" className="flex items-center gap-1 pr-1">
              {dj.profile_image_url && (
                <img src={dj.profile_image_url} alt="" className="h-4 w-4 rounded-full object-cover" />
              )}
              <span className="text-xs">{getDJName(dj)}</span>
              <button
                type="button"
                onClick={() => removeDJ(dj.id)}
                className="ml-0.5 p-0.5 rounded-full hover:bg-destructive/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {showRosterEmpty ? (
        <p className="text-xs text-muted-foreground italic">
          Aucun DJ dans ton roster. Va dans l'onglet DJs pour en inviter.
        </p>
      ) : (
        <>
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isOrganizerScope
                  ? 'Rechercher dans ton roster…'
                  : t('owner.searchDJPlaceholder')
              }
              className="pl-8 text-sm"
              onFocus={() => {
                if (isOrganizerScope) searchDJs(query);
              }}
            />
          </div>

          {/* Results dropdown */}
          {results.length > 0 && (
            <div className="border border-border rounded-lg bg-card max-h-48 overflow-y-auto">
              {results.map(dj => (
                <button
                  key={dj.id}
                  type="button"
                  onClick={() => addDJ(dj)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden bg-muted">
                    {dj.profile_image_url ? (
                      <img src={dj.profile_image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Music className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium">{getDJName(dj)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
