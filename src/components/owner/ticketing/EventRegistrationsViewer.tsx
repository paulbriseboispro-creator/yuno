import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, Copy, Mail } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { useLanguage } from '@/contexts/LanguageContext';
import { RED, T1, T2, T3, C_FAINT, BORDER, INNER_CARD, TILE } from './ticketing-ui';
import type { WaitlistEntry } from './ticketing-types';

interface EventRegistrationsViewerProps {
  entries: WaitlistEntry[] | undefined;
  onCopyEmails: () => void;
}

// Private-list / waitlist registrations panel for one event.
export function EventRegistrationsViewer({ entries, onCopyEmails }: EventRegistrationsViewerProps) {
  const { t } = useLanguage();
  return (
    <div className="p-3.5 space-y-3" style={INNER_CARD}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" style={{ color: RED }} />
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.privateListEntries')}</p>
          {(entries?.length || 0) > 0 && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
            >
              {entries?.length} {t('tickets.registered')}
            </span>
          )}
        </div>
        {(entries?.length || 0) > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={onCopyEmails}
            style={{ color: T2 }}
          >
            <Copy className="h-3 w-3" />
            {t('tickets.copyEmails')}
          </Button>
        )}
      </div>

      {(!entries || entries.length === 0) ? (
        <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.noPrivateListEntries')}</p>
      ) : (
        <ScrollArea className="max-h-[200px]">
          <div className="space-y-2">
            {entries.map(entry => (
              <div key={entry.id} className="flex items-center justify-between p-2.5 text-sm" style={TILE}>
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: T3 }} />
                  <div className="min-w-0">
                    <p className="truncate" style={{ color: T1, fontWeight: 560 }}>{entry.full_name || entry.email}</p>
                    {entry.full_name && (
                      <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{entry.email}</p>
                    )}
                  </div>
                </div>
                <span className="whitespace-nowrap ml-2 tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                  {formatInTimeZone(new Date(entry.created_at), PARIS_TIMEZONE, 'dd/MM HH:mm')}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
