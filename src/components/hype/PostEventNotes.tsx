import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Save, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PostEventNotesProps {
  notes: string;
  onSave: (notes: string) => void;
}

export function PostEventNotes({ notes: initialNotes, onSave }: PostEventNotesProps) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setNotes(initialNotes); }, [initialNotes]);

  const handleSave = () => {
    onSave(notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.5 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2 }}>
            <FileText className="w-4 h-4" />
          </div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('postEvent.internalNotes')}
          </h3>
        </div>

        <div className="space-y-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('postEvent.notesPlaceholder')}
            className="w-full resize-none outline-none"
            rows={4}
            style={{
              background: INNER_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: '12px 14px',
              color: T1,
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; }}
          />
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl cursor-pointer transition-all duration-150"
              style={saved
                ? { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: POS }
                : { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED }
              }
            >
              {saved
                ? <><Check className="h-3.5 w-3.5" /><span style={{ fontSize: 13, fontWeight: 600 }}>{t('postEvent.saved')}</span></>
                : <><Save className="h-3.5 w-3.5" /><span style={{ fontSize: 13, fontWeight: 600 }}>{t('postEvent.save')}</span></>
              }
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
