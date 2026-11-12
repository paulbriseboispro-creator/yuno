/**
 * La clientèle par provenance, dans les écrans Clients de Yuno Tickets :
 *  - `ClientSourcesCard` (fiche client) : par où cette personne arrive, canal par
 *    canal, avec les noms (« Jimena Albert ×3 », « Instagram ×1 ») ;
 *  - `ClientsSourceMix` (haut de l'écran Clients) : chaque client rangé sous le
 *    canal de la plupart de ses commandes, et qui fait venir le plus.
 * Données : `src/tickets/clients/data/sources.ts` ; mots : `src/lib/saleSource.ts`.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  channelColor, channelFamily, channelName, clientSourceSummary, familyName, isKnownChannel, saleWord,
  sourceDetail, toSaleLanguage, SALE_FAMILIES, type SaleFamily,
} from '@/lib/saleSource';
import { useClientSources, useClientsSourceMix, type SourceMixChannel } from '@/tickets/clients/data/sources';

const fmtN = (n: number, lang: string) => n.toLocaleString(lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR');
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
/** « < 1 % » plutôt que « 0 % » pour une part réelle mais minuscule. */
const pctTxt = (a: number, b: number) => (a > 0 && pctOf(a, b) === 0 ? '< 1 %' : `${pctOf(a, b)} %`);

function Dot({ color, muted }: { color: string; muted?: boolean }) {
  return <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: muted ? 'var(--ya-sand-300)' : color }} />;
}

export function ClientSourcesCard({ email }: { email: string }) {
  const { language } = useLanguage();
  const lang = toSaleLanguage(language);
  const q = useClientSources(email);
  const d = q.data;
  if (!d || d.total === 0) return null;
  const max = Math.max(1, ...d.channels.map((c) => c.n));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', borderRadius: 16, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{saleWord('clientTitle', lang)}</span>
        <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{d.total === 1 ? saleWord('clientOrder', lang) : saleWord('clientOrders', lang, { n: d.total })}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 600, textWrap: 'pretty' }}>{clientSourceSummary(d.channels, lang)}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {d.channels.map((c) => {
          const known = isKnownChannel(c.channel);
          const color = channelColor(c.channel);
          const names = c.names.map((x) => `${sourceDetail(c.channel, x.label, lang) ?? x.label}${x.n > 1 ? ` ×${x.n}` : ''}`).join(', ');
          return (
            <div key={c.channel} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <Dot color={color} muted={!known} />
                <span style={{ fontWeight: 600, color: known ? 'var(--ya-ink)' : 'var(--ya-sand-600)' }}>{channelName(c.channel, lang)}</span>
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'var(--ya-sand-600)' }}>{c.n}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--ya-sand-100)', overflow: 'hidden' }}>
                <div style={{ width: `${(c.n / max) * 100}%`, height: '100%', borderRadius: 99, background: known ? color : 'var(--ya-sand-300)' }} />
              </div>
              {names && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-600)' }}>{names}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PERIODS: (number | null)[] = [null, 90, 30];

export function ClientsSourceMix() {
  const { language } = useLanguage();
  const lang = toSaleLanguage(language);
  const [days, setDays] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const q = useClientsSourceMix(days);
  const d = q.data;

  const famTotals = new Map<SaleFamily, number>();
  for (const c of d?.channels ?? []) famTotals.set(channelFamily(c.channel), (famTotals.get(channelFamily(c.channel)) ?? 0) + c.clients);
  const fams = SALE_FAMILIES.filter((f) => (famTotals.get(f) ?? 0) > 0);
  const tot = Math.max(1, d?.clients ?? 0);
  const famColor = (f: SaleFamily) => {
    const first = d?.channels.find((c) => channelFamily(c.channel) === f);
    return first && isKnownChannel(first.channel) ? channelColor(first.channel) : 'var(--ya-sand-300)';
  };

  return (
    <Hv
      as="section"
      style={{
        flex: '1 1 100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 18,
        background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-border),var(--ya-card-shadow)',
      }}
      hover={{ boxShadow: 'inset 0 0 0 1px var(--ya-sand-300),var(--ya-shadow-md)' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 16, letterSpacing: '-.01em' }}>{saleWord('mixTitle', lang)}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--ya-sand-500)', marginTop: 2 }}>{saleWord('mixSub', lang)}</div>
        </div>
        <div role="group" aria-label={saleWord('period', lang)} style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 12, background: 'var(--ya-sand-100)' }}>
          {PERIODS.map((p) => {
            const on = p === days;
            return (
              <button key={String(p)} type="button" onClick={() => setDays(p)}
                style={{ height: 30, padding: '0 12px', borderRadius: 10, border: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  background: on ? 'var(--ya-fill)' : 'transparent', color: on ? '#fff' : 'var(--ya-sand-700)' }}>
                {p === null ? saleWord('all', lang) : saleWord(p === 30 ? 'last30' : 'last90', lang)}
              </button>
            );
          })}
        </div>
      </div>

      {!d || d.clients === 0 ? (
        <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{q.isLoading ? '…' : saleWord('mixEmpty', lang)}</span>
      ) : (
        <>
          {/* Une barre : la base par famille. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', background: 'var(--ya-sand-100)' }}>
              {fams.map((f) => (
                <div key={f} title={`${familyName(f, lang)} · ${famTotals.get(f)}`}
                  style={{ width: `${((famTotals.get(f) ?? 0) / tot) * 100}%`, background: famColor(f) }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13, color: 'var(--ya-sand-700)' }}>
              {fams.map((f) => (
                <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Dot color={famColor(f)} />
                  {familyName(f, lang)} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{pctTxt(famTotals.get(f) ?? 0, d.clients)}</b>
                </span>
              ))}
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>
              {[
                saleWord('mixKnown', lang, { p: pctTxt(d.known_clients, d.clients) }),
                d.multi_channel === 1 ? saleWord('mixMultiOne', lang) : d.multi_channel > 1 ? saleWord('mixMulti', lang, { n: fmtN(d.multi_channel, lang) }) : '',
              ].filter(Boolean).join(' · ')}
            </span>
          </div>

          {/* Le détail par canal, ouvrable : qui fait venir. */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Un canal qui n'est le principal de personne (ses clients viennent surtout d'ailleurs) n'a pas de ligne. */}
            {d.channels.filter((c) => c.clients > 0).map((c, i) => (
              <MixRow key={c.channel} c={c} total={d.clients} lang={lang} first={i === 0}
                open={open === c.channel} onToggle={() => setOpen(open === c.channel ? null : c.channel)} />
            ))}
          </div>
        </>
      )}
    </Hv>
  );
}

function MixRow({ c, total, lang, first, open, onToggle }: {
  c: SourceMixChannel; total: number; lang: ReturnType<typeof toSaleLanguage>; first: boolean; open: boolean; onToggle: () => void;
}) {
  const known = isKnownChannel(c.channel);
  const color = channelColor(c.channel);
  const canOpen = c.top.length > 0;
  return (
    <div style={{ borderTop: first ? 'none' : '1px solid var(--ya-sand-100)' }}>
      <button type="button" onClick={canOpen ? onToggle : undefined} aria-expanded={canOpen ? open : undefined}
        style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,2fr) auto', alignItems: 'center', gap: 14,
          padding: '11px 0', background: 'transparent', border: 0, cursor: canOpen ? 'pointer' : 'default', textAlign: 'left', color: 'inherit' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 14, fontWeight: 600, color: known ? 'var(--ya-ink)' : 'var(--ya-sand-600)' }}>
          <Dot color={color} muted={!known} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channelName(c.channel, lang, true)}</span>
          {canOpen && <span style={{ color: 'var(--ya-sand-400)', fontWeight: 500 }}>{open ? '▾' : '▸'}</span>}
        </span>
        <span style={{ height: 8, borderRadius: 99, background: 'var(--ya-sand-100)', overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${(c.clients / Math.max(1, total)) * 100}%`, height: '100%', borderRadius: 99, background: known ? color : 'var(--ya-sand-300)' }} />
        </span>
        <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--ya-sand-700)', whiteSpace: 'nowrap' }}>
          {c.clients === 1 ? saleWord('mixClient', lang) : saleWord('mixClients', lang, { n: fmtN(c.clients, lang) })}
          <span style={{ color: 'var(--ya-sand-400)' }}> · {pctTxt(c.clients, total)}</span>
        </span>
      </button>
      {open && canOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 0 12px 16px' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ya-sand-500)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{saleWord('mixTop', lang)}</span>
          {c.top.map((x) => (
            <div key={x.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceDetail(c.channel, x.label, lang) ?? x.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ya-sand-600)', whiteSpace: 'nowrap' }}>
                {x.clients === 1 ? saleWord('mixClient', lang) : saleWord('mixClients', lang, { n: fmtN(x.clients, lang) })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
