import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';

export interface TicketRoundData {
  name: string;
  ticketsSold: number;
  maxTickets: number;
  isActive: boolean;
  ticketType: string;
}

export interface VipZoneData {
  name: string;
  totalTables: number;
  reservedTables: number;
  color?: string;
}

export interface TicketAvailabilityProps {
  venueName: string;
  eventTitle: string;
  eventDate: string;
  ticketRounds: TicketRoundData[];
  vipZones: VipZoneData[];
  ctaText: string;
  statusText: string;
  language: string;
  salesMode?: string | null;
  globalMaxTickets?: number | null;
  bgColor1?: string;
  bgColor2?: string;
  textColor?: string;
  /** Essential+ removes the "Powered by Yuno" mark (branding cap). */
  hideBranding?: boolean;
}

const localeMap: Record<string, Locale> = { fr, en: enUS, es };

function isSimpleMode(rounds: TicketRoundData[], salesMode?: string | null) {
  if (salesMode === 'simple') return true;
  return rounds.length === 1 && rounds[0].maxTickets >= 999990;
}

export function TicketAvailabilityTemplate({
  venueName,
  eventTitle,
  eventDate,
  ticketRounds,
  vipZones,
  ctaText,
  statusText,
  language,
  salesMode,
  globalMaxTickets,
  hideBranding = false,
}: TicketAvailabilityProps) {
  const locale = localeMap[language] || enUS;
  const date = new Date(eventDate);
  const dayName = format(date, 'EEEE', { locale }).toUpperCase();
  const dayNum = format(date, 'd', { locale });
  const month = format(date, 'MMMM', { locale }).toUpperCase();
  const simpleMode = isSimpleMode(ticketRounds, salesMode);

  const totalSold = ticketRounds.reduce((s, r) => s + r.ticketsSold, 0);
  const totalMax = simpleMode && globalMaxTickets ? globalMaxTickets : ticketRounds.reduce((s, r) => s + r.maxTickets, 0);
  const totalRemaining = simpleMode ? (globalMaxTickets ? globalMaxTickets - totalSold : null) : totalMax - totalSold;
  const globalPct = totalMax > 0 ? Math.round((totalSold / totalMax) * 100) : 0;

  return (
    <div style={{
      width: 1080, height: 1920, position: 'relative', overflow: 'hidden',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: '#050505',
    }}>
      {/* BG */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #150000 0%, #1c0505 18%, #200808 35%, #180303 50%, #0d0000 70%, #050505 90%, #080000 100%)' }} />
      <div style={{ position: 'absolute', top: -180, left: '50%', transform: 'translateX(-50%)', width: 1200, height: 800, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(180,20,20,0.22) 0%, transparent 75%)' }} />
      <div style={{ position: 'absolute', bottom: -100, left: '50%', transform: 'translateX(-50%)', width: 1000, height: 500, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(180,20,20,0.1) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize: '200px 200px' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.4) 30%, rgba(220,38,38,0.15) 70%, transparent 95%)' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, transparent 5%, rgba(220,38,38,0.4) 30%, rgba(220,38,38,0.15) 70%, transparent 95%)' }} />

      {/* CONTENT */}
      <div style={{
        position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column',
        height: '100%', padding: '40px 36px 36px',
      }}>

        {/* Main card container */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.04)',
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 32, padding: '52px 44px 44px',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>

          {/* Venue */}
          <p style={{ fontSize: 32, fontWeight: 900, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 10, textAlign: 'center', marginBottom: 16 }}>
            {venueName}
          </p>

          {/* Title */}
          <h1 style={{
            fontSize: 96, fontWeight: 900, color: '#fff', lineHeight: 0.95,
            textAlign: 'center', textTransform: 'uppercase', marginBottom: 16,
            textShadow: '0 0 60px rgba(220,38,38,0.3), 0 4px 20px rgba(0,0,0,0.8)',
          }}>
            {eventTitle}
          </h1>

          {/* Date */}
          <p style={{
            fontSize: 30, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
            textAlign: 'center', textTransform: 'uppercase', letterSpacing: 4, marginBottom: 36,
          }}>
            {dayName} · {dayNum} {month}
          </p>

          {/* Status badge */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
            background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)',
            borderRadius: 20, padding: '20px 0', marginBottom: 40,
          }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 20px rgba(239,68,68,0.8)' }} />
            <span style={{ fontSize: 28, fontWeight: 900, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 5 }}>
              {statusText}
            </span>
          </div>

          {/* Hero stat */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: '#ef4444', letterSpacing: 6, textTransform: 'uppercase', marginBottom: 10 }}>
              TICKETS REMAINING
            </p>
            <p style={{ fontSize: 130, fontWeight: 900, color: '#fff', lineHeight: 1 }}>
              {totalRemaining !== null ? Math.max(0, totalRemaining) : totalSold}
            </p>
            {totalRemaining !== null && (
              <p style={{ fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
                {globalPct}% SOLD
              </p>
            )}
          </div>

          {/* Progress bar */}
          {totalRemaining !== null && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ width: '100%', height: 22, borderRadius: 12, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(globalPct, 100)}%`, height: '100%', borderRadius: 12,
                  background: globalPct >= 100 ? '#dc2626' : 'linear-gradient(90deg, #dc2626, #ef4444)',
                  boxShadow: globalPct < 100 ? '0 0 16px rgba(220,38,38,0.5)' : 'none',
                }} />
              </div>
            </div>
          )}

          {/* Ticket rounds */}
          {!simpleMode && ticketRounds.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 24 }}>
                TICKET AVAILABILITY
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {ticketRounds.map((round, i) => {
                  const pct = round.maxTickets > 0 ? Math.min((round.ticketsSold / round.maxTickets) * 100, 100) : 0;
                  const soldOut = pct >= 100;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontSize: 36, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 }}>{round.name}</span>
                        {soldOut ? (
                          <span style={{
                            fontSize: 20, fontWeight: 900, color: '#fff', background: '#dc2626',
                            padding: '8px 22px', borderRadius: 24, letterSpacing: 2,
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            ✕ SOLD OUT
                          </span>
                        ) : (
                          <span style={{ fontSize: 26, fontWeight: 900, color: '#ef4444', letterSpacing: 1 }}>
                            {Math.round(pct)}% GONE
                          </span>
                        )}
                      </div>
                      <div style={{ width: '100%', height: 24, borderRadius: 14, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.max(pct, 2)}%`, height: '100%', borderRadius: 14,
                          background: soldOut
                            ? 'linear-gradient(90deg, #dc2626, #b91c1c)'
                            : 'linear-gradient(90deg, #dc2626 0%, #ef4444 70%, rgba(239,68,68,0.5) 100%)',
                          boxShadow: '0 0 12px rgba(220,38,38,0.4)',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Simple mode */}
          {simpleMode && ticketRounds.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 24 }}>
                TICKET AVAILABILITY
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {ticketRounds.map((round, i) => {
                  const soldOut = totalRemaining !== null && totalRemaining <= 0;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontSize: 36, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 }}>{round.name}</span>
                        {soldOut ? (
                          <span style={{
                            fontSize: 20, fontWeight: 900, color: '#fff', background: '#dc2626',
                            padding: '8px 22px', borderRadius: 24, letterSpacing: 2,
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            ✕ SOLD OUT
                          </span>
                        ) : (
                          <span style={{ fontSize: 26, fontWeight: 900, color: '#ef4444', letterSpacing: 1 }}>
                            {globalPct}% GONE
                          </span>
                        )}
                      </div>
                      <div style={{ width: '100%', height: 24, borderRadius: 14, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.max(Math.min(globalPct, 100), 2)}%`, height: '100%', borderRadius: 14,
                          background: soldOut
                            ? 'linear-gradient(90deg, #dc2626, #b91c1c)'
                            : 'linear-gradient(90deg, #dc2626 0%, #ef4444 70%, rgba(239,68,68,0.5) 100%)',
                          boxShadow: '0 0 12px rgba(220,38,38,0.4)',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIP Zones */}
          {vipZones.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 6, marginBottom: 24 }}>
                VIP TABLES
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {vipZones.map((zone, i) => {
                  const pct = zone.totalTables > 0 ? Math.min((zone.reservedTables / zone.totalTables) * 100, 100) : 0;
                  const soldOut = pct >= 100;
                  const remaining = zone.totalTables - zone.reservedTables;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 36, fontWeight: 900, color: '#fff', textTransform: 'uppercase' }}>{zone.name}</span>
                        {soldOut ? (
                          <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', background: '#dc2626', padding: '8px 24px', borderRadius: 24, letterSpacing: 2 }}>
                            FULL
                          </span>
                        ) : (
                          <span style={{ fontSize: 28, fontWeight: 900, color: '#ef4444' }}>
                            {remaining} / {zone.totalTables} LEFT
                          </span>
                        )}
                      </div>
                      <div style={{ width: '100%', height: 22, borderRadius: 12, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: 12,
                          background: soldOut ? '#dc2626' : 'linear-gradient(90deg, #dc2626, #ef4444)',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          <div style={{ textAlign: 'center', marginBottom: 0 }}>
            <div style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)',
              padding: '32px 100px', borderRadius: 50,
              boxShadow: '0 0 50px rgba(220,38,38,0.5), 0 12px 40px rgba(220,38,38,0.3)',
            }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 4 }}>
                {ctaText}
              </span>
            </div>
          </div>

        </div>{/* end card */}

        {/* YUNO — outside the card (removed on Essential+) */}
        {!hideBranding && (
          <div style={{ textAlign: 'center', paddingTop: 24, paddingBottom: 4 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.2)', letterSpacing: 5, marginBottom: 8, textTransform: 'uppercase' }}>Powered by</p>
            <p style={{ fontSize: 56, fontWeight: 900, color: 'rgba(255,255,255,0.55)', letterSpacing: 16, marginBottom: 6, lineHeight: 1 }}>YUNO</p>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)', fontWeight: 700, letterSpacing: 4 }}>BUILT FOR NIGHTLIFE, MADE FOR YOUR NIGHT</p>
          </div>
        )}
      </div>
    </div>
  );
}
