import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ImagePlus, Loader2, XCircle } from 'lucide-react';
import '@/styles/connect-ai.css';
import { useLanguage } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { Wordmark } from '@/components/brand/Wordmark';

/**
 * /ai/image/<code> — la page où le pro dépose l'image que son IA va placer
 * dans un e-mail (serveur MCP Yuno, outil add_email_image). L'IA ne peut pas
 * toujours transmettre une image collée dans sa conversation : elle donne ce
 * lien, la personne y COLLE l'image (⌘V), la glisse ou la choisit, puis
 * retourne dans sa conversation.
 *
 * Le code est un emplacement à usage unique (30 min) ouvert par l'IA pour CET
 * espace : la page n'a pas besoin de session. Tout est vérifié côté serveur
 * (Worker /mcp/image/<code> : format lu dans les octets, 8 Mo, emplacement
 * ouvert ; base : mcp_image_finish). DA de l'écran de connexion d'une IA.
 */

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';
const T1 = 'var(--text-primary)';
const T2 = 'var(--text-secondary)';
const T3 = 'var(--text-tertiary)';
const BORDER = 'var(--border-default)';
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

type SlotStatus = 'loading' | 'waiting' | 'ready' | 'expired' | 'not_found';
interface Slot { status: SlotStatus; spaceName?: string | null; url?: string | null }

function useCrmFonts() {
  useEffect(() => {
    if (document.getElementById('yc-fonts')) return;
    const l = document.createElement('link');
    l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
    document.head.appendChild(l);
  }, []);
}

function Shell({ children }: { children: React.ReactNode }) {
  useCrmFonts();
  return (
    <div
      className="yc yc-page-bg relative min-h-[100dvh] flex items-center justify-center px-4 sm:px-5"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
    >
      <Seo title="Yuno" description="" noindex />
      <div className="relative z-10 w-full" style={{ maxWidth: 480 }}>
        <Wordmark height={22} tone="dark" className="mb-7" alt="Yuno" />
        {children}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: `1px solid ${BORDER}`, borderRadius: 24, boxShadow: 'var(--shadow-sm)', padding: 22 }}>
      {children}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 style={{ color: T1, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{children}</h1>;
}

function Outcome({ tone, title, body, image }: { tone: 'ok' | 'ko'; title: string; body: string; image?: string | null }) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle;
  return (
    <Panel>
      <Icon className="h-9 w-9 mb-5" style={{ color: tone === 'ok' ? 'var(--green-500)' : 'var(--red-500)' }} aria-hidden="true" />
      <Title>{title}</Title>
      <p style={{ color: T2, fontSize: 15, lineHeight: 1.6, marginTop: 10 }}>{body}</p>
      {image ? <img src={image} alt="" style={{ marginTop: 18, width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 16, background: 'var(--surface-sunken, #f4f1ec)' }} /> : null}
    </Panel>
  );
}

export default function AiImageUpload() {
  const { code = '' } = useParams<{ code: string }>();
  const { t } = useLanguage();
  const [slot, setSlot] = useState<Slot>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const endpoint = `/mcp/image/${encodeURIComponent(code)}`;

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
        const j = await res.json().catch(() => ({})) as { ok?: boolean; status?: string; space_name?: string; url?: string };
        if (off) return;
        if (!j.ok) { setSlot({ status: 'not_found' }); return; }
        const status = (['waiting', 'ready', 'expired'].includes(String(j.status)) ? j.status : 'not_found') as SlotStatus;
        setSlot({ status, spaceName: j.space_name ?? null, url: j.url ?? null });
      } catch {
        if (!off) setSlot({ status: 'not_found' });
      }
    })();
    return () => { off = true; };
  }, [endpoint]);

  const send = useCallback(async (file: File) => {
    setError(null);
    if (!TYPES.includes(file.type)) { setError(t('aiImg.errType')); return; }
    if (file.size > MAX_BYTES) { setError(t('aiImg.errSize')); return; }
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; url?: string };
      if (j.ok) { setSlot((s) => ({ ...s, status: 'ready', url: j.url ?? null })); return; }
      if (j.error === 'expired' || j.error === 'slot_closed') { setSlot((s) => ({ ...s, status: 'expired' })); return; }
      if (j.error === 'ready') { setSlot((s) => ({ ...s, status: 'ready', url: j.url ?? null })); return; }
      setPreview(null);
      setError(t(j.error === 'too_large' ? 'aiImg.errSize' : j.error === 'not_an_image' ? 'aiImg.errType' : 'aiImg.errGeneric'));
    } catch {
      setPreview(null);
      setError(t('aiImg.errGeneric'));
    } finally {
      setBusy(false);
    }
  }, [endpoint, t]);

  // Coller (⌘V / Ctrl+V) n'importe où sur la page.
  useEffect(() => {
    if (slot.status !== 'waiting') return undefined;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
        ?? Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
      if (file) { e.preventDefault(); void send(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [slot.status, send]);

  if (slot.status === 'loading') {
    return <Shell><Panel><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} aria-label={t('aiImg.uploading')} /></Panel></Shell>;
  }
  if (slot.status === 'ready') {
    return <Shell><Outcome tone="ok" title={t(preview ? 'aiImg.doneTitle' : 'aiImg.usedTitle')} body={t(preview ? 'aiImg.doneBody' : 'aiImg.usedBody')} image={preview || slot.url} /></Shell>;
  }
  if (slot.status === 'expired') return <Shell><Outcome tone="ko" title={t('aiImg.expiredTitle')} body={t('aiImg.expiredBody')} /></Shell>;
  if (slot.status === 'not_found') return <Shell><Outcome tone="ko" title={t('aiImg.notFoundTitle')} body={t('aiImg.notFoundBody')} /></Shell>;

  return (
    <Shell>
      <Panel>
        <Title>{t('aiImg.title')}</Title>
        {slot.spaceName ? <p style={{ color: T2, fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>{t('aiImg.for').replace('{space}', slot.spaceName)}</p> : null}
        <div
          role="button"
          tabIndex={0}
          aria-busy={busy || undefined}
          onClick={() => !busy && input.current?.click()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); input.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')) ?? e.dataTransfer.files[0];
            if (file && !busy) void send(file);
          }}
          style={{
            marginTop: 18, borderRadius: 18, border: `2px dashed ${over ? 'var(--red-500, #e3141b)' : BORDER}`,
            background: over ? 'rgba(227,20,27,0.04)' : 'var(--surface-sunken, #f8f6f2)',
            minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: 18, cursor: busy ? 'progress' : 'pointer', textAlign: 'center', transition: 'all .15s',
          }}
        >
          {preview ? (
            <img src={preview} alt="" style={{ maxHeight: 180, maxWidth: '100%', borderRadius: 12, opacity: busy ? 0.6 : 1 }} />
          ) : (
            <ImagePlus className="h-9 w-9" style={{ color: T3 }} aria-hidden="true" />
          )}
          <span style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{busy ? t('aiImg.uploading') : t('aiImg.drop')}</span>
          {!busy && (
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 18px', borderRadius: 12, background: 'var(--gradient-brand)', color: 'var(--text-on-accent)', fontSize: 14.5, fontWeight: 600 }}>
              {t('aiImg.choose')}
            </span>
          )}
          <span style={{ color: T3, fontSize: 12.5 }}>{t('aiImg.formats')}</span>
        </div>
        <input
          ref={input}
          type="file"
          accept={TYPES.join(',')}
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }}
        />
        {error ? <p role="alert" style={{ color: 'var(--red-600, #c8102e)', fontSize: 14, marginTop: 12 }}>{error}</p> : null}
        <p style={{ color: T3, fontSize: 12.5, lineHeight: 1.5, marginTop: 14 }}>{t('aiImg.note')}</p>
      </Panel>
    </Shell>
  );
}
