import { useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { AssistantEventCards } from '@/components/assistant/AssistantEventCards';
import { parseAssistantMessage } from '@/lib/assistantMessage';
import { useRevealedText } from '@/hooks/useRevealedText';

/**
 * Une réponse de l'assistant, telle qu'elle se pose à l'écran.
 *
 * Le texte s'écrit (voir `useRevealedText`) au lieu d'apparaître par blocs, les
 * soirées citées deviennent des cartes au moment exact où leur jeton est
 * atteint, et un curseur bat tant que l'écriture n'est pas finie. Les messages
 * déjà lus ne se rejouent pas : seule la réponse en cours s'anime.
 */
export function AssistantMessage({
  content,
  animate,
  proseClass,
  markdownComponents,
}: {
  content: string;
  animate: boolean;
  proseClass: string;
  markdownComponents: Components;
}) {
  const reduce = useReducedMotion();
  const { text, done } = useRevealedText(content, animate && !reduce);
  const segments = parseAssistantMessage(text);

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'events' ? (
          <AssistantEventCards key={`e${i}`} ids={seg.ids} />
        ) : (
          <div key={`t${i}`} className={proseClass}>
            <ReactMarkdown components={markdownComponents}>
              {/* Le curseur vit DANS le dernier paragraphe : posé après, il
                  sauterait à la ligne à chaque fin de phrase. */}
              {i === segments.length - 1 && !done ? `${seg.text} ▍` : seg.text}
            </ReactMarkdown>
          </div>
        ),
      )}
    </>
  );
}

/** Bulle de l'assistant. L'arrivée en fondu est portée par le parent : la
 *  jouer ici aussi ferait deux fondus superposés sur la même bulle. */
export function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="px-2">
      <div
        className="rounded-2xl px-5 py-5 text-[15px] leading-[1.7] text-white/90"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--primary) / 0.06) 0%, transparent 100%)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
