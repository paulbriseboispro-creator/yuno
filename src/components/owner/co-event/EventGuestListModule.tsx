import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Users, Save, Copy, CheckCircle, XCircle, QrCode, Search } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildShareLink, glSlugify } from '@/lib/guestListShare';

const dfLocale = (lng: string) => (lng === 'fr' ? fr : lng === 'es' ? es : enUS);

interface Props {
  /** Event id this guest list applies to. */
  eventId: string;
  /** When the user is the partner venue (read-only). */
  readOnly?: boolean;
}

interface GuestListData {
  id: string;
  event_id: string;
  venue_id: string;
  quota: number;
  quota_female: number | null;
  quota_male: number | null;
  free_before_time: string;
  entry_deadline: string | null;
  includes_drink: boolean;
  visible_on_club_page: boolean;
  is_active: boolean;
  share_token: string;
}

interface EntryData {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  gender: string | null;
  status: string;
  entry_scanned: boolean;
  entry_scanned_at: string | null;
  created_at: string;
  promoter_id: string | null;
  entry_type: string | null;
}

/**
 * Module Guest List scopé à un seul événement.
 * Utilisé par le dashboard co-event ; gère la GL d'une soirée précise (config + entrées).
 */
export function EventGuestListModule({ eventId, readOnly = false }: Props) {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [guestList, setGuestList] = useState<GuestListData | null>(null);
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Form state
  const [quota, setQuota] = useState(100);
  const [enableGenderQuota, setEnableGenderQuota] = useState(false);
  const [quotaFemale, setQuotaFemale] = useState(70);
  const [quotaMale, setQuotaMale] = useState(30);
  const [freeBeforeTime, setFreeBeforeTime] = useState('02:00');
  const [includesDrink, setIncludesDrink] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    fetchGuestList();
  }, [eventId]);

  useEffect(() => {
    if (!guestList?.id) return;
    const channel = supabase
      .channel(`co-event-gl-${guestList.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_list_entries', filter: `guest_list_id=eq.${guestList.id}` }, () => {
        refreshEntries(guestList.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [guestList?.id]);

  async function fetchGuestList() {
    setLoading(true);
    // Scope to the CLUB (host) part. The event now carries a "part" per holder
    // (club / DJ / promoter), so an un-scoped maybeSingle() threw PGRST116 as soon
    // as ≥2 parts existed → the module read "not configured" and its create button
    // inserted a SECOND club row (duplicate). holder_type='club' is unique per event.
    const { data: gl } = await supabase
      .from('guest_lists')
      .select('*')
      .eq('event_id', eventId)
      .eq('holder_type', 'club')
      .maybeSingle();
    if (gl) {
      setGuestList(gl as GuestListData);
      setQuota(gl.quota ?? 0);
      setEnableGenderQuota(!!(gl.quota_female || gl.quota_male));
      setQuotaFemale(gl.quota_female || 70);
      setQuotaMale(gl.quota_male || 30);
      setFreeBeforeTime(gl.free_before_time?.substring(0, 5) || '02:00');
      setIncludesDrink(gl.includes_drink);
      setIsActive(gl.is_active);
      if (gl.venue_id) {
        const { data: v } = await supabase.from('venues').select('name').eq('id', gl.venue_id).maybeSingle();
        setVenueName(v?.name ?? null);
      }
      await refreshEntries(gl.id);
    } else {
      setGuestList(null);
      setEntries([]);
    }
    setLoading(false);
  }

  async function refreshEntries(glId: string) {
    const { data } = await supabase
      .from('guest_list_entries')
      .select('*')
      .eq('guest_list_id', glId)
      .order('created_at', { ascending: false });
    setEntries((data || []) as EntryData[]);
  }

  async function handleSave() {
    if (!guestList || readOnly) return;
    setSaving(true);
    const { error } = await supabase
      .from('guest_lists')
      .update({
        quota,
        quota_female: enableGenderQuota ? quotaFemale : null,
        quota_male: enableGenderQuota ? quotaMale : null,
        free_before_time: freeBeforeTime,
        includes_drink: includesDrink,
        is_active: isActive,
      })
      .eq('id', guestList.id);
    setSaving(false);
    if (error) { toast.error(t('coEvent.glSaveError')); return; }
    toast.success(t('coEvent.glUpdated'));
    fetchGuestList();
  }

  async function copyShareLink() {
    if (!guestList) return;
    // buildShareLink targets the real route (/club/:slug/event/:eventId/guestlist);
    // the previous /event/:eventId/guestlist URL 404'd. The slug is cosmetic (the
    // signup page resolves by ?token=), so a venue-name slug is enough.
    const url = buildShareLink({
      slug: glSlugify(venueName),
      eventId,
      token: guestList.share_token,
    });
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('coEvent.linkCopied'));
    } catch {
      toast.error(t('coEvent.glSaveError'));
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />;

  if (!guestList) {
    return (
      <Card className="owner-card border-0">
        <CardContent className="p-8 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">{t('coEvent.glNotConfigured')}</p>
          {!readOnly && (
            <Button
              className="mt-4"
              onClick={async () => {
                // Co-soirée org-led : le club physique est partner_venue_id
                // (venue_id NULL) — la guest list reste TOUJOURS scopée au club
                // qui tient la porte, sinon le scan bouncer la rejette.
                const { data: ev } = await supabase.from('events').select('venue_id, partner_venue_id').eq('id', eventId).maybeSingle();
                const glVenueId = ev?.venue_id ?? ev?.partner_venue_id;
                if (!glVenueId) { toast.error(t('coEvent.glNoVenue')); return; }
                const { error } = await supabase.from('guest_lists').insert({
                  event_id: eventId,
                  venue_id: glVenueId,
                  holder_type: 'club',
                  quota: 100,
                  free_before_time: '02:00',
                  includes_drink: false,
                  visible_on_club_page: false,
                  is_active: true,
                });
                if (error) { toast.error(error.message); return; }
                toast.success(t('coEvent.glCreated'));
                fetchGuestList();
              }}
            >
              {t('coEvent.glCreate')}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const filteredEntries = entries.filter(e =>
    !search ||
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.email.toLowerCase().includes(search.toLowerCase()),
  );
  const scanned = entries.filter(e => e.entry_scanned).length;
  const cancelled = entries.filter(e => e.status === 'cancelled').length;
  const active = entries.length - cancelled;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiMini label={t('coEvent.glRegistered')} value={String(active)} />
        <KpiMini label={t('coEvent.quota')} value={String(guestList.quota)} />
        <KpiMini label={t('coEvent.glScanned')} value={String(scanned)} />
        <KpiMini label={t('coEvent.glCancelled')} value={String(cancelled)} />
      </div>

      {/* Config */}
      <Card className="owner-card border-0">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span>{t('coEvent.config')}</span>
            <Button size="sm" variant="outline" onClick={copyShareLink}>
              <Copy className="h-3.5 w-3.5 mr-1" /> {t('coEvent.signupLink')}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('coEvent.totalQuota')}</Label>
              <Input type="number" value={quota} onChange={e => setQuota(Number(e.target.value))} disabled={readOnly} />
            </div>
            <div>
              <Label className="text-xs">{t('coEvent.freeUntilTime')}</Label>
              <Input value={freeBeforeTime} onChange={e => setFreeBeforeTime(e.target.value)} disabled={readOnly} />
            </div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/30">
            <div>
              <p className="text-sm font-medium">{t('coEvent.genderQuotas')}</p>
              <p className="text-xs text-muted-foreground">{t('coEvent.genderQuotasDesc')}</p>
            </div>
            <Switch checked={enableGenderQuota} onCheckedChange={setEnableGenderQuota} disabled={readOnly} />
          </div>
          {enableGenderQuota && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('coEvent.quotaFemale')}</Label>
                <Input type="number" value={quotaFemale} onChange={e => setQuotaFemale(Number(e.target.value))} disabled={readOnly} />
              </div>
              <div>
                <Label className="text-xs">{t('coEvent.quotaMale')}</Label>
                <Input type="number" value={quotaMale} onChange={e => setQuotaMale(Number(e.target.value))} disabled={readOnly} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/30">
            <div>
              <p className="text-sm font-medium">{t('coEvent.drinkIncluded')}</p>
              <p className="text-xs text-muted-foreground">{t('coEvent.drinkIncludedDesc')}</p>
            </div>
            <Switch checked={includesDrink} onCheckedChange={setIncludesDrink} disabled={readOnly} />
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/30">
            <div>
              <p className="text-sm font-medium">{t('coEvent.listActive')}</p>
              <p className="text-xs text-muted-foreground">{t('coEvent.listActiveDesc')}</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} disabled={readOnly} />
          </div>
          {!readOnly && (
            <Button onClick={handleSave} disabled={saving} className="w-full">
              <Save className="h-3.5 w-3.5 mr-2" /> {saving ? t('coEvent.saving') : t('coEvent.saveConfig')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Entries */}
      <Card className="owner-card border-0">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span>{t('coEvent.glRegistered')} ({entries.length})</span>
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('common.search')} className="h-8 pl-8 text-xs" />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t('coEvent.noEntries')}</p>
          ) : (
            <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
              {filteredEntries.map(e => (
                <div key={e.id} className="py-2 flex items-center justify-between text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-2">
                      {e.full_name}
                      {e.gender === 'female' && <Badge variant="outline" className="text-[9px] py-0">F</Badge>}
                      {e.gender === 'male' && <Badge variant="outline" className="text-[9px] py-0">H</Badge>}
                      {e.promoter_id && <Badge variant="outline" className="text-[9px] py-0 border-amber-500/30 text-amber-500">{t('coEvent.promoBadge')}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{e.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {e.entry_scanned ? (
                      <Badge variant="success" className="text-[10px] gap-1"><CheckCircle className="h-2.5 w-2.5" /> {t('coEvent.entered')}</Badge>
                    ) : e.status === 'cancelled' ? (
                      <Badge variant="destructive" className="text-[10px] gap-1"><XCircle className="h-2.5 w-2.5" /> {t('coEvent.cancelledStatus')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{t('coEvent.pending')}</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(e.created_at), 'dd/MM HH:mm', { locale: dfLocale(language) })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <Card className="owner-card border-0">
      <CardContent className="p-3 text-center">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
