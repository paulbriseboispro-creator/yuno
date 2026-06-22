import { useRef, useState } from 'react';
import { Play, Pause, Music } from 'lucide-react';

/**
 * Native in-page audio player for a DJ's single featured track.
 * No external embed / no redirection — the file (uploaded to the dj-tracks
 * bucket) plays right here via a plain <audio> element. Editorial DA publique.
 *
 * preload="none" so the audio is only fetched once the visitor taps play.
 */
export function DJTrackPlayer({ url, title, label }: { url: string; title: string | null; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => { /* autoplay/seek race — ignore */ }); }
    else { a.pause(); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const pct = duration ? (current / duration) * 100 : 0;

  return (
    <div className="px-5 pt-6">
      <p className="section-label-ruled mb-4">{label}</p>
      <div
        className="flex items-center gap-4 rounded-[10px] px-4 py-3.5"
        style={{ background: '#141417', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex items-center justify-center shrink-0 rounded-full transition-transform active:scale-95"
          style={{ width: 44, height: 44, background: '#E8192C', color: '#fff' }}
        >
          {playing
            ? <Pause className="h-5 w-5" fill="#fff" />
            : <Play className="h-5 w-5 ml-0.5" fill="#fff" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Music className="h-3.5 w-3.5 shrink-0" style={{ color: '#7A7A7E' }} />
            <p
              className="font-mono uppercase truncate"
              style={{ fontSize: '12px', color: '#E5E5E5', letterSpacing: '0.05em' }}
            >
              {title || '—'}
            </p>
          </div>
          {/* Progress bar (click to seek) */}
          <div
            onClick={seek}
            className="relative cursor-pointer"
            style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }}
          >
            <div
              className="absolute left-0 top-0 h-full"
              style={{ width: `${pct}%`, borderRadius: 2, background: '#E8192C' }}
            />
          </div>
          <div className="flex justify-between mt-1.5 font-mono tabular-nums" style={{ fontSize: '9px', color: '#5A5A5E' }}>
            <span>{fmt(current)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}
