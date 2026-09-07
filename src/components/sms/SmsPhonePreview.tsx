import { ChevronLeft, ChevronRight, Signal, Wifi, Battery, Mic, Plus } from 'lucide-react';
import { smsSizing } from '@/lib/smsMarketing';

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/g;

function parseMessageSegments(text: string): Array<{ type: 'text' | 'url'; content: string }> {
  const segments: Array<{ type: 'text' | 'url'; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    segments.push({ type: 'url', content: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) });
  return segments;
}

/**
 * Aperçu iPhone du SMS TEL QU'IL PARTIRA : `message` est le corps composé
 * (nom d'expéditeur + texte + mention STOP), jamais le texte brut du champ.
 */
export function SmsPhonePreview({ message, senderName, footer }: { message: string; senderName: string; footer?: string }) {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const sizing = smsSizing(message);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-[230px] select-none">
        <div className="absolute left-[-3px] top-[80px] h-5 w-[3px] rounded-l bg-zinc-600" />
        <div className="absolute left-[-3px] top-[114px] h-9 w-[3px] rounded-l bg-zinc-600" />
        <div className="absolute left-[-3px] top-[160px] h-9 w-[3px] rounded-l bg-zinc-600" />
        <div className="absolute right-[-3px] top-[122px] h-14 w-[3px] rounded-r bg-zinc-600" />
        <div
          className="overflow-hidden rounded-[42px] bg-black"
          style={{ border: '2.5px solid #3a3a3c', boxShadow: '0 0 0 0.5px rgba(255,255,255,0.06), 0 24px 64px rgba(0,0,0,0.85)' }}
        >
          <div className="flex justify-center bg-black pt-3 pb-0.5">
            <div className="flex h-[28px] w-[112px] items-center justify-end rounded-full pr-2" style={{ background: '#0a0a0a', border: '1px solid #1c1c1e' }}>
              <div className="h-[9px] w-[9px] rounded-full bg-zinc-800" />
            </div>
          </div>
          <div className="flex items-center justify-between bg-black px-5 pb-1.5 pt-0.5">
            <span className="text-[11px] font-semibold text-white">{timeStr}</span>
            <div className="flex items-center gap-[5px]">
              <Signal className="h-[11px] w-[11px] text-white" />
              <Wifi className="h-[11px] w-[11px] text-white" />
              <Battery className="h-[13px] w-[13px] text-white" />
            </div>
          </div>
          <div className="bg-zinc-800" style={{ height: '0.5px' }} />
          <div className="bg-zinc-950">
            <div className="flex items-center px-3 pt-2 pb-0.5">
              <div className="flex items-center" style={{ color: '#0A84FF' }}>
                <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={2.5} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-[3px] pb-3">
              <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-zinc-800 text-[15px] font-semibold text-white">
                {(senderName || 'Y').trim().charAt(0).toUpperCase()}
              </div>
              <div className="mt-0.5 flex items-center gap-[2px]">
                <span className="max-w-[150px] truncate text-[11px] font-semibold text-white">{senderName}</span>
                <ChevronRight className="h-[10px] w-[10px] text-white/40" />
              </div>
              <span className="text-[9px] text-zinc-500">SMS</span>
            </div>
          </div>
          <div className="min-h-[175px] bg-black px-3 pt-3">
            <p className="mb-3 text-center text-[9px] text-zinc-500">{timeStr}</p>
            <div className="flex justify-start">
              <div className="max-w-[82%] px-3 py-[7px]" style={{ background: '#2c2c2e', borderRadius: '16px 16px 16px 4px' }}>
                {message ? (
                  <p className="whitespace-pre-wrap break-words text-[10px] leading-[1.5] text-white">
                    {parseMessageSegments(message).map((seg, i) =>
                      seg.type === 'url' ? (
                        <span key={i} style={{ color: '#0A84FF', textDecoration: 'underline' }}>{seg.content}</span>
                      ) : (
                        <span key={i}>{seg.content}</span>
                      ),
                    )}
                  </p>
                ) : (
                  <span className="text-[15px] leading-none tracking-[3px] text-zinc-400">···</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-black px-3 py-2">
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-zinc-700">
              <Plus className="h-[13px] w-[13px] text-zinc-400" />
            </div>
            <div className="flex flex-1 items-center justify-between rounded-full border border-zinc-700 px-3 py-[5px]">
              <span className="text-[9px] text-zinc-500">Message • SMS</span>
              <Mic className="h-[11px] w-[11px] text-zinc-500" />
            </div>
          </div>
          <div className="flex justify-center bg-black pb-3 pt-0.5">
            <div className="h-[4px] w-24 rounded-full bg-zinc-700" />
          </div>
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        {footer ?? `${sizing.length}/${sizing.singleLimit} · ${sizing.encoding} · ${sizing.segments} SMS`}
      </p>
    </div>
  );
}
