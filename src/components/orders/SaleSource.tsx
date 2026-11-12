/**
 * La provenance d'une commande dans la Console (Commandes : billets, tables,
 * guest list). Le canal et le nom sont figés sur la vente par la base
 * (`attribution_channel`, `attribution_label`) ; ici on les montre, et la carte
 * du détail dit en plus comment ce client vient d'habitude (`tix_client_sources`).
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { tint } from '@/lib/proTheme';
import {
  channelColor, channelName, clientSourceSummary, isKnownChannel, saleWord, sourceDetail, toSaleChannel, toSaleLanguage,
} from '@/lib/saleSource';
import { useClientSources } from '@/tickets/clients/data/sources';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';

/**
 * La pastille d'une ligne de la liste : « ● Jimena Albert » ou « ● Instagram ».
 * Rien pour une provenance inconnue : la liste ne répète pas « inconnue » sur
 * chaque ligne, le détail de la commande le dit.
 */
export function SaleSourceChip({ channel, label }: { channel: string | null | undefined; label: string | null | undefined }) {
  const { language } = useLanguage();
  const lang = toSaleLanguage(language);
  const ch = toSaleChannel(channel);
  if (!channel || ch === 'direct') return null;
  const known = isKnownChannel(ch);
  const color = channelColor(ch);
  const detail = sourceDetail(ch, label, lang);
  const text = detail ?? channelName(ch, lang);
  return (
    <span
      title={detail ? `${channelName(ch, lang)} · ${detail}` : channelName(ch, lang)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full max-w-[150px] shrink-0"
      style={{ background: known ? tint(color, '1F') : 'rgb(var(--ink)/0.05)', color: known ? T1 : T3, fontSize: 10.5, fontWeight: 560 }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: known ? color : T3 }} />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** La carte « Provenance » du détail d'une commande. */
export function SaleSourceCard({ channel, label, email }: {
  channel: string | null | undefined;
  label: string | null | undefined;
  email: string | null | undefined;
}) {
  const { language } = useLanguage();
  const lang = toSaleLanguage(language);
  const ch = toSaleChannel(channel);
  const color = channelColor(ch);
  const known = isKnownChannel(ch);
  const detail = sourceDetail(ch, label, lang);
  const sources = useClientSources(email?.trim().toLowerCase() || null);
  const cs = sources.data;
  const showClient = !!cs && cs.total > 1;

  return (
    <div className="p-4 rounded-xl space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{saleWord('source', lang)}</p>
      {channel ? (
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: known ? tint(color, '24') : 'rgb(var(--ink)/0.06)' }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: known ? color : T3 }} />
          </span>
          <div className="min-w-0">
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }} className="truncate">{detail ?? channelName(ch, lang)}</p>
            {detail && <p style={{ color: T2, fontSize: 12 }}>{channelName(ch, lang)}</p>}
          </div>
        </div>
      ) : (
        <p style={{ color: T2, fontSize: 13 }}>{channelName('direct', lang)}</p>
      )}
      {(!channel || ch === 'direct') && <p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{saleWord('unknownHint', lang)}</p>}
      {showClient && cs && (
        <div className="pt-2 mt-1 space-y-1.5" style={{ borderTop: `1px solid ${BORDER}` }}>
          <p style={{ color: T2, fontSize: 12.5 }}>
            <span style={{ color: T1, fontWeight: 560 }}>{clientSourceSummary(cs.channels, lang)}</span>
            {' · '}{saleWord('clientOrders', lang, { n: cs.total })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {cs.channels.map((c) => (
              <span key={c.channel} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                style={{ background: isKnownChannel(c.channel) ? tint(channelColor(c.channel), '1A') : 'rgb(var(--ink)/0.05)', color: T2, fontSize: 11 }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: isKnownChannel(c.channel) ? channelColor(c.channel) : T3 }} />
                {c.names[0] ? c.names[0].label : channelName(c.channel, lang)} ×{c.n}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
