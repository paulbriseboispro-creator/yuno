/**
 * Réglages d'une section sur mesure (bloc `html`) dans le Studio CRM : son nom,
 * son code, les balises Yuno à poser d'un clic (insérées au curseur), et ce
 * que le contrôle qualité y trouve — le même contrôle que l'IA du pro reçoit
 * par le MCP (email-smart.ts). Les sections préparées par une IA arrivent
 * ici : le pro les relit, les corrige, puis envoie.
 */
import { useMemo, useRef } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { useCrmT } from '@/crm/i18n';
import { useStudio } from '@/components/email-studio/store';
import { buildSmartData, lintSmartSection, smartLang, type HtmlBlock, type LiveData } from '@/lib/email';
import { Field, Note, TextInput } from './fields';
import { inputCss, type Patch } from './fieldHelpers';
import { useStudioUi } from './studioUi';

/** Balises proposées d'un clic, par famille. Les blocs s'insèrent ouverts ET fermés. */
const TAG_GROUPS: { k: string; tags: string[] }[] = [
  { k: 'event', tags: ['event.title', 'event.date', 'event.time', 'event.venue', 'event.price_from', 'event.cover', 'event.lineup'] },
  { k: 'links', tags: ['event.tickets_url', 'event.url', 'event.tables_url', 'event.guestlist_url'] },
  { k: 'lists', tags: ['#each tickets', '#each lineup', '#if event.sold_out', '#if tables.available'] },
  { k: 'more', tags: ['tables.left_label', 'guestlist.summary', 'countdown.days', 'countdown.hours', 'first_name', 'brand.logo'] },
];

function snippet(tag: string): string {
  if (tag === '#each tickets') return '{{#each tickets}}{{name}} — {{price}}{{#if sold_out}} (sold out){{/if}}{{/each}}';
  if (tag === '#each lineup') return '{{#each lineup}}{{name}}{{#unless @last}} · {{/unless}}{{/each}}';
  if (tag.startsWith('#if ')) return `{{${tag}}}…{{else}}…{{/if}}`;
  return `{{${tag}}}`;
}

export function HtmlSectionFields({ block, patch, live }: { block: HtmlBlock; patch: Patch; live: LiveData }) {
  const { t } = useCrmT();
  const ui = useStudioUi();
  const campaignEventId = useStudio((s) => s.campaign.eventId);
  const language = useStudio((s) => s.campaign.language ?? null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const eventId = block.eventId || campaignEventId || null;

  const issues = useMemo(() => {
    const ev = eventId ? live[eventId] : undefined;
    const data = buildSmartData({ event: ev || null, language: smartLang(language) });
    return lintSmartSection(block.code || '', { hasEvent: !!eventId, data });
  }, [block.code, eventId, live, language]);

  const register = (el: HTMLTextAreaElement) => {
    ui.active.current = { kind: 'input', el, apply: (v) => patch({ code: v }) };
  };

  // Insère au curseur du code (même mécanique que les puces {{prénom}}).
  const insert = (text: string) => {
    const el = area.current;
    const cur = block.code || '';
    const s = el?.selectionStart ?? cur.length;
    const e = el?.selectionEnd ?? cur.length;
    patch({ code: cur.slice(0, s) + text + cur.slice(e) });
    const pos = s + text.length;
    window.setTimeout(() => { if (!el) return; el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* champ sans sélection */ } }, 20);
  };

  return (
    <>
      <Note>{t('yc.em.st.f.htmlNote')}</Note>
      <Field label={t('yc.em.st.f.htmlName')}>
        <TextInput value={block.label ?? ''} onChange={(v) => patch({ label: v.slice(0, 60) || undefined })} placeholder={t('yc.em.st.f.htmlNamePh')} />
      </Field>
      <Field label={t('yc.em.st.f.htmlCode')} hint={t('yc.em.st.f.htmlCodeHint')}>
        <textarea
          ref={area}
          className="yc-field"
          value={block.code}
          rows={14}
          spellCheck={false}
          onFocus={(e) => register(e.currentTarget)}
          onChange={(e) => patch({ code: e.target.value })}
          aria-label="HTML"
          style={{ ...inputCss, height: 'auto', padding: '12px 14px', lineHeight: 1.45, resize: 'vertical', fontFamily: "'Geist Mono',ui-monospace,Menlo,monospace", fontSize: 12 }}
        />
      </Field>

      {issues.length > 0 && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 14, background: issues.some((i) => i.level === 'error') ? 'var(--red-50)' : 'var(--amber-50, #FFF8E6)' }}>
          <b style={{ fontSize: 13.5 }}>{t('yc.em.st.lint.title', { n: issues.length })}</b>
          {issues.slice(0, 8).map((i, n) => (
            <span key={`${i.code}-${n}`} style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-700)' }}>
              {i.level === 'error' ? '● ' : '○ '}{t(`yc.em.st.lint.${i.code}`) === `yc.em.st.lint.${i.code}` ? t('yc.em.st.lint.other') : t(`yc.em.st.lint.${i.code}`)}
            </span>
          ))}
        </div>
      )}

      <Field label={t('yc.em.st.f.htmlTags')} hint={t('yc.em.st.f.htmlTagsHint')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {TAG_GROUPS.map((g) => (
            <div key={g.k} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ width: '100%', fontSize: 12, color: 'var(--sand-500)' }}>{t(`yc.em.st.f.htmlTag.${g.k}`)}</span>
              {g.tags.map((tag) => (
                <Hv
                  key={tag}
                  as="button"
                  type="button"
                  onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); insert(snippet(tag)); }}
                  style={{ height: 28, padding: '0 10px', border: 0, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', font: "500 12px 'Geist Mono',monospace", cursor: 'pointer' }}
                  hover={{ background: 'var(--red-100)' }}
                >
                  {`{{${tag}}}`}
                </Hv>
              ))}
            </div>
          ))}
        </div>
      </Field>
    </>
  );
}
